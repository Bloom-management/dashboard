import {clerkClient} from '@clerk/nextjs/server';
import {profileAvatar} from '../../lib/avatar';
import {privilegedDatabase} from '../db/privileged';
import {databaseError} from '../db/errors';

export type JobCleaner = {id: string; slot: number; displayName: string; avatarUrl: string | null};

/**
 * Cleaners on a job's active assignments (completion keeps them active, so for a completed job these are
 * the cleaners who did it), with Clerk names and avatars. Callers must authorize the job before calling.
 */
export async function jobCleaners(jobId: string): Promise<JobCleaner[]> {
  const db = privilegedDatabase();
  const team = await db.from('assignments').select('cleaner_id,slot,users!cleaner_id(display_name,clerk_user_id)').eq('job_id', jobId).is('ended_at', null).order('slot');
  if (team.error) databaseError(team.error);
  const rows = (team.data ?? []).map(row => ({id: row.cleaner_id as string, slot: row.slot as number, profile: row.users as unknown as {display_name: string | null; clerk_user_id: string} | null}));
  const names = new Map<string, string>(), avatars = new Map<string, string>();
  try {
    const subjects = rows.flatMap(row => row.profile?.clerk_user_id ? [row.profile.clerk_user_id] : []);
    if (subjects.length) {
      const client = await clerkClient();
      const profiles = await client.users.getUserList({userId: subjects, limit: 100});
      for (const profile of profiles.data) {
        const name = [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() || profile.username;
        if (name) names.set(profile.id, name);
        avatars.set(profile.id, profileAvatar(profile));
      }
    }
  } catch { /* Saved display names remain available during provider outages. */ }
  return rows.map(row => ({id: row.id, slot: row.slot, avatarUrl: avatars.get(row.profile?.clerk_user_id ?? '') ?? null, displayName: names.get(row.profile?.clerk_user_id ?? '') || row.profile?.display_name || 'Cleaner'}));
}
