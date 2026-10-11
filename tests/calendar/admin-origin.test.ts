import {test} from 'node:test';
import assert from 'node:assert/strict';
import {adminAnalyticsEvent} from '../../src/server/owner/admin-event';
import {calculateOwnerPerformance} from '../../src/server/calendar/owner-metrics';
import type {CalendarReviewEntry} from '../../src/contracts';
const event:CalendarReviewEntry={id:'event',sourceId:'source',provider:'airbnb',startDate:'2026-10-01',endDate:'2026-10-19',kind:'reservation',status:'active',reviewRequired:false,missingReason:null,evidence:'airbnb-reservation-link'};
test('verified Airbnb nights retain origin in admin platform share',()=>{
 const result=calculateOwnerPerformance({properties:[{id:'unit',name:'3628',timezone:'America/Detroit',coverage:[]}],events:[adminAnalyticsEvent('unit',event)]},'2026-10-01','2026-10-31');
 assert.equal(result.totals.platformShare.find(s=>s.platform==='airbnb')?.nights,18);
 assert.equal(result.totals.platformShare.find(s=>s.platform==='unknown')?.nights,0);
});
test('provider alone, blocks, review and manual returns never imply Airbnb origin',()=>{
 for(const patch of [{evidence:undefined},{evidence:'unverified'},{kind:'blocked'},{reviewRequired:true},{manualReturn:'ambiguous'},{manualReturn:'confirmed'}] as Partial<CalendarReviewEntry>[]){const result=adminAnalyticsEvent('unit',{...event,...patch});assert.equal(result.origin,'unknown');assert.equal(result.confirmed,false);}
 assert.equal(adminAnalyticsEvent('unit',{...event,manualReturn:'confirmed'}).removed,true);
 assert.equal(adminAnalyticsEvent('unit',{...event,status:'removed'}).removed,true);
});
