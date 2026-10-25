import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCitySearch,type CityCache} from './city-cache';
import {encodePlace,decodePlace,type Place} from './cities';
test('shared cache normalizes searches, survives new instances, and deduplicates concurrent requests',async()=>{
 process.env.CALENDAR_ENCRYPTION_KEY='test-only-secret';
 const records=new Map<string,Place[]>();let requests=0;
 const cache:CityCache={async read(key){return records.get(key)??null;},async write(key,places){records.set(key,places);}};
 const search=async(name:string)=>{requests++;const place={id:name,name,region:'California',country:'US',label:name+', California, United States',timezone:'America/Los_Angeles'};return [{label:place.label,timezone:place.timezone,token:encodePlace(place)}];};
 const first=createCitySearch(cache,search);
 await Promise.all([first(' Los   Angeles '),first('los angeles')]);assert.equal(requests,1);
 const next=createCitySearch(cache,search);
 const result=await next('LOS ANGELES');assert.equal(requests,1);assert.equal(decodePlace(result[0].token).country,'US');
 await next('Bakersfield');assert.equal(requests,2);assert.equal(records.size,2);
});
