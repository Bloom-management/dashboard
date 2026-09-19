import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { BackendError } from './errors';

/** Restricted to validated photo finalization/signing and calendar ingestion. */
export function privilegedDatabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || url.startsWith('replace_') || key.startsWith('replace_')) throw new BackendError('CONFIGURATION_ERROR');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
