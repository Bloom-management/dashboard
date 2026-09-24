import {test} from 'node:test';
import assert from 'node:assert/strict';
import {findAddress} from '../../src/components/maps/geocode';
test('permanent explicit address lookup filters invalid coordinates and preserves source address',async t=>{
 let called:URL|undefined;t.mock.method(globalThis,'fetch',async(input:URL)=>{called=input;return Response.json({features:[{geometry:{coordinates:[-83.07,42.34]},properties:{full_address:'3628 Trumbull, Detroit'}},{geometry:{coordinates:[200,42]},properties:{full_address:'Invalid'}}]});});
 const results=await findAddress('3628 Trumbull, Detroit','pk.test');assert.equal(called?.searchParams.get('permanent'),'true');assert.equal(called?.searchParams.get('autocomplete'),'false');assert.equal(results.length,1);assert.equal(results[0].address,'3628 Trumbull, Detroit');
});
test('authorization/billing failure explains recovery without leaking token',async t=>{
 t.mock.method(globalThis,'fetch',async()=>new Response('',{status:403}));await assert.rejects(()=>findAddress('3628 Trumbull','pk.private-test'),/permanent-geocoding billing/);
});
test('invalid address does not call provider',async t=>{const fetch=t.mock.method(globalThis,'fetch',async()=>Response.json({}));await assert.rejects(()=>findAddress('bad;address','pk.test'));assert.equal(fetch.mock.callCount(),0);});
