/* Design gallery frame: one dialog or screen rendered against synthetic fixtures. Admins only. */
import { ClientOnly } from '../_parts/client-only';
import { FrameView } from '../_parts/frame-view';
import { SetupUnavailable } from '../../../components/setup-unavailable';
import { requirePageRole } from '../../../server/auth/page-access';
import '../../../styles/bloom-cleaner.css';
import '../../../styles/bloom-owner.css';

export const dynamic = 'force-dynamic';

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!await requirePageRole('admin', '/design')) return <SetupUnavailable />;
  const q = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  return <ClientOnly><FrameView view={one(q.view) ?? 'hub'} jobId={one(q.job)} step={Number(one(q.step) ?? 0) || 0} type={one(q.type) === 'room' ? 'room' : 'entire_home'} /></ClientOnly>;
}
