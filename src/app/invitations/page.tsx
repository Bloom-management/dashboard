import {auth} from '@clerk/nextjs/server';
import {PropertyInvitationEntry} from '../../components/bloom/property-invitation-entry';
import '../../styles/bloom-owner.css';
export const dynamic='force-dynamic';
export default async function Page(){return <PropertyInvitationEntry signedIn={!!(await auth()).userId}/>;}
