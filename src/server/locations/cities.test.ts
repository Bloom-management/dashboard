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
test('metro Detroit counties register as the Detroit service city',async()=>{
 const {serviceArea}=await import('./cities');
 const base={country:'US',region:'Michigan',timezone:'America/Detroit'};
 for(const [name,district] of [['Dearborn Heights','Wayne County'],['Farmington Hills','Oakland County'],['Pontiac','Oakland County'],['Troy','Oakland County'],['Warren','Macomb County']]){
  const place=serviceArea({...base,id:name,name,label:name+', Michigan, United States',district});
  assert.equal(place.name,'Detroit');assert.equal(place.label,'Detroit, Michigan, United States');
 }
 const annArbor={...base,id:'aa',name:'Ann Arbor',label:'Ann Arbor, Michigan, United States',district:'Washtenaw County'};
 assert.equal(serviceArea(annArbor),annArbor);
 const otherWayne={...base,region:'Indiana',id:'w',name:'Fort Wayne',label:'Fort Wayne',district:'Allen County'};
 assert.equal(serviceArea(otherWayne),otherWayne);
 const address={...base,id:'dh',name:'Dearborn Heights',label:'x',district:'Wayne County',street:'1 Main St',latitude:42.3,longitude:-83.2};
 assert.equal(serviceArea(address).street,'1 Main St');
});
