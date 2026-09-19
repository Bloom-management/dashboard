import { SignUp } from '@clerk/nextjs';
import { identityConfigured } from '../../../server/config';
import { SetupUnavailable } from '../../../components/setup-unavailable';
export const dynamic='force-dynamic';
export default function Page(){
 return identityConfigured()?<main style={{minHeight:'100dvh',display:'grid',placeItems:'center'}}><SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/onboarding"/></main>:<SetupUnavailable/>;
}
