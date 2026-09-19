import { ConnectedHub } from '../../../components/bloom/connected';
import { SetupUnavailable } from '../../../components/setup-unavailable';
import { requirePageRole } from '../../../server/auth/page-access';
import '../../../styles/bloom-cleaner.css';
export const dynamic='force-dynamic';
export default async function Page() { if(!await requirePageRole('cleaner'))return <SetupUnavailable/>;return <ConnectedHub role="cleaner"/>; }
