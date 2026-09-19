import { ConnectedHub } from '../../../components/bloom/connected';
import { SetupUnavailable } from '../../../components/setup-unavailable';
import { requirePageRole } from '../../../server/auth/page-access';
import '../../../styles/bloom-cleaner.css';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<{property?:string}>}) { if(!await requirePageRole('admin'))return <SetupUnavailable/>;return <ConnectedHub role="admin" initialPropertyId={(await searchParams).property}/>; }
