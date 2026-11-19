/* Design gallery: every shared Bloom component on one page. Admins only, opened from the admin hub's profile menu. */
import { ClientOnly } from './_parts/client-only';
import { DesignGallery } from './_parts/gallery';
import { SetupUnavailable } from '../../components/setup-unavailable';
import { requirePageRole } from '../../server/auth/page-access';
import '../../styles/bloom-cleaner.css';
import '../../styles/bloom-owner.css';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Bloom design gallery' };

export default async function Page() {
  if (!await requirePageRole('admin', '/design')) return <SetupUnavailable />;
  return <ClientOnly><DesignGallery /></ClientOnly>;
}
