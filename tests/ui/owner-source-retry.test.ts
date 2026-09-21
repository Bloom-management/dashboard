import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError } from '../../src/components/bloom/api';
import { retainOwnerSourceReceipt } from '../../src/components/bloom/owner-sources';

test('definite calendar failure gets fresh sync key but preserves source-save replay', () => {
 const error = new ApiError('SOURCE_UNAVAILABLE', 'The source timed out.', 'server-request');
 assert.equal(retainOwnerSourceReceipt('sync', error), false);
 assert.equal(retainOwnerSourceReceipt('add', error), true);
});
test('uncertain network and malformed upstream responses retain sync receipt', () => {
 for (const error of [new ApiError('NETWORK_ERROR', 'Network failed'), new ApiError('SOURCE_UNAVAILABLE', 'Malformed response'), Object.assign(new ApiError('SOURCE_UNAVAILABLE', 'Unavailable', 'server-request'), { code: 'SERVICE_UNAVAILABLE' }), new Error('Unexpected')]) {
  assert.equal(retainOwnerSourceReceipt('sync', error), true);
 }
});
test('definitive conflict/auth/validation rejection clears obsolete receipt', () => {
 for (const code of ['CONFLICT','FORBIDDEN','UNAUTHENTICATED','VALIDATION_ERROR'] as const) assert.equal(retainOwnerSourceReceipt('sync', new ApiError(code, 'Rejected', 'server-request')), false);
});
