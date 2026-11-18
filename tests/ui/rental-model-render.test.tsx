import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { MergeStudio, SplitStudio, ArchivedListings, type RentalModel } from '../../src/components/bloom/rental-model';
import { OwnerListings } from '../../src/components/bloom/owner-listings';
import type { OwnerListing } from '../../src/contracts/owner-hub';
import type { BloomIntegration } from '../../src/components/bloom/integration';

const base = { timezone: 'America/Detroit', active: true, nightlyGuestRateCents: 6200, hostPayoutCents: null, currency: 'USD' as const, sources: [], supplies: [] };
const unit: RentalModel = {
  listing: { id: 'unit', name: 'TEST Trumbull', listingType: 'entire_home', status: 'active', houseId: null, channelCheckRequired: false, archivedAt: null, canConvert: true },
  house: null, rooms: null, pendingMerge: null, mergePreview: null,
  splitDefaults: { reusesHouse: false, pricing: { firstHostCents: 7500, additionalHostCents: null, firstPoolCents: 6000, additionalPoolCents: null }, sharedSpaces: [], blockedByClaimedCleaning: false },
};
const room = (id: string, name: string) => ({ id, name, identifier: name, status: 'active', nightlyRateCents: 6200, hasEntry: true, hasChannel: id === 'r1', channelCheckRequired: false });
const house: RentalModel = {
  listing: { id: 'r1', name: 'DH1', listingType: 'room', status: 'active', houseId: 'h', channelCheckRequired: false, archivedAt: null, canConvert: true },
  house: { id: 'h', name: 'TEST Lincoln DH', address: 'Synthetic', timezone: 'America/Detroit', pricing: null, sharedSpaces: [] },
  rooms: [room('r1', 'DH1'), room('r2', 'DH2')], pendingMerge: null, splitDefaults: null,
  mergePreview: [{ survivorId: 'r1', lastCheckout: '2030-11-20' }, { survivorId: 'r2', lastCheckout: null }],
};

test('split studio starts on Rooms with two rooms, shared-space chips and a live preview', () => {
  const html = renderToStaticMarkup(<SplitStudio model={unit} onCancel={() => {}} onDone={() => {}} />);
  assert.match(html, /Split TEST Trumbull into rooms/);
  assert.equal((html.match(/Room name/g) || []).length, 2);
  assert.match(html, /aria-current="step"[^>]*>.*Rooms/);
  for (const chip of ['Kitchen', 'Living room', 'Bathroom', 'Laundry', 'Backyard']) assert.match(html, new RegExp(`>${chip}</button>`));
  assert.match(html, /Room model · 2 rooms/);
  assert.doesNotMatch(html, /[✓○×]/);
});

test('merge studio defaults to the current room and lists every room as a choice', () => {
  const html = renderToStaticMarkup(<MergeStudio model={house} onCancel={() => {}} onDone={() => {}} />);
  assert.match(html, /Merge TEST Lincoln DH into one unit/);
  assert.equal((html.match(/role="radio"/g) || []).length, 2);
  assert.match(html, /role="radio" aria-checked="true"[^>]*>.*DH1/);
});

test('rail groups a house with its rooms, hides archived listings and counts drafts & archived', () => {
  const listings: OwnerListing[] = [
    { ...base, id: 'unit', name: 'TEST Trumbull' },
    { ...base, id: 'r1', name: 'TEST DH1', houseId: 'h', houseName: 'TEST Lincoln DH', listingType: 'room', roomIdentifier: 'DH1', status: 'active' },
    { ...base, id: 'r2', name: 'TEST DH2', houseId: 'h', houseName: 'TEST Lincoln DH', listingType: 'room', roomIdentifier: 'DH2', status: 'needs_channel_link' },
    { ...base, id: 'old', name: 'TEST DH3', houseId: 'h', houseName: 'TEST Lincoln DH', listingType: 'room', roomIdentifier: 'DH3', isArchived: true, archivedAt: '2026-11-01T00:00:00Z', active: false, status: 'archived' },
  ];
  const integration = {} as BloomIntegration;
  const html = renderToStaticMarkup(<OwnerListings listings={listings} integration={integration} onChanged={() => {}} from="2026-11-01" toExclusive="2026-12-01" revision={0} initialSelectedId="r1" />);
  assert.match(html, /Drafts &amp; archived/);
  assert.match(html, /Entire unit/);
  assert.match(html, /2 rooms · shared spaces/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(html, /aria-label="Select TEST DH2"/);
  assert.doesNotMatch(html, /Select TEST DH3/);
});

test('archived cards are view-only and tagged Archived', () => {
  const html = renderToStaticMarkup(<ArchivedListings listings={[{ ...base, id: 'old', name: 'TEST DH3', houseName: 'TEST Lincoln DH', isArchived: true, archivedAt: '2026-11-01T12:00:00Z', active: false }]} />);
  assert.match(html, /Archived<\/span>/);
  assert.match(html, /Room in TEST Lincoln DH/);
  assert.doesNotMatch(html, /<button/);
});
