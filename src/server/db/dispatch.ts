import 'server-only';
import { renameProperty } from '../jobs/property-rename';
import { provisionVerifiedDisplayName } from '../auth/provision-display-name';
import { currentUser } from '../auth/session';
import { userRpc } from './rpc';
import { BackendError } from './errors';
import { response, mutation, uuid, choice, integer, text, dateRange } from './http';
import { onboardCleaner, requestCityChange, listJobs, ownerCalendar, jobAction } from '../jobs/operations';
import { createProperty, grantRole, listProperties, resolveCity, adminJobAction } from '../admin/operations';
import { prepareUpload, finalizePhoto, listPhotos, photoReadUrl } from '../photos/operations';

/** Explicit route wrappers pass a fixed operation; caller-controlled dispatch is never used. */
export async function dispatch(operation: string, request: Request, params: Record<string, string> = {}) {
  return response(async () => {
    if (operation === 'me') return currentUser();
    if (operation === 'jobs') return listJobs(...dateRange(request));
    if (operation === 'ownerCalendar') return ownerCalendar(...dateRange(request));
    if (operation === 'photos') return listPhotos(uuid(params.id));
    if (operation === 'properties') {
      const q = new URL(request.url).searchParams;
      return listProperties(integer(Number(q.get('limit') ?? 50), 1, 100), integer(Number(q.get('offset') ?? 0), 0, 1_000_000));
    }
    const allowed: Record<string, string[]> = {
      propertyRename: ['name'], onboard: ['cityId'], cityRequest: ['cityId'], cityResolve: ['decision'], claim: [], withdraw: [], complete: ['configVersion', 'answers', 'notes', 'maintenance'],
      upload: ['category', 'mime', 'bytes', 'roomId'], finalize: [], readUrl: [],
      propertyCreate: ['cityId', 'name', 'timezone', 'address', 'isBloomOwned', 'soloRateCents', 'ownerIds', 'instructions', 'pendingOwnerEmail'],
      role: ['role'], cancel: ['reason', 'expectedVersion'], reassign: ['reason', 'expectedVersion', 'removeAssignmentId', 'cleanerId'],
      resolveChange: ['action', 'checkoutDate', 'reason', 'expectedVersion'],
    };
    if (!(operation in allowed)) throw new BackendError('NOT_FOUND');
    const { body: b, key } = await mutation(request, allowed[operation]);
    if (operation === 'propertyRename') return renameProperty(uuid(params.id), text(typeof b.name === 'string' ? b.name.trim() : b.name, 200), key);
    if (operation === 'onboard') {
      await onboardCleaner(uuid(b.cityId), key);
      return provisionVerifiedDisplayName();
    }
    if (operation === 'complete') return userRpc('bloom_job_action', {p_job:uuid(params.id),p_action:'complete',p_key:key,p_payload:b});
    if (operation === 'cityRequest') return requestCityChange(uuid(b.cityId), key);
    if (operation === 'cityResolve') return resolveCity(uuid(params.id), choice(b.decision, ['approved', 'rejected']), key);
    if (operation === 'role') return grantRole(uuid(params.id), choice(b.role, ['admin', 'owner', 'cleaner']), key);
    if (operation === 'propertyCreate') {
      if (typeof b.isBloomOwned !== 'boolean' || !Array.isArray(b.ownerIds) || b.ownerIds.length > 100) throw new BackendError('VALIDATION_ERROR');
      return createProperty({ cityId: uuid(b.cityId), name: text(b.name, 200), timezone: text(b.timezone, 100), address: text(b.address, 500),
        instructions: text(b.instructions, 5000), isBloomOwned: b.isBloomOwned, soloRateCents: integer(b.soloRateCents, 2, 2_147_483_646), ownerIds: b.ownerIds.map(uuid), pendingOwnerEmail: b.pendingOwnerEmail == null ? null : text(b.pendingOwnerEmail, 254) }, key);
    }
    const jobId = uuid(params.id);
    if (operation === 'claim' || operation === 'withdraw' || operation === 'complete') return jobAction(jobId, operation, key);
    if (operation === 'upload' && b.roomId) return userRpc('bloom_room_photo_prepare', {p_job:uuid(params.id),p_room:uuid(b.roomId),p_mime:choice(b.mime,['image/jpeg','image/png','image/webp'] as const),p_bytes:integer(b.bytes,1,10485760),p_key:key});
    if (operation === 'upload') return prepareUpload(jobId, choice(b.category, ['bedrooms', 'bathrooms', 'kitchen', 'living_room']), choice(b.mime, ['image/jpeg', 'image/png', 'image/webp']), integer(b.bytes, 1, 10_485_760), key);
    if (operation === 'finalize') return finalizePhoto(jobId, uuid(params.photoId), key);
    if (operation === 'readUrl') {
      // Authorization is always fresh; URLs are capabilities and must not be replayed from stale receipts.
      await userRpc('bloom_photo_read_receipt', { p_job: jobId, p_photo: uuid(params.photoId), p_key: key });
      return photoReadUrl(jobId, uuid(params.photoId));
    }
    const expected = integer(b.expectedVersion, 1, 2_147_483_647); const reason = text(b.reason);
    if (operation === 'cancel') return adminJobAction(jobId, 'cancel', expected, { reason }, key);
    if (operation === 'reassign') return adminJobAction(jobId, 'reassign', expected, { reason, removeAssignmentId: uuid(b.removeAssignmentId), cleanerId: uuid(b.cleanerId) }, key);
    if (operation === 'resolveChange') {
      const action = choice(b.action, ['keep', 'reschedule', 'cancel']);
      if (action === 'reschedule' && (typeof b.checkoutDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(b.checkoutDate))) throw new BackendError('VALIDATION_ERROR');
      if (action !== 'reschedule' && b.checkoutDate !== undefined) throw new BackendError('VALIDATION_ERROR');
      return adminJobAction(jobId, action, expected, { reason, ...(action === 'reschedule' ? { checkoutDate: b.checkoutDate } : {}) }, key);
    }
    throw new BackendError('NOT_FOUND');
  }, operation === 'jobs' || operation === 'ownerCalendar' ? request : undefined);
}
