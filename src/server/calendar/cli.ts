/** Run with node --env-file=.env.local --import tsx src/server/calendar/cli.ts <source-uuid|--all> */
import { randomUUID } from 'node:crypto';
import { CalendarService } from './service';
import { rpcStore, serviceRpc } from './store';
import { safeCode } from './errors';
async function main() {
  const source = process.argv[2];
  if (source !== '--all' && !/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(source || '')) {
    process.stderr.write('Usage: calendar/cli.ts <source-uuid|--all>\n'); process.exitCode = 1; return;
  }
  const service = new CalendarService(rpcStore(serviceRpc(), null));
  const result = source === '--all' ? await service.scheduled(randomUUID()) : await service.sync(source, randomUUID());
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (Array.isArray(result) ? result.some(r => r.status === 'failed') : result.status === 'partial') process.exitCode = 1;
}
main().catch(error => { process.stderr.write(`${safeCode(error)}\n`); process.exitCode = 1; });
