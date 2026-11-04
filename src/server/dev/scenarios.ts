import 'server-only';

import { requireAdmin } from '../auth/session';
import { BackendError, databaseError } from '../db/errors';
import { choice, uuid } from '../db/http';
import { privilegedDatabase } from '../db/privileged';

export const scenarioSteps = ['assigned', 'progress', 'photos', 'supplies', 'maintenance', 'guest'] as const;
export type ScenarioStep = typeof scenarioSteps[number];

// Local development is enabled automatically. A hosted staging environment must
// opt in explicitly; production intentionally has no default path to enable this.
export function scenariosEnabled() {
  return process.env.NODE_ENV === 'development' || process.env.BLOOM_TEST_SCENARIOS === 'enabled';
}

function assertEnabled() {
  if (!scenariosEnabled()) throw new BackendError('NOT_FOUND');
}

function isoDate(offset = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

export async function scenarioCatalog() {
  assertEnabled();
  await requireAdmin();
  const db = privilegedDatabase();
  const [properties, cleaners] = await Promise.all([
    db.from('properties').select('id,name,city_id,cleaning_config').eq('active', true).not('cleaning_config', 'is', null).order('name'),
    db.from('users').select('id,display_name,approved_city_id').eq('role', 'cleaner').not('onboarding_completed_at', 'is', null).order('display_name'),
  ]);
  if (properties.error) databaseError(properties.error);
  if (cleaners.error) databaseError(cleaners.error);
  return {
    properties: (properties.data ?? []).map(property => ({ id: property.id, name: property.name, cityId: property.city_id })),
    cleaners: (cleaners.data ?? []).map(cleaner => ({ id: cleaner.id, name: cleaner.display_name || 'Unnamed cleaner', cityId: cleaner.approved_city_id })),
  };
}

export async function createScenario(input: unknown) {
  assertEnabled();
  await requireAdmin();
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new BackendError('VALIDATION_ERROR');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['propertyId', 'cleanerId', 'step'].includes(key))) throw new BackendError('VALIDATION_ERROR');
  const propertyId = uuid(value.propertyId);
  const cleanerId = uuid(value.cleanerId);
  const step = choice(value.step, scenarioSteps);
  const db = privilegedDatabase();
  const [{ data: property, error: propertyError }, { data: cleaner, error: cleanerError }] = await Promise.all([
    db.from('properties').select('id,name,city_id,timezone,solo_rate_cents,cleaning_config').eq('id', propertyId).eq('active', true).maybeSingle(),
    db.from('users').select('id,display_name,role,onboarding_completed_at').eq('id', cleanerId).maybeSingle(),
  ]);
  if (propertyError) databaseError(propertyError);
  if (cleanerError) databaseError(cleanerError);
  if (!property || !property.cleaning_config || !cleaner || cleaner.role !== 'cleaner' || !cleaner.onboarding_completed_at) throw new BackendError('VALIDATION_ERROR');

  // Keep the scenario in the current calendar month, while avoiding a property's
  // unique checkout-date constraint when several examples are created.
  let checkoutDate = '';
  for (let offset = 0; offset < 62; offset += 1) {
    const candidate = isoDate(offset);
    const { data, error } = await db.from('jobs').select('id').eq('property_id', property.id).eq('checkout_date', candidate).maybeSingle();
    if (error) databaseError(error);
    if (!data) { checkoutDate = candidate; break; }
  }
  if (!checkoutDate) throw new BackendError('CONFLICT');

  const now = new Date();
  const started = step !== 'assigned';
  const { data: job, error: jobError } = await db.from('jobs').insert({
    property_id: property.id,
    checkout_date: checkoutDate,
    start_at: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
    end_at: new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString(),
    timezone_snapshot: property.timezone,
    solo_rate_cents_snapshot: property.solo_rate_cents,
    ...(started ? { started_at: now.toISOString(), started_by: cleaner.id } : {}),
  }).select('id').single();
  if (jobError || !job) databaseError(jobError);
  const { error: assignmentError } = await db.from('assignments').insert({ job_id: job.id, cleaner_id: cleaner.id, slot: 1 });
  if (assignmentError) databaseError(assignmentError);

  const journeyStep = step === 'assigned' ? undefined : step;
  const query = new URLSearchParams({ job: job.id, ...(journeyStep ? { devStep: journeyStep } : {}) });
  return { jobId: job.id, propertyName: property.name, cleanerName: cleaner.display_name || 'Cleaner', cleanerPath: `/cleaner?${query}` };
}
