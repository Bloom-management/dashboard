/** Presentation categories only. Unknown failures never establish missing schema or account. */
export type RequestStateKind = 'unavailable' | 'configuration' | 'denied' | 'signin' | 'onboarding' | 'request';
export function requestStateKind(code?: string): RequestStateKind {
  if (code === 'CONFIGURATION_ERROR') return 'configuration';
  if (code === 'FORBIDDEN' || code === 'CITY_MISMATCH') return 'denied';
  if (code === 'UNAUTHENTICATED') return 'signin';
  if (!code || ['NETWORK_ERROR', 'SOURCE_UNAVAILABLE', 'SERVICE_UNAVAILABLE'].includes(code)) return 'unavailable';
  return 'request';
}
export const requestStateCopy: Record<RequestStateKind, { title: string; description: string }> = {
  unavailable: { title: 'Bloom is temporarily unavailable', description: 'We could not reach a required service. Check your connection and try again. If this continues, contact your admin.' },
  configuration: { title: 'Bloom configuration needs attention', description: 'Bloom reported a configuration problem. Contact your admin to check the service settings, then try again.' },
  denied: { title: 'Access denied', description: 'Your account does not have permission to open this view or perform this action.' },
  signin: { title: 'Sign in to continue', description: 'Your session is missing or has expired.' },
  onboarding: { title: 'Set up your Bloom account', description: 'You are signed in. Choose your first city to finish creating your cleaner account.' },
  request: { title: 'The request could not be completed', description: 'Check the details below before trying again.' },
};
