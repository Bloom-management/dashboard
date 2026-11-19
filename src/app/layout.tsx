import {AvatarDefaults} from '../components/bloom/avatar-defaults';
import {Toaster} from '../components/ui/toast';
import {PushLifecycle} from '../components/push/lifecycle';
import type { Metadata } from 'next';
import { ClerkProvider } from '@clerk/nextjs';
import { identityConfigured } from '../server/config';
import '../styles/bloom-application.css';
import {ThemeController} from '../components/theme/theme-controller';
import {themeBootScript} from '../components/theme/appearance';
export const metadata: Metadata = { title: 'Bloom', description: 'Bloom cleaning management', robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The boot script applies the saved theme before first paint; it adds data-theme to <html>, hence suppressHydrationWarning.
  const content = <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{__html:themeBootScript}}/></head><body style={{margin:0}}><ThemeController/>{identityConfigured()&&<><PushLifecycle/><AvatarDefaults/></>}{children}<Toaster/></body></html>;
  return identityConfigured() ? <ClerkProvider appearance={{variables:{fontFamily:'"Plus Jakarta Sans", sans-serif'},userButton:{elements:{userButtonPopoverCard:'bloom-profile-popover',userButtonTrigger:'bloom-profile-trigger'}}}} signInUrl="/sign-in" signInFallbackRedirectUrl="/" signUpFallbackRedirectUrl="/">{content}</ClerkProvider> : content;
}
