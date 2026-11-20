'use client';
/* Design gallery frame: renders one dialog or screen against fixture data. */
import { Suspense, useState } from 'react';
import { installDesignFetch, cleanerUser, designIntegration, jobs, jobById, today } from './fixtures';
import { CleanerHub, JobDetail } from '../../../components/bloom/cleaner';
import { CleanerDayDialog } from '../../../components/bloom/cleaner-day-dialog';
import { OwnerCreateListing } from '../../../components/bloom/owner-create';
import { PropertyForm } from '../../../components/bloom/admin';
import { Modal } from '../../../components/bloom/primitives';
import { designListings } from './fixtures';

installDesignFetch();

const owners = [{ id: 'design-owner', displayName: 'Jordan Lee', email: 'owner@example.com', role: 'owner', avatarUrl: null }];
const adminIntegration = { ...designIntegration, admin: { users: async () => ({ items: owners, nextCursor: null }) } } as never;

export function FrameView({ view, jobId, step = 0, type = 'entire_home' }: { view: string; jobId?: string; step?: number; type?: 'entire_home' | 'room' }) {
  const [opened, setOpened] = useState(0);
  const reopen = () => setOpened(value => value + 1);
  const reset = <button type="button" className="bloom-button secondary" style={{ margin: 24 }} onClick={reopen}>Reopen</button>;
  if (view === 'hub') return <Suspense><CleanerHub integration={designIntegration} /></Suspense>;
  if (view === 'day') return <div className="bloom-cleaner app" key={opened}>{reset}<CleanerDayDialog date={today} jobs={jobs} onSelect={() => {}} onClose={() => {}} /></div>;
  if (view === 'job') return <div className="bloom-cleaner app" key={opened}>{reset}<JobDetail job={jobById(jobId ?? 'urgent')} user={cleanerUser} integration={designIntegration} onClose={() => {}} onUpdate={() => {}} refresh={() => {}} /></div>;
  // Owner add-listing wizard, opened at one step of the chosen listing type.
  if (view === 'create') return <div className="bloom-owner app" key={opened}>{reset}<OwnerCreateListing open listings={designListings} initialPage={step} initialListingType={type} onClose={reopen} onCreated={() => {}} onChanged={() => {}} /></div>;
  // Admin "Add property": step 0 import and address, step 1 listing details.
  if (view === 'admin-create') return <div className="bloom-cleaner app admin-hub" key={opened}>{reset}<Modal className="owner-create-dialog" title="Add property" onClose={reopen}><div className="owner-create-body"><PropertyForm integration={adminIntegration} created={() => {}} houses={[{ id: 'design-house', name: 'Corktown House' }]} initialStep={step ? 1 : 0} initialListingType={type} /></div></Modal></div>;
  return <p style={{ padding: 24 }}>Unknown design view “{view}”.</p>;
}
