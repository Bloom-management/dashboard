'use client';
/* Design gallery frame: renders one dialog or screen against fixture data. */
import { Suspense, useState } from 'react';
import { installDesignFetch, cleanerUser, designIntegration, jobs, jobById, today } from './fixtures';
import { CleanerHub, JobDetail } from '../../../components/bloom/cleaner';
import { CleanerDayDialog } from '../../../components/bloom/cleaner-day-dialog';

installDesignFetch();

export function FrameView({ view, jobId }: { view: string; jobId?: string }) {
  const [opened, setOpened] = useState(0);
  const reopen = () => setOpened(value => value + 1);
  const reset = <button type="button" className="bloom-button secondary" style={{ margin: 24 }} onClick={reopen}>Reopen</button>;
  if (view === 'hub') return <Suspense><CleanerHub integration={designIntegration} /></Suspense>;
  if (view === 'day') return <div className="bloom-cleaner app" key={opened}>{reset}<CleanerDayDialog date={today} jobs={jobs} onSelect={() => {}} onClose={() => {}} /></div>;
  if (view === 'job') return <div className="bloom-cleaner app" key={opened}>{reset}<JobDetail job={jobById(jobId ?? 'urgent')} user={cleanerUser} integration={designIntegration} onClose={() => {}} onUpdate={() => {}} refresh={() => {}} /></div>;
  return <p style={{ padding: 24 }}>Unknown design view “{view}”.</p>;
}
