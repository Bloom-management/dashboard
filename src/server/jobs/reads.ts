import 'server-only';
import { authenticatedDatabase } from '../auth/session';
import { BackendError, databaseError } from '../db/errors';
/** Available before cleaner onboarding; cities are non-sensitive and RLS-scoped. */
export async function listCities(): Promise<{ id: string; name: string }[]> {
  const { db } = await authenticatedDatabase();
  const { data, error } = await db.from('cities').select('id,name').eq('active', true).order('name');
  if (error) databaseError(error);
  return data ?? [];
}
/** RLS checks a current open-job assignment independently of any displayed job card. */
export async function propertyEntryInstructions(propertyId: string): Promise<string> {
  const { db } = await authenticatedDatabase();
  const { data, error } = await db.from('property_entry_instructions').select('instructions').eq('property_id', propertyId).maybeSingle();
  if (error) databaseError(error);
  if (!data) throw new BackendError('NOT_FOUND');
  return data.instructions as string;
}
