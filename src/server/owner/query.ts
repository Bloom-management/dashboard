import { BackendError } from '../db/errors';
import { uuid } from '../db/http';
export function performanceQuery(request: Request) {
 const q = new URL(request.url).searchParams;
 if (q.getAll('from').length !== 1 || q.getAll('toExclusive').length !== 1 || [...q.keys()].some(key => !['from','toExclusive','propertyId'].includes(key))) throw new BackendError('VALIDATION_ERROR');
 const from = q.get('from')!; const toExclusive = q.get('toExclusive')!;
 for (const value of [from,toExclusive]) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) throw new BackendError('VALIDATION_ERROR');
 }
 const nights = (Date.parse(toExclusive)-Date.parse(from))/86_400_000;
 const ids = [...new Set(q.getAll('propertyId').map(uuid))];
 if (nights < 1 || nights > 1830 || ids.length > 100 || q.getAll('propertyId').length > 1000) throw new BackendError('VALIDATION_ERROR');
 return {from,toExclusive,properties:ids.length ? ids : null};
}
