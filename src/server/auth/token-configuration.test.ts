import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSupabaseTokenConfiguration, ClerkIntegrationRequired } from './token-configuration';
const fixture=(claims:unknown)=>`synthetic.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic`;
test('requires the authenticated database claim, not a Bloom business role',()=>{
 assert.doesNotThrow(()=>assertSupabaseTokenConfiguration(fixture({role:'authenticated'})));
 for(const role of [undefined,null,'anon','admin','owner','cleaner','service_role']) assert.throws(()=>assertSupabaseTokenConfiguration(fixture({role})),ClerkIntegrationRequired);
 assert.throws(()=>assertSupabaseTokenConfiguration('malformed'),ClerkIntegrationRequired);
});
