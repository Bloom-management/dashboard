import {activityDestination} from '../../../contracts/push-navigation';
import { ConnectedHub } from '../../../components/bloom/connected';
import { SetupUnavailable } from '../../../components/setup-unavailable';
import { requirePageRole } from '../../../server/auth/page-access';
import '../../../styles/bloom-owner.css';
export const dynamic='force-dynamic';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) { const q=await searchParams; if(!await requirePageRole('owner',activityDestination('owner',q)))return <SetupUnavailable/>;return <ConnectedHub role="owner"/>; }
