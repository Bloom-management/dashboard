import { BackendError, databaseError } from '../db/errors';

/** Only the verified database account lookup can establish missing onboarding. */
export class BloomAccountRequired extends BackendError {
  constructor() { super('UNAUTHENTICATED'); }
}

export function accountLookupError(error: { message: string; code?: string }, status: number): never {
  if (status === 0 || (status >= 200 && status < 300)) throw new BackendError('CONFIGURATION_ERROR');
  if (status === 400 && error.code === 'P0001' && error.message === 'UNAUTHENTICATED') throw new BloomAccountRequired();
  databaseError(error);
}
