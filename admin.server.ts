// Server-only helpers for the admin team upload.
import { db } from '@vibe/db/server';
import { getCurrentUser } from '@api/current-user.server';
import { harvestAdmins, harvestMembers } from '@generated/models';
import { hv, type HvAuth } from '@generated/server/harvest.server';
import type { HvProject } from '@generated/lib/harvestTypes';

/** Throws unless the viewer is a listed admin. */
export async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.kind !== 'member') throw new Error('Sign in to monday to use admin features.');
  const found = await db.collection(harvestAdmins).where('mondayUserId', '==', String(user.id)).limit(1).get();
  if (!found.length) throw new Error('Only admins can do this.');
  return user;
}

/** Stored Harvest login for one member (server-side only). */
export async function memberAuth(memberId: string) {
  const doc = await db.collection(harvestMembers).doc(memberId).get();
  if (!doc) throw new Error('Team member not found.');
  const auth: HvAuth = { token: doc.data.harvestToken, accountId: doc.data.harvestAccountId };
  return { doc, auth };
}

interface PA { project: { id: number; name: string; code: string | null }; client: { name: string } | null; is_active: boolean; task_assignments: { is_active: boolean; billable: boolean | null; task: { id: number; name: string } }[] }

/** The member's active Harvest projects (their own assignments). */
export async function loadProjects(auth: HvAuth): Promise<HvProject[]> {
  const projects: HvProject[] = [];
  let page: number | null = 1;
  while (page) {
    const res: { project_assignments: PA[]; next_page: number | null } = await hv(auth, `/users/me/project_assignments?per_page=100&page=${page}`);
    for (const p of res.project_assignments ?? []) {
      if (!p.is_active) continue;
      projects.push({ id: p.project.id, name: p.project.name, code: p.project.code, clientName: p.client?.name ?? '', tasks: p.task_assignments.filter((t) => t.is_active).map((t) => ({ ...t.task, billable: t.billable !== false })) });
    }
    page = res.next_page ?? null;
  }
  return projects;
}
