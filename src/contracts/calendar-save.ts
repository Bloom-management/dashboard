import type {SyncResult} from './index';
export type CalendarSaveSync = (SyncResult & {status:'success'|'partial'|'not_modified'}) | {status:'failed';message:string};
export type CalendarSaveResult = {id:string;sync:CalendarSaveSync};
export function calendarSaveMessage(sync:CalendarSaveSync):string {
 if(sync.status==='failed')return `Calendar link saved. Import did not complete. ${sync.message}`;
 if(sync.status==='partial')return 'Calendar link saved. The export was incomplete; existing bookings were preserved. Review the source and retry Sync now.';
 if(sync.status==='not_modified')return 'Calendar link saved. Sync completed; the calendar is unchanged.';
 return `Calendar link saved and import completed: ${sync.created} added, ${sync.updated} updated, ${sync.removed} removed.`;
}
