import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { identityConfigured } from '../server/config';
import '../styles/bloom-application.css';
export const metadata: Metadata = { title: 'Bloom', description: 'Bloom cleaning management', robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const content = <html lang="en"><body style={{margin:0}}>{children}</body></html>;
  return identityConfigured() ? <ClerkProvider appearance={{variables:{fontFamily:'"Plus Jakarta Sans", sans-serif'},userButton:{elements:{userButtonPopoverCard:'bloom-profile-popover',userButtonTrigger:'bloom-profile-trigger'}}}} signInUrl="/sign-in" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/">{content}</ClerkProvider> : content;
}
