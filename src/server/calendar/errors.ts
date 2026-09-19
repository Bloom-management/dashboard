export class CalendarError extends Error {
  constructor(public code: string, public status = 502) { super(code); }
}
export const safeCode = (error: unknown) => error instanceof CalendarError ? error.code : 'SYNC_FAILED';
export const actions: Record<string, string> = {
  FETCH_TIMEOUT: 'The source timed out. Retry the sync.', FETCH_FAILED: 'The source could not be reached. Retry the sync.',
  FETCH_HTTP: 'Check the export link in the provider dashboard, then retry.',
  UNSAFE_URL: 'Use an HTTPS export link from the supported provider.',
  UNSAFE_ADDRESS: 'The export host did not resolve to a public address.',
  FETCH_TOO_LARGE: 'The feed exceeds the supported size. Ask an admin to investigate.',
  INVALID_CALENDAR: 'The provider returned an invalid calendar. Retry or review the export.',
  PARTIAL_CALENDAR: 'Some events could not be safely interpreted. Review the source; missing events were preserved.',
  CONFIGURATION_ERROR: 'Calendar configuration or the blocked/unknown cleaning policy needs administrator review.',
  SYNC_FAILED: 'Sync failed. Retry; if it repeats, ask an administrator to investigate.',
};
