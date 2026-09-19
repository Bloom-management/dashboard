import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { RequestState } from '../../src/components/bloom/request-state-view';
import { HubSelector } from '../../src/components/bloom/primitives';
import type { SessionUser } from '../../src/contracts';

test('confirmed account onboarding, access denial, and retry have distinct actions', () => {
  const denied = renderToStaticMarkup(<RequestState kind="denied" />);
  assert.match(denied, /Access denied/);
  assert.match(denied, /href="\/"/);
  assert.doesNotMatch(denied, /onboarding/);
  const onboarding = renderToStaticMarkup(<RequestState kind="onboarding" />);
  assert.match(onboarding, /href="\/onboarding"/);
  const unavailable = renderToStaticMarkup(<RequestState kind="unavailable" retry={() => {}} />);
  assert.match(unavailable, /type="button"/);
  assert.match(unavailable, /Try again/);
  assert.doesNotMatch(unavailable, /schema|setup is incomplete/i);
});

test('hub switching keeps the actual admin identity and is absent for ordinary accounts', () => {
  const admin: SessionUser = Object.freeze({ id: 'unit-test-admin', role: 'admin', displayName: 'Unit test', approvedCityId: null });
  const markup = renderToStaticMarkup(<HubSelector user={admin} view="cleaner" />);
  assert.match(markup, /href="\/admin"/);
  assert.match(markup, /aria-current="page" href="\/cleaner"/);
  assert.match(markup, /href="\/owner"/);
  assert.match(renderToStaticMarkup(<HubSelector user={admin} view="owner" />), /aria-current="page" href="\/owner"/);
  assert.equal(admin.role, 'admin');
  for (const role of ['cleaner', 'owner'] as const) {
    assert.equal(renderToStaticMarkup(<HubSelector user={{ ...admin, role }} view="cleaner" />), '');
  }
});


test('session recovery reuses the login shell with a safe return action', async () => {
  const { BloomSessionRecovery } = await import('../../src/components/bloom/sign-in-layout');
  const html = renderToStaticMarkup(<BloomSessionRecovery requestId="test-reference" retry={() => {}} />);
  assert.match(html, /Explore Bloom features/);
  assert.match(html, /Let’s get you back in/);
  assert.match(html, /href="\/sign-in"/);
  assert.match(html, /Already signed in/);
  assert.match(html, /Support details/);
  assert.doesNotMatch(html, /role="onboarding"/);
});
