/** Run manually using tsx, with explicitly supplied LOCAL Supabase configuration. */
import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const url = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://invalid.example');
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) throw new Error('Cleanup requires a local Supabase URL.');
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!key || key.startsWith('replace_')) throw new Error('Local service configuration is missing.');
const manifest = resolve(process.argv[2] ?? '/tmp/bloom-pending-photo-cleanup.json');
const db = createClient(url.toString(), key, { auth: { persistSession: false, autoRefreshToken: false } });
let paths: string[] = [];
try { paths = JSON.parse(await readFile(manifest, 'utf8')); }
catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Invalid cleanup manifest.'); }
if (!Array.isArray(paths) || paths.some(path => typeof path !== 'string' || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(path))) throw new Error('Invalid cleanup manifest.');
// Finish an earlier deletion batch before expiring another one. Never log paths or keys.
if (!paths.length) {
  const { data, error } = await db.rpc('bloom_expire_pending_photos', { p_limit: 100 });
  if (error) throw new Error('Unable to expire pending uploads.');
  paths = data as string[];
  await writeFile(manifest, JSON.stringify(paths), { mode: 0o600 });
}
if (paths.length) {
  const { error } = await db.storage.from('job-photos').remove(paths);
  if (error) throw new Error('Storage cleanup failed; retry with the same manifest.');
}
await writeFile(manifest, '[]', { mode: 0o600 });
console.log(`Removed ${paths.length} abandoned upload objects.`);
