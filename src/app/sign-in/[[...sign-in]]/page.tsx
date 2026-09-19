import { BloomSignIn } from '../../../components/bloom/sign-in';
import { identityConfigured } from '../../../server/config';
import { SetupUnavailable } from '../../../components/setup-unavailable';
export const dynamic='force-dynamic';
export default function Page(){return identityConfigured()?<BloomSignIn/>:<SetupUnavailable/>;}
