import 'server-only';
import { authenticatedDatabase } from '../auth/session';
import { databaseError } from './errors';
export async function userRpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { db } = await authenticatedDatabase();
  const { data, error } = await db.rpc(name, args);
  if (error) databaseError(error);
  return data as T;
}
