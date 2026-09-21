import type { Role } from './index';

/** Resolved from verified identity and trusted server records, never URL state. */
export type OnboardingRole = 'cleaner' | 'owner';
export type OnboardingState =
  | { status: 'choose_role'; displayName: string }
  | { status: 'setup'; displayName: string; role: OnboardingRole; invited: boolean; cityId: string | null; homeBase: string | null; assignedPropertyCount: number }
  | { status: 'complete'; role: Role; destination: '/cleaner' | '/owner' | '/admin' }
  | { status: 'blocked'; reason: 'expired' | 'revoked' | 'mismatched' | 'conflicting' | 'invalid'; message: string };

/** One atomic completion. A self-selected role is accepted only when the server
 * independently resolves choose_role. Existing or invited roles cannot change. */
export type CompleteOnboardingInput =
  | { role: 'cleaner'; cityId: string }
  | { role: 'owner'; homeBase: string };
export type CompleteOnboardingResult = Extract<OnboardingState, { status: 'complete' }>;
