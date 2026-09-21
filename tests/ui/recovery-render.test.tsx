import React from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
const router={back(){},forward(){},refresh(){},push(){},replace(){},prefetch:async()=>{}};
const renderHub=(node:React.ReactNode)=>renderToStaticMarkup(<AppRouterContext.Provider value={router}>{node}</AppRouterContext.Provider>);
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
  const markup = renderHub(<HubSelector user={admin} view="cleaner" />);
  assert.match(markup, /Switch hub/);
  assert.match(markup, /Cleaner Hub/);
  assert.match(markup, /aria-haspopup="menu"/);
  assert.match(renderHub(<HubSelector user={admin} view="owner" />), /Owner Hub/);
  assert.equal(admin.role, 'admin');
  for (const role of ['cleaner', 'owner'] as const) {
    assert.equal(renderHub(<HubSelector user={{ ...admin, role }} view="cleaner" />), '');
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
