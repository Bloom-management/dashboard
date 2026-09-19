import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performanceQuery } from './query';
const request = (q:string) => new Request(`http://127.0.0.1/api/owner/performance?${q}`);
test('performance range uses strict exclusive dates and deduplicates selected properties',()=>{
 const id='00000000-0000-4000-8000-000000000001';
 assert.deepEqual(performanceQuery(request(`from=2024-01-01&toExclusive=2025-01-01&propertyId=${id}&propertyId=${id}`)),{from:'2024-01-01',toExclusive:'2025-01-01',properties:[id]});
});
test('performance rejects invalid or oversized dates and selection',()=>{
 for(const q of ['from=2025-02-30&toExclusive=2025-03-02','from=2025-01-01&toExclusive=2025-01-01','from=2024-01-01&toExclusive=2030-01-02','from=2025-01-01&toExclusive=2025-01-02&ownerId=bad','from=2025-01-01&toExclusive=2025-01-02&propertyId=bad']) assert.throws(()=>performanceQuery(request(q)));
});
