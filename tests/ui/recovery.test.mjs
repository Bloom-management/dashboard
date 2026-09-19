import test from 'node:test';
import assert from 'node:assert/strict';
import { requestStateKind, requestStateCopy } from '../../src/components/bloom/request-state.ts';
import { parseSoloRate } from '../../src/components/bloom/property-form.ts';

test('an absent diagnosis and transport failures never imply setup or onboarding', () => {
  for (const code of [undefined, 'NETWORK_ERROR', 'SOURCE_UNAVAILABLE', 'SERVICE_UNAVAILABLE']) {
    assert.equal(requestStateKind(code), 'unavailable');
  }
  assert.equal(requestStateKind('FORBIDDEN'), 'denied');
  assert.equal(requestStateKind('UNAUTHENTICATED'), 'signin');
  assert.equal(requestStateKind('CONFIGURATION_ERROR'), 'configuration');
  for (const copy of Object.values(requestStateCopy)) assert.doesNotMatch(copy.description, /missing schema|needs.*schema/i);
});

test('property rate validation preserves exact cents and backend bounds', () => {
  assert.equal(parseSoloRate('75'), 7500);
  assert.equal(parseSoloRate('75.02'), 7502);
  assert.equal(parseSoloRate('0.02'), 2);
  assert.equal(parseSoloRate('21474836.46'), 2147483646);
  for (const invalid of ['', '0', '-1', '75.01', '75.005', '1e2', 'NaN', 'Infinity', '21474836.48']) assert.equal(parseSoloRate(invalid), null, invalid);
});
