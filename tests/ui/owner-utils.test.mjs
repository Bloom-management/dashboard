import test from 'node:test';
import assert from 'node:assert/strict';
import { ownerRangeValid, timelineDays, timelineSegments, occupancyLabel } from '../../src/components/bloom/owner-utils.ts';
const block=(id,startDate,endDate)=>({id,startDate,endDate,propertyId:'p',propertyName:'Unit',timezone:'America/Detroit',providers:['airbnb'],kind:'reservation',removed:false,changes:[]});
test('owner dates are strict, end exclusive and independent of DST',()=>{
 assert.equal(timelineDays('2026-03-07','2026-03-10').length,3);
 assert.equal(timelineDays('2026-11-01','2026-11-03').length,2);
 assert.equal(ownerRangeValid('2026-02-30','2026-03-03'),false);
 assert.equal(ownerRangeValid('2026-09-18','2026-09-18'),false);
 assert.equal(ownerRangeValid('2026-01-01','2027-01-03'),false);
 assert.equal(ownerRangeValid('2024-01-01','2025-01-01'),true);
});
test('timeline clips long stays and keeps overlaps in one unit row with readable tracks',()=>{
 const result=timelineSegments([block('a','2026-08-30','2026-09-03'),block('b','2026-09-02','2026-09-06'),block('c','2026-09-03','2026-10-02'),block('excluded','2026-08-28','2026-09-01')],'2026-09-01','2026-10-01');
 assert.deepEqual(result.map(({start,end,lane})=>({start,end,lane})),[{start:0,end:2,lane:0},{start:1,end:5,lane:1},{start:2,end:30,lane:0}]);
});
test('owner percentages use fractions and keep unknown different from zero',()=>{
 assert.equal(occupancyLabel(null),'Unavailable');assert.equal(occupancyLabel(0),'0%');assert.equal(occupancyLabel(.375),'37.5%');
});

test('same-day events include the first visible date but never invent an occupied night',()=>{
 const result=timelineSegments([block('first','2026-09-01','2026-09-01'),block('middle','2026-09-18','2026-09-18'),block('last','2026-09-30','2026-09-30'),block('outside','2026-10-01','2026-10-01')],'2026-09-01','2026-10-01');
 assert.equal(result.length,3);
 assert.deepEqual(result.map(({start,end,sameDay})=>({start,end,sameDay})),[{start:0,end:0,sameDay:true},{start:17,end:17,sameDay:true},{start:29,end:29,sameDay:true}]);
});
