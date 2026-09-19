import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOwnerAnalyticsRange} from '../../src/server/owner/range';
import {calculateOwnerPerformance} from '../../src/server/calendar/owner-metrics';
test('multi-year reads stay within SQL bounds and count cross-slice stays once',async()=>{
 const calls:string[][]=[];
 const result=await loadOwnerAnalyticsRange('2024-07-01','2026-09-01',async(from,to)=>{
  calls.push([from,to]);assert.ok((Date.parse(to)-Date.parse(from))/86400000<=366);
  return {properties:[{id:'unit',name:'Unit',timezone:'UTC',coverage:[]}],events:[{id:'stay',propertyId:'unit',startDate:'2025-06-29',endDate:'2025-07-03',kind:'reservation',removed:false,confirmed:true,origin:'airbnb'}]};
 });
 assert.equal(calls.length,3);assert.equal(result.events.length,1);
 const metrics=calculateOwnerPerformance(result,'2024-07-01','2026-09-01');
 assert.equal(metrics.totals.bookedNights,4);assert.equal(metrics.totals.checkIns,1);assert.equal(metrics.totals.occupancy,null);
});
test('authorization changes between slices fail the whole multi-year read',async()=>{
 let n=0;await assert.rejects(loadOwnerAnalyticsRange('2024-07-01','2026-09-01',async()=>({properties:++n===1?[{id:'unit',name:'Unit',timezone:'UTC',coverage:[]}]:[],events:[]})),{code:'CONFLICT'});
});
