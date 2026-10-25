import {test} from 'node:test';
import assert from 'node:assert/strict';
import {searchCities,decodePlace} from './cities';
test('search signs coordinate-derived timezones and rejects altered selections',async()=>{
 process.env.CALENDAR_ENCRYPTION_KEY='test-only-city-signing-secret';
 process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN='test-only';
 const original=globalThis.fetch;
 globalThis.fetch=async(input)=>{const url=new URL(String(input));assert.equal(url.searchParams.get('country'),'us');assert.equal(url.searchParams.get('permanent'),'true');return Response.json({features:[
  {name:'Detroit',region:'Michigan',coordinates:[-83.0458,42.3314]},
  {name:'Los Angeles',region:'California',coordinates:[-118.2437,34.0522]},
  {name:'Chicago',region:'Illinois',coordinates:[-87.6298,41.8781]},
 ].map(p=>({geometry:{coordinates:p.coordinates},properties:{mapbox_id:p.name,name:p.name,context:{region:{name:p.region},country:{country_code:'us',name:'United States'}}}}))});};
 try{
  const results=await searchCities('city');
  assert.deepEqual(results.map(p=>p.timezone),['America/Detroit','America/Los_Angeles','America/Chicago']);
  for(const result of results)assert.equal(decodePlace(result.token).timezone,result.timezone);
  const [value,mac]=results[0].token.split('.');
  const body=JSON.parse(Buffer.from(value,'base64url').toString());body.place.timezone='Europe/London';
  assert.throws(()=>decodePlace(Buffer.from(JSON.stringify(body)).toString('base64url')+'.'+mac));
 }finally{globalThis.fetch=original;}
});
