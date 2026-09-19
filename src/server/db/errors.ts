import type { ErrorCode } from '../../contracts';

export class BackendError extends Error {
  constructor(public readonly code: ErrorCode) { super(code); }
}
export const errorStatus: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401, FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION_ERROR: 400,
  CITY_MISMATCH: 403, JOB_FULL: 409, ALREADY_ASSIGNED: 409, WITHDRAWAL_DEADLINE: 409,
  INVALID_STATE: 409, REVIEW_REQUIRED: 409, PHOTO_COVERAGE_REQUIRED: 422, CONFLICT: 409,
  SOURCE_UNAVAILABLE: 502, CONFIGURATION_ERROR: 503,
};
export function databaseError(error: { message: string; code?: string }): never {
  if (Object.hasOwn(errorStatus, error.message)) throw new BackendError(error.message as ErrorCode);
  if (error.code === '23505' || error.code === '40001' || error.code === '40P01') throw new BackendError('CONFLICT');
  if (['23502', '23503', '23514', '22P02', '22007', '22008', '22023'].includes(error.code ?? '')) throw new BackendError('VALIDATION_ERROR');
  if (error.code === '42501') throw new BackendError('FORBIDDEN');
  // Never propagate SQL details, resource identifiers, or configuration secrets.
  throw new BackendError('CONFIGURATION_ERROR');
}
