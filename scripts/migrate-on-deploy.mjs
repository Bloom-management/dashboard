/**
 * Applies pending Supabase migrations before a Vercel *production* build, so code never
 * ships ahead of the schema it needs. Runs from `npm run build`; a no-op everywhere else.
 *
 * - Only when VERCEL_ENV=production. Preview/development builds never touch the database.
 * - Needs BLOOM_MIGRATION_DB_URL (Vercel env, Production scope only): the Supabase
 *   *session pooler* connection string (port 5432). Vercel builds have no IPv6, so the
 *   direct db.<ref>.supabase.co host will not connect.
 * - Missing secret: warns and continues (does not block deploys).
 * - A migration that fails: fails the build, so the previous deployment stays live.
 * - No --include-all: an out-of-order migration fails loudly instead of being applied
 *   silently against a newer schema.
 * The connection string is never printed.
 */
import { spawnSync } from 'node:child_process';

const CLI = 'supabase@2.117.0'; // Matches supabase/local-migrations.py; v3 rejects config.toml.
const log = message => console.log(`[Bloom migrate] ${message}`);

if (process.env.VERCEL_ENV !== 'production') {
  log(`Skipped (VERCEL_ENV=${process.env.VERCEL_ENV ?? 'unset'}); only production builds migrate.`);
  process.exit(0);
}
const url = process.env.BLOOM_MIGRATION_DB_URL?.trim();
if (!url) {
  log('WARNING: BLOOM_MIGRATION_DB_URL is not set; skipping migrations. Code may deploy ahead of the schema.');
  process.exit(0);
}
let parsed;
try { parsed = new URL(url); } catch { parsed = null; }
if (!parsed || !['postgres:', 'postgresql:'].includes(parsed.protocol)) {
  console.error('[Bloom migrate] BLOOM_MIGRATION_DB_URL is not a postgres:// connection string.');
  process.exit(1);
}

const redact = text => text.split(url).join('<redacted>').replace(/postgres(?:ql)?:\/\/[^\s"']+/g, 'postgres://<redacted>');
log(`Applying pending migrations to ${parsed.hostname} …`);
const result = spawnSync('npx', ['--yes', CLI, 'db', 'push', '--db-url', url, '--yes'], {
  encoding: 'utf8', input: 'Y\n', env: { ...process.env, SUPABASE_TELEMETRY_DISABLED: '1' }, maxBuffer: 16 * 1024 * 1024,
});
const output = redact(`${result.stdout ?? ''}${result.stderr ?? ''}`).trim();
if (output) console.log(output.split('\n').map(line => `[Bloom migrate] ${line}`).join('\n'));
if (result.error || result.status !== 0) {
  console.error('[Bloom migrate] Migration failed; stopping the build so the current deployment stays live.');
  process.exit(1);
}
log('Database schema is up to date.');
