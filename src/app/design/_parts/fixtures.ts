/* Design gallery fixtures. Synthetic data only; used by the admin-only /design frames, never by app routes. */
import type { CleanerJob, SessionUser } from '../../../contracts';
import type { BloomIntegration } from '../../../components/bloom/integration';

const HOUR = 3600000;
const tz = 'America/Detroit';
export const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
const at = (offsetHours: number) => new Date(Date.now() + offsetHours * HOUR).toISOString();

export const cleanerUser: SessionUser = { id: 'design-cleaner', role: 'cleaner', displayName: 'Alex Rivera', approvedCityId: 'design-detroit', bloomPoolStatus: 'approved', bloomNetworkEnabled: true };

function job(id: string, name: string, overrides: Partial<CleanerJob>): CleanerJob {
  return {
    id, propertyId: `prop-${id}`, propertyName: name, cityId: 'design-detroit', checkoutDate: today,
    startAt: at(-1), endAt: at(3), timezone: tz, checkInAt: null, started: false,
    status: 'open', reviewRequired: false, version: 1, soloRateCents: 7500, sharedRateCents: 3750,
    activeCleanerCount: 0, myAssignmentId: null, myCompletedPayCents: null, management: 'bloom', payerName: 'Bloom', capacity: 2, changes: [],
    ...overrides,
  };
}

/** One job per visual state: check-in tone × slots × assignment × status. */
export const jobs: CleanerJob[] = [
  job('urgent', '3628 Trumbull', { startAt: at(-1), endAt: at(2), checkInAt: at(2.5), activeCleanerCount: 1 }),
  job('soon', '1420 Brush Park Lofts', { startAt: at(1), endAt: at(5), checkInAt: at(6) }),
  job('calm', '88 Corktown Row', { startAt: at(-2), endAt: at(2), checkInAt: at(26) }),
  job('none', 'Midtown Studio 4B', { activeCleanerCount: 2, checkInAt: null }),
  job('mine', '512 West Canfield', { activeCleanerCount: 1, myAssignmentId: 'design-assignment', checkInAt: at(5) }),
  job('review', 'Eastern Market Flat', { reviewRequired: true, checkInAt: at(4) }),
  job('private', 'Woodbridge House', { management: 'private', payerName: 'Jordan Lee', myAgreedPayCents: 6000, checkInAt: at(7) }),
  job('done', 'Lafayette Park 12', { status: 'completed', activeCleanerCount: 1, startAt: at(-6), endAt: at(-2), checkInAt: at(1) }),
];
export const jobById = (id: string) => jobs.find(item => item.id === id) ?? jobs[0];

const config = {
  version: 1,
  rooms: [
    { id: 'r-bed', type: 'bedrooms', label: 'Bedroom', requiredPhoto: true },
    { id: 'r-bath', type: 'bathrooms', label: 'Bathroom', requiredPhoto: true },
    { id: 'r-kit', type: 'kitchen', label: 'Kitchen', requiredPhoto: true },
    { id: 'r-liv', type: 'living_room', label: 'Living room', requiredPhoto: true },
  ],
  supplies: [{ id: 's-tp', name: 'Toilet paper' }, { id: 's-soap', name: 'Dish soap' }, { id: 's-coffee', name: 'Coffee pods' }],
};

/** Existing listings, including one shared house, so the room flow can offer a house. */
export const designListings = [
  { id: 'design-l1', name: '3628 Trumbull', houseId: null, houseName: null },
  { id: 'design-l2', name: 'Corktown House · Room A', houseId: 'design-house', houseName: 'Corktown House' },
] as never[];

export const designIntegration: BloomIntegration = {
  listCities: async () => [{ id: 'design-detroit', name: 'Detroit', active: true }, { id: 'design-ann-arbor', name: 'Ann Arbor', active: true }],
  getMyCityRequest: async () => null,
  getInstructions: async () => ({ instructions: 'Lockbox on the side door. Leave keys on the kitchen counter.', address: '3628 Trumbull Ave, Detroit, MI' }),
  ownerProperties: async () => jobs.map(item => ({ id: item.propertyId, name: item.propertyName })),
  accountControl: () => null,
};

function routes(path: string, method: string): unknown {
  const url = new URL(path, location.origin);
  const p = url.pathname.replace(/^\/api/, '');
  const id = p.match(/^\/jobs\/([^/]+)\//)?.[1];
  if (p === '/me') return cleanerUser;
  if (p === '/jobs') return jobs;
  if (p === '/jobs/pins') return jobs.map((item, index) => ({ jobId: item.id, latitude: 42.33 + index * 0.012, longitude: -83.06 - index * 0.01 }));
  if (p === '/cities') return [{ id: 'design-detroit', name: 'Detroit', active: true }];
  if (p === '/city-change-requests/current') return null;
  if (p === '/notifications') return { items: [], unread: 0, hasMore: false };
  if (p === '/cleaner/team-invitations') return { items: [] };
  if (p === '/property-invitations') return [];
  if (p === '/cleaner/payouts') return { owed: [], paid: [], preference: null, totalOwedCents: 0 };
  if (p.endsWith('/access-info')) return { info: { entryType: 'lockbox', code: '4821', entryNotes: 'Side door lockbox.', parking: ['street'], garageCode: '', parkingNotes: 'Free street parking.', version: 1 }, instructions: 'Leave keys on the counter.', canEdit: false };
  if (id) {
    const current = jobById(id);
    if (p.endsWith('/team')) return Array.from({ length: current.activeCleanerCount }, (_, slot) => ({ id: `c${slot}`, displayName: slot ? 'Sam Patel' : 'Alex Rivera', avatarUrl: null, slot }));
    if (p.endsWith('/photos')) return [];
    if (p.endsWith('/supplies')) return { supplies: config.supplies, reports: [{ supplyId: 's-tp', level: 'low', reportedAt: at(-30) }] };
    if (p.endsWith('/details')) return { instructions: 'Lockbox on the side door.', address: '3628 Trumbull Ave' };
    if (p.endsWith('/journey') || p.endsWith('/start')) return { job: current, config, startedAt: p.endsWith('/start') ? new Date().toISOString() : null, startedBy: null, previousReports: [], previousMaintenance: [], receipt: null };
    if (p.endsWith('/handoff')) return { revision: 0, draft: null, senderId: null, senderName: null, missing: [] };
    if (p.endsWith('/claim')) return { ...current, activeCleanerCount: current.activeCleanerCount + 1, myAssignmentId: 'design-assignment', version: current.version + 1 };
  }
  void method;
  return undefined;
}

/** Answers same-origin /api calls from fixtures so dialogs and hubs render without a session. */
export function installDesignFetch() {
  if (typeof window === 'undefined' || (window as { __bloomDesign?: boolean }).__bloomDesign) return;
  (window as { __bloomDesign?: boolean }).__bloomDesign = true;
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const path = typeof input === 'string' ? input : input instanceof URL ? input.pathname + input.search : input.url;
    if (!path.startsWith('/api') && !path.startsWith(`${location.origin}/api`)) return nativeFetch(input, init);
    const data = routes(path.replace(location.origin, ''), init?.method ?? 'GET');
    if (data === undefined) return Response.json({ error: { code: 'CONFIGURATION_ERROR', message: `Design fixture missing for ${path}`, requestId: 'design' } }, { status: 503 });
    return Response.json({ data });
  };
}
