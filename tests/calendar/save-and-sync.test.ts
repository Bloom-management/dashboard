import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saveAndSync} from '../../src/server/calendar/save-and-sync';
import {CalendarError} from '../../src/server/calendar/errors';
import {calendarSaveMessage} from '../../src/contracts/calendar-save';
const outcome={runId:'run',status:'success' as const,created:2,updated:0,removed:0,unchanged:0,conflicts:0};
test('saving imports automatically and retries use the same bounded sync receipt',async()=>{
 const keys:string[]=[];let saved=false;
 const save=async()=>{saved=true;return {id:'source'};};
 const sync=async(id:string,key:string)=>{assert(saved);assert.equal(id,'source');keys.push(key);return outcome;};
 const first=await saveAndSync(save,sync,'x'.repeat(200));
 await saveAndSync(save,sync,'x'.repeat(200));
 assert.equal(first.sync.status,'success');assert.equal(keys[0],keys[1]);assert(keys[0].length<200);
 assert.match(calendarSaveMessage(first.sync),/import completed/);
});
test('failed import preserves the confirmed source and does not expose private errors',async()=>{
 for(const error of [new CalendarError('FETCH_TIMEOUT'),new Error('private calendar URL'),new CalendarError('private secret')]){
  const result=await saveAndSync(async()=>({id:'saved-source'}),async()=>{throw error;},'key');
  assert.equal(result.id,'saved-source');assert.equal(result.sync.status,'failed');
  assert.doesNotMatch(JSON.stringify(result),/private/);assert.match(calendarSaveMessage(result.sync),/link saved.*did not complete/i);
 }
});
test('rejected source creation never starts sync; partial import is not reported as success',async()=>{
 await assert.rejects(saveAndSync(async()=>{throw new Error('denied');},async()=>{assert.fail('must not sync');},'key'),/denied/);
 const result=await saveAndSync(async()=>({id:'source'}),async()=>({...outcome,status:'partial'}),'key');
 assert.match(calendarSaveMessage(result.sync),/incomplete/);assert.doesNotMatch(calendarSaveMessage(result.sync),/import completed/);
});
