import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mergeNotificationPage,type InboxItem} from '../../src/server/notifications/inbox';
const row=(id:string,time:number):InboxItem=>({id,createdAt:new Date(time*1000).toISOString(),body:id,href:'/',dismissible:true});
test('invitations interleave with dated notifications across pages without gaps or duplicates',async()=>{
 for(const count of [0,1,9,12,25]){
  const rows=Array.from({length:43},(_,i)=>row(`notification-${i}`,200-i*3));
  const pending=Array.from({length:count},(_,i)=>row(`invitation-${i}`,210-i*7));
  const expected=[...rows,...pending].sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||(a.id<b.id?1:-1));
  for(let offset=0;offset<expected.length+20;offset+=10){
   const actual=await mergeNotificationPage(offset,pending,async start=>({items:rows.slice(start,start+10),total:rows.length}));
   assert.equal(actual.total,expected.length);
   assert.deepEqual(actual.items,expected.slice(offset,offset+10));
  }
 }
});
