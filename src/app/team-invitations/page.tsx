import {auth} from '@clerk/nextjs/server';
import {TeamInvitationEntry} from '@/components/bloom/team-invitations';
import '../../styles/bloom-owner.css';
export const dynamic='force-dynamic';
export default async function Page(){return <TeamInvitationEntry signedIn={!!(await auth()).userId}/>;}
