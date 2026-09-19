import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountLookupError, BloomAccountRequired } from './account-lookup';
import { BackendError } from '../db/errors';

test('only the explicit database missing-account exception enables onboarding', () => {
  assert.throws(() => accountLookupError({ code: 'P0001', message: 'UNAUTHENTICATED' }, 400), BloomAccountRequired);
  for (const error of [
    { code: '42501', message: 'permission denied for function bloom_me' },
    { code: 'P0001', message: 'FORBIDDEN' },
    { code: 'PGRST301', message: 'JWT verification failed' },
    { code: 'PGRST302', message: 'UNAUTHENTICATED' },
  ]) {
    assert.throws(() => accountLookupError(error, 403), (caught: unknown) =>
      caught instanceof BackendError && !(caught instanceof BloomAccountRequired));
  }
});

test('status zero and non-400 responses cannot establish missing onboarding', () => {
  for (const status of [0, 200, 401, 403, 503]) {
    assert.throws(() => accountLookupError({ code: 'P0001', message: 'UNAUTHENTICATED' }, status), (caught: unknown) =>
      caught instanceof BackendError && !(caught instanceof BloomAccountRequired));
  }
});
