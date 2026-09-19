'use client';
import { SignIn } from '@clerk/nextjs';
import { BloomSignInLayout } from './sign-in-layout';
import styles from './sign-in.module.css';

const appearance = {
  options: { elevation: 'flush' as const },
  variables: {
    colorPrimary: '#b85563', colorText: '#111111', colorTextSecondary: '#565656',
    colorBackground: '#ffffff', colorInputBackground: '#ffffff', colorInputText: '#111111',
    colorRing: '#b85563', fontFamily: '"Plus Jakarta Sans", system-ui, sans-serif', borderRadius: '11px',
  },
  elements: {
    rootBox: styles['clerk-root'], cardBox: styles['clerk-card-box'], card: styles['clerk-card'],
    headerTitle: styles['clerk-title'], headerSubtitle: styles['clerk-subtitle'],
    formFieldInput: styles['clerk-input'], formButtonPrimary: styles['clerk-primary'],
    socialButtonsBlockButton: styles['clerk-secondary'], footer: styles['clerk-footer'], footerActionLink: styles['clerk-footer-link'],
  },
};

export function BloomSignIn() {
  return <BloomSignInLayout><SignIn routing="path" path="/sign-in" appearance={appearance} /></BloomSignInLayout>;
}
