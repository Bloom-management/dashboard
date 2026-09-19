import { ConnectedHub } from '../../../components/bloom/connected';
import { SetupUnavailable } from '../../../components/setup-unavailable';
import { requirePageRole } from '../../../server/auth/page-access';
import '../../../styles/bloom-owner.css';
export const dynamic='force-dynamic';
export default async function Page() { if(!await requirePageRole('owner'))return <SetupUnavailable/>;return <ConnectedHub role="owner"/>; }
