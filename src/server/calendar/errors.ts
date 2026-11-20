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
  SYNC_FAILED: 'Sync failed. It retries automatically; if it repeats, ask an administrator to investigate.',
  // Database refusals, passed through so the real reason is visible.
  REVIEW_REQUIRED: 'A booking in this calendar needs review before its cleaning can be scheduled. Check the listing setup and Jobs.',
  INVALID_STATE: 'A cleaning linked to this calendar is already completed or cancelled, so the change could not be applied. Review it in Jobs.',
  CONFLICT: 'Another sync or edit was in progress. The next automatic sync will retry.',
  VALIDATION_ERROR: 'The calendar data or listing settings were not accepted. Check the listing timezone and calendar link.',
  NOT_FOUND: 'This listing or calendar link no longer exists.',
  FORBIDDEN: 'This account is not allowed to sync this calendar.',
  SOURCE_DISABLED: 'This calendar link is turned off.',
};
/** Database refusal codes the sync may record and show. Anything else stays SYNC_FAILED. */
export const databaseCodes = ['REVIEW_REQUIRED','INVALID_STATE','CONFLICT','VALIDATION_ERROR','NOT_FOUND','FORBIDDEN','SOURCE_DISABLED','CONFIGURATION_ERROR'] as const;
