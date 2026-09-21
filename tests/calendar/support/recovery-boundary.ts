/** Runs in an isolated process with synthetic identity/database transports. No network or live feeds. */
import { mock } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
const actor = '00000000-0000-4000-8000-000000000001';
const property = '00000000-0000-4000-8000-000000000010';
const source = '00000000-0000-4000-8000-000000000030';
const user = { id: actor, role: 'admin', displayName: 'Synthetic admin', approvedCityId: null };
const propertyRow = { id: property, name: 'Synthetic property', timezone: 'America/Detroit' };
const calls: string[] = [];
let enabled = false;
process.env.CLERK_SECRET_KEY = 'synthetic-clerk';
process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY = 'synthetic-clerk-public';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.invalid';
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'synthetic-public';
process.env.NEXT_PUBLIC_APP_URL = 'https://bloom.invalid';
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
delete process.env.CALENDAR_ENCRYPTION_KEY;
delete process.env.CALENDAR_SYNC_SECRET;
const token = `header.${Buffer.from(JSON.stringify({ role: 'authenticated' })).toString('base64url')}.synthetic`;
mock.module('@clerk/nextjs/server', { namedExports: { createClerkClient: () => { assert.fail('Calendar/account read checks must not construct an admin identity client'); }, currentUser: async () => { assert.fail('Unexpected profile lookup'); }, auth: async () => ({ userId: 'synthetic-subject', getToken: async () => token }) } });
mock.module('@supabase/supabase-js', { namedExports: { createClient: () => ({ rpc: async (name: string, args: Record<string, unknown>) => {
  calls.push(name);
  if (name === 'bloom_me') return { data: user, error: null, status: 200 };
  assert.equal(name, 'bloom_admin_property_options');
  if (args.p_id) assert.equal(args.p_id, property);
  return { data: { items: [propertyRow], nextCursor: null }, error: null };
} }) } });
mock.module('next/navigation', { namedExports: { redirect: () => { assert.fail('Calendar outage must not redirect authenticated admin'); } } });
// Client UI/style are stubbed only to exercise the actual server page without a browser.
mock.module(new URL('../../../src/components/bloom/connected.tsx', import.meta.url).href, { namedExports: { ConnectedHub: () => null } });
mock.module(new URL('../../../src/components/setup-unavailable.tsx', import.meta.url).href, { namedExports: { SetupUnavailable: () => null } });
const styleUrl = new URL('../../../src/styles/bloom-cleaner.css', import.meta.url).href;
register(`data:text/javascript,${encodeURIComponent(`export async function load(url, context, nextLoad) { if (url === ${JSON.stringify(styleUrl)}) return { format: 'module', source: 'export {};', shortCircuit: true }; return nextLoad(url, context); }`)}`, import.meta.url);
globalThis.fetch = async () => { assert.fail('No network transport is permitted'); };

const { currentUser } = await import('../../../src/server/auth/session');
const { requirePageRole } = await import('../../../src/server/auth/page-access');
const { integrationRead } = await import('../../../src/server/integration/reads');
const { dispatch } = await import('../../../src/server/db/dispatch');
const { propertyCalendar } = await import('../../../src/server/admin/property-calendar');
const { serviceRpc } = await import('../../../src/server/calendar/store');
const { default: AdminPage } = await import('../../../src/app/(admin)/admin/page');
const sourceRoutes = await import('../../../src/app/api/admin/properties/[id]/calendar-sources/route');
const syncRoute = await import('../../../src/app/api/admin/properties/[id]/calendar-sources/[sourceId]/sync/route');

// Actual server imports, factory initialization and account/page/property operations succeed without ingestion credentials.
const calendar = await propertyCalendar(property);
assert.equal(typeof serviceRpc(), 'function');
assert.deepEqual(await currentUser(), user);
assert.deepEqual(await requirePageRole('admin'), user);
const page = await AdminPage({ searchParams: Promise.resolve({ property }) });
assert.equal(page.props.role, 'admin'); assert.equal(page.props.initialPropertyId, property);
const me = await dispatch('me', new Request('https://bloom.invalid/api/me'));
assert.equal(me.status, 200); assert.deepEqual((await me.json()).data, user);
assert.deepEqual(await integrationRead('adminProperty', new Request('https://bloom.invalid'), property), propertyRow);
await assert.rejects(calendar.list(), { code: 'CONFIGURATION_ERROR', status: 503 });
assert.equal((await sourceRoutes.GET(new Request('https://bloom.invalid'), { params: Promise.resolve({ id: property }) })).status, 503);
assert(calls.every(name => ['bloom_me', 'bloom_admin_property_options'].includes(name)));

// Real route handlers + real calendar RPC transport; only the HTTP/database response is synthetic.
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic-service';
let propertyCalls = 0;
globalThis.fetch = async (input, init) => {
  const name = new URL(String(input)).pathname.split('/').at(-1);
  const args = JSON.parse(String(init?.body));
  assert.equal(name, 'bloom_calendar_property_sources');
  assert.deepEqual(args, { p_actor: actor, p_property: property, p_cursor: null }); propertyCalls++;
  return Response.json({ items: [{ id: source, propertyId: property, provider: 'vrbo', enabled,
    lastSuccessAt: null, lastAttemptAt: null, errorCode: 'CONFIGURATION_ERROR', encryptedUrl: 'private-secret' }], nextCursor: null });
};
const context = { params: Promise.resolve({ id: property }) };
const listed = await sourceRoutes.GET(new Request('https://bloom.invalid'), context);
assert.equal(listed.status, 200); const text = await listed.text();
assert(!text.includes('private-secret')); assert(text.includes('blocked/unknown'));
function mutation(body: unknown) { return new Request('https://bloom.invalid', { method: 'POST', headers: {
  origin: 'https://bloom.invalid', 'content-type': 'application/json', 'idempotency-key': 'synthetic-retry',
}, body: JSON.stringify(body) }); }
assert.equal((await sourceRoutes.POST(mutation({ provider: 'vrbo', url: 'synthetic', propertyId: property }), context)).status, 400);
assert.equal((await syncRoute.POST(mutation({}), { params: Promise.resolve({ id: property, sourceId: source }) })).status, 409);
enabled = true;
assert.equal((await syncRoute.POST(mutation({}), { params: Promise.resolve({ id: property, sourceId: '00000000-0000-4000-8000-000000000099' }) })).status, 404);
assert.equal(propertyCalls, 3);
// Calendar errors did not poison subsequent unrelated reads or the admin page authorization gate.
assert.deepEqual(await requirePageRole('admin'), user);
assert.deepEqual(await integrationRead('adminProperty', new Request('https://bloom.invalid'), property), propertyRow);
console.log('PASS actual account/admin authorization/property reads and scoped route handlers with calendar unavailable');
