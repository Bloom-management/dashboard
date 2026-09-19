/* SYNTHETIC BROWSER TEST ONLY. Inject into the isolated harness, never app routes. */
(() => {
  const nativeFetch = window.fetch.bind(window);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Detroit' }).format(new Date());
  const job = {
    id: 'synthetic-job', propertyId: 'synthetic-property', propertyName: 'Test property', cityId: 'synthetic-city',
    checkoutDate: today, startAt: new Date(Date.now() - 3600000).toISOString(), endAt: new Date(Date.now() + 10800000).toISOString(), timezone: 'America/Detroit',
    status: 'open', reviewRequired: false, version: 1, soloRateCents: 7500, sharedRateCents: 3750,
    activeCleanerCount: 1, myAssignmentId: null, myCompletedPayCents: null, changes: [],
  };
  const state = window.__bloomTest = { job, photos: [], calls: [], failClaim: false, failUpload: false, role: location.pathname.includes('owner') ? 'owner' : location.pathname.includes('admin') ? 'admin' : 'cleaner' };
  window.fetch = async (url, options = {}) => {
    const path = String(url);
    if (!path.startsWith('/api')) return nativeFetch(url, options);
    state.calls.push({ path, method: options.method, body: options.body, key: options.headers?.['Idempotency-Key'] });
    const ok = data => Promise.resolve(Response.json({ data }));
    if (path === '/api/me') return ok({ id: 'synthetic-user', role: state.role, displayName: 'Test user', approvedCityId: 'synthetic-city' });
    if (path.startsWith('/api/owner/calendar')) return ok([{ id: 'synthetic-block', propertyId: job.propertyId, propertyName: job.propertyName, timezone: job.timezone, startDate: today, endDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10), providers: ['airbnb', 'vrbo'], kind: 'reservation', removed: true, changes: [{ id: 'synthetic-change', type: 'removed', message: 'Synthetic source removal.', acknowledged: false }], cleanerName: 'SHOULD_NOT_RENDER', price: 9999 }]);
    if (path.startsWith('/api/jobs?')) return ok([job]);
    if (path.endsWith('/claim')) {
      if (state.failClaim) { job.activeCleanerCount = 2; return Response.json({ error: { code: 'JOB_FULL', message: 'Another cleaner took the last slot.', requestId: 'synthetic-request' } }, { status: 409 }); }
      job.activeCleanerCount = 2; job.myAssignmentId = 'synthetic-assignment'; job.version++; return ok(job);
    }
    if (path.endsWith('/photos')) return ok(state.photos);
    if (path.endsWith('/finalize')) { const photo = state.photos.find(photo => path.includes(photo.id)); photo.state = 'ready'; return ok(photo); }
    if (path.endsWith('/complete')) { job.status = 'completed'; job.myCompletedPayCents = 3750; return ok(job); }
    if (path.endsWith('/withdraw')) { job.myAssignmentId = null; job.activeCleanerCount--; return ok(job); }
    return Response.json({ error: { code: 'CONFIGURATION_ERROR', message: 'Synthetic route is not configured.', requestId: 'synthetic-request' } }, { status: 503 });
  };
})();
