import {createHash} from 'node:crypto';
import {actions,safeCode} from './errors';
import type {SyncOutcome} from './types';
import type {CalendarSaveSync} from '../../contracts/calendar-save';
/** Creation and import are separate commits. Replaying a lost save response reuses
 * both receipts; a later explicit Sync now gets a fresh sync receipt. */
export async function saveAndSync<T extends {id:string}>(save:()=>Promise<T>,sync:(id:string,key:string)=>Promise<SyncOutcome>,key:string):Promise<T & {sync:CalendarSaveSync}>{
 const source=await save();
 const syncKey='initial-sync:'+createHash('sha256').update(JSON.stringify([source.id,key])).digest('hex');
 try{return {...source,sync:await sync(source.id,syncKey)};}
 catch(error){const code=safeCode(error);return {...source,sync:{status:'failed',message:Object.hasOwn(actions,code)?actions[code]:actions.SYNC_FAILED}};}
}
