import 'server-only';
import { validatePhotoBytes } from './validation';
import type { JobPhoto, PhotoCategory } from '../../contracts';
import { authenticatedDatabase } from '../auth/session';
import { privilegedDatabase } from '../db/privileged';
import { BackendError, databaseError } from '../db/errors';
import { userRpc } from '../db/rpc';
export type UploadTarget = { photoId: string; bucket: 'job-photos'; path: string };
export const prepareUpload = (jobId: string, category: PhotoCategory, mime: string, bytes: number, key: string) =>
  userRpc<UploadTarget>('bloom_photo_prepare', { p_job: jobId, p_category: category, p_mime: mime, p_bytes: bytes, p_key: key });
export const listPhotos = (jobId: string) => userRpc<JobPhoto[]>('bloom_photos', { p_job: jobId });
async function authorizedPhoto(jobId: string, photoId: string) {
  const { db, subject } = await authenticatedDatabase();
  const { data, error } = await db.from('job_photos').select('id,job_id,uploader_id,object_path,bytes,mime,state').eq('id', photoId).eq('job_id', jobId).maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new BackendError('NOT_FOUND');
  return { photo: data as { id: string; job_id: string; uploader_id: string; object_path: string; bytes: number; mime: string; state: string }, subject, db };
}
export async function finalizePhoto(jobId: string, photoId: string, key: string): Promise<JobPhoto> {
  const { photo, subject, db } = await authorizedPhoto(jobId, photoId);
  const { data: me, error: meError } = await db.rpc('bloom_me');
  if (meError) databaseError(meError);
  if (!me || !['cleaner', 'admin'].includes(me.role) || photo.uploader_id !== me.id) throw new BackendError('NOT_FOUND');
  const service = privilegedDatabase();
  const { data: blob, error } = await service.storage.from('job-photos').download(photo.object_path);
  if (error || !blob) throw new BackendError('INVALID_STATE');
  if (blob.size !== photo.bytes || blob.size > 10 * 1024 * 1024) throw new BackendError('VALIDATION_ERROR');
  const buffer = Buffer.from(await blob.arrayBuffer());
  const actualMime = await validatePhotoBytes(buffer, photo.bytes, photo.mime);
  // This RPC rechecks assignment and lifecycle after download/validation under the job lock.
  const { data, error: finalError } = await service.rpc('bloom_photo_finalize_verified', {
    p_subject: subject, p_job: jobId, p_photo: photoId, p_bytes: buffer.byteLength, p_mime: actualMime, p_key: key,
  });
  if (finalError) databaseError(finalError);
  return data as JobPhoto;
}
export async function photoReadUrl(jobId: string, photoId: string): Promise<{ url: string; expiresAt: string }> {
  const { photo } = await authorizedPhoto(jobId, photoId);
  if (photo.state !== 'ready') throw new BackendError('INVALID_STATE');
  // Storage SELECT is server-only so a client cannot mint arbitrarily long-lived URLs.
  const { data, error } = await privilegedDatabase().storage.from('job-photos').createSignedUrl(photo.object_path, 60);
  if (error || !data) throw new BackendError('CONFIGURATION_ERROR');
  return { url: data.signedUrl, expiresAt: new Date(Date.now() + 60_000).toISOString() };
}
