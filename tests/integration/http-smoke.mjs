import assert from 'node:assert/strict';
const base=new URL(process.env.BLOOM_TEST_APP_URL??'http://127.0.0.1:3107');
assert.ok(['localhost','127.0.0.1','[::1]'].includes(base.hostname),'Smoke tests are local only');
const paths=['/me','/cities','/jobs?from=2026-09-01&to=2026-09-30','/owner/calendar?from=2026-09-01&to=2026-09-30','/owner/properties','/admin/users','/admin/property-options','/admin/calendar/sources','/jobs/00000000-0000-4000-8000-000000000001/photos'];
for(const path of paths){
 const r=await fetch(new URL('/api'+path,base),{redirect:'manual',signal:AbortSignal.timeout(10000)});
 assert.equal(r.status,401,path);const data=await r.json();assert.equal(data.error.code,'UNAUTHENTICATED',path);assert.equal('data' in data,false);console.log(`PASS anonymous denied: ${path}`);
}
for(const path of ['/','/cleaner','/owner','/admin','/onboarding']){
 const r=await fetch(new URL(path,base),{redirect:'manual',signal:AbortSignal.timeout(10000)});assert.ok([302,303,307,308].includes(r.status),path);console.log(`PASS protected page redirects: ${path}`);
}
console.log('14 anonymous HTTP checks passed. No signed-in or Storage workflow is implied.');
