import type { ApiResult, CleanerJob, ErrorCode, JobPhoto, OwnerCalendarBlock, SessionUser, SyncResult } from '../../contracts';

export class ApiError extends Error {
  constructor(public code: ErrorCode | 'NETWORK_ERROR', message: string, public requestId?: string) { super(message); }
}

/** Cookie-authenticated same-origin only. Never accepts a role, user ID or token from the UI. */
export async function request<T>(path: string, options: { body?: unknown; key?: string; signal?: AbortSignal } = {}): Promise<T> {
  const mutation = options.body !== undefined;
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: mutation ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      signal: options.signal,
      headers: mutation ? { 'Content-Type': 'application/json', 'Idempotency-Key': options.key ?? crypto.randomUUID() } : undefined,
      body: mutation ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError('NETWORK_ERROR', 'Could not reach Bloom. Check your connection and retry.');
  }
  let result: ApiResult<T>;
  try { result = await response.json(); } catch {
    throw new ApiError(response.status === 401 ? 'UNAUTHENTICATED' : response.status === 403 ? 'FORBIDDEN' : 'SOURCE_UNAVAILABLE', 'Bloom could not complete the request. Please try again.');
  }
  if (result && typeof result === 'object' && 'error' in result && result.error && typeof result.error.code === 'string' && typeof result.error.message === 'string') throw new ApiError(result.error.code, result.error.message, result.error.requestId);
  if (!response.ok || !result || typeof result !== 'object' || !('data' in result)) throw new ApiError(response.status === 401 ? 'UNAUTHENTICATED' : response.status === 403 ? 'FORBIDDEN' : 'SOURCE_UNAVAILABLE', 'Bloom returned an unexpected response. Please try again.');
  return result.data;
}

export const api = {
  me: (signal?: AbortSignal) => request<SessionUser>('/me', { signal }),
  jobs: (from: string, to: string, signal?: AbortSignal) => request<CleanerJob[]>(`/jobs?${new URLSearchParams({ from, to })}`, { signal }),
  calendar: (from: string, to: string, signal?: AbortSignal) => request<OwnerCalendarBlock[]>(`/owner/calendar?${new URLSearchParams({ from, to })}`, { signal }),
  jobAction: (id: string, action: 'claim' | 'withdraw' | 'complete', key: string) => request<CleanerJob>(`/jobs/${encodeURIComponent(id)}/${action}`, { body: {}, key }),
  photos: (id: string, signal?: AbortSignal) => request<JobPhoto[]>(`/jobs/${encodeURIComponent(id)}/photos`, { signal }),
  finalize: (jobId: string, photoId: string, key: string) => request<JobPhoto>(`/jobs/${encodeURIComponent(jobId)}/photos/${encodeURIComponent(photoId)}/finalize`, { body: {}, key }),
  readPhoto: (jobId: string, photoId: string) => request<{ url: string; expiresAt: string }>(`/jobs/${encodeURIComponent(jobId)}/photos/${encodeURIComponent(photoId)}/read-url`, { body: {} }),
  selectCity: (cityId: string, key: string) => request<SessionUser>('/onboarding/cleaner', { body: { cityId }, key }),
  requestCity: (cityId: string, key: string) => request<unknown>('/city-change-requests', { body: { cityId }, key }),
  sync: (id: string, key: string) => request<SyncResult>(`/admin/calendar/sources/${encodeURIComponent(id)}/sync`, { body: {}, key }),
};
