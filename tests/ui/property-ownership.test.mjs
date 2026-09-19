import test from 'node:test';
import assert from 'node:assert/strict';
import { propertyOwnership } from '../../src/components/bloom/property-form.ts';

test('Bloom ownership clears stale owner input, and existing mode ignores pending email', () => {
  assert.deepEqual(propertyOwnership(true, 'pending', ['old-owner'], 'old@example.test'), {ownerIds: [], pendingOwnerEmail: null});
  assert.deepEqual(propertyOwnership(false, 'existing', ['owner-1', 'owner-1'], 'old@example.test'), {ownerIds: ['owner-1'], pendingOwnerEmail: null});
  assert.equal(propertyOwnership(false, 'existing', [], 'pending@example.test'), null);
});

test('pending owner is normalized and never includes stale selected owner IDs', () => {
  assert.deepEqual(propertyOwnership(false, 'pending', ['old-owner'], ' Future.Owner@Example.Test '), {ownerIds: [], pendingOwnerEmail: 'future.owner@example.test'});
  for (const email of ['', 'owner', 'owner@', 'owner @example.test', 'owner@example', `${'x'.repeat(250)}@example.test`]) {
    assert.equal(propertyOwnership(false, 'pending', ['old-owner'], email), null);
  }
});
