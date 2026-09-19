import 'server-only';
import sharp from 'sharp';
import { BackendError } from '../db/errors';

/** Fully decode approved raster formats before a pending upload contributes coverage. */
export async function validatePhotoBytes(buffer: Buffer, expectedBytes: number, expectedMime: string): Promise<string> {
  if (buffer.byteLength !== expectedBytes || buffer.byteLength < 1 || buffer.byteLength > 10 * 1024 * 1024) throw new BackendError('VALIDATION_ERROR');
  try {
    const decoded = sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'warning', animated: false });
    const metadata = await decoded.metadata();
    const mime = ({ jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' } as Record<string, string>)[metadata.format ?? ''];
    if (!mime || mime !== expectedMime || (metadata.pages ?? 1) > 1) throw new Error('invalid image');
    await decoded.stats();
    return mime;
  } catch { throw new BackendError('VALIDATION_ERROR'); }
}
