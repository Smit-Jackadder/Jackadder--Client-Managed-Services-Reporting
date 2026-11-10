import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { db } from '@vibe/db/server';
import { getCurrentUser } from '@api/current-user.server';
import { MondayRequestBoard, MondayIncidentsBoard } from '@api/BoardSDK';
import { harvestAdmins, harvestMembers } from '@generated/models';
import { hv, listEntries, getEntry, HvError, existingForUpload } from '@generated/server/harvest.server';
import { requireAdmin, memberAuth, loadProjects } from '@generated/server/admin.server';
import type { HvSession, WriteResult } from '@generated/lib/harvestTypes';
import { isDeletableTest } from '@generated/lib/harvestTypes';

const errMsg = (e: unknown) => (e instanceof HvError ? e.message : e instanceof Error ? e.message : 'Unknown error');
const none = z.object({}).optional();

/** Who I am, whether I'm an admin, the admin list and the team list (tokens never included). */
export const getAdminState = createServerFn({ method: 'POST' })
  .validator(none)
  .handler(async () => {
    const user = await getCurrentUser();
    const admins = await db.collection(harvestAdmins).limit(100).get();
    const me = user ? String(user.id) : null;
    const isAdmin = !!me && admins.some((a) => a.data.mondayUserId === me);
    const members = isAdmin ? await db.collection(harvestMembers).limit(200).get() : [];
    return {
      me, myName: user?.name ?? '', isAdmin, noAdminsYet: admins.length === 0,
      admins: admins.map((a) => ({ id: a.id, mondayUserId: a.data.mondayUserId, name: a.data.name })),
      members: members.map((m) => ({ id: m.id, mondayUserId: m.data.mondayUserId, name: m.data.name, harvestName: m.data.harvestName, harvestEmail: m.data.harvestEmail, accountId: m.data.harvestAccountId, emailMatch: m.data.harvestEmail.trim().toLowerCase() === m.data.mondayEmail.trim().toLowerCase(), updatedAt: m.data.updatedAt })),
    };
  });

/** First person to open the admin area becomes admin, only while no admin exists. */
export const claimAdmin = createServerFn({ method: 'POST' })
  .validator(none)
  .handler(async () => {
    const user = await getCurrentUser();
    if (!user || user.kind !== 'member') throw new Error('Sign in to monday first.');
    if ((await db.collection(harvestAdmins).count()) > 0) throw new Error('An admin already exists. Ask them to add you.');
    await db.collection(harvestAdmins).add({ mondayUserId: String(user.id), name: user.name, addedBy: String(user.id), addedAt: new Date().toISOString() });
    return { ok: true };
  });

/** People subscribed to the request and incident boards: the service team to choose from. */
export const getTeamCandidates = createServerFn({ method: 'POST' })
  .validator(none)
  .handler(async () => {
    await requireAdmin();
    const [a, b] = await Promise.all([new MondayRequestBoard().users.boardSubscribers().execute(), new MondayIncidentsBoard().users.boardSubscribers().execute()]);
    const map = new Map<string, { id: string; name: string; email: string }>();
    for (const u of [...(a ?? []), ...(b ?? [])]) if (u?.id) map.set(String(u.id), { id: String(u.id), name: String(u.name ?? ''), email: String(u.email ?? '') });
    return { people: [...map.values()].sort((x, y) => x.name.localeCompare(y.name)) };
  });

export const addAdmin = createServerFn({ method: 'POST' })
  .validator(z.object({ mondayUserId: z.string().regex(/^\d+$/), name: z.string().min(1).max(200) }))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    const dup = await db.collection(harvestAdmins).where('mondayUserId', '==', data.mondayUserId).limit(1).get();
    if (!dup.length) await db.collection(harvestAdmins).add({ mondayUserId: data.mondayUserId, name: data.name, addedBy: String(me.id), addedAt: new Date().toISOString() });
    return { ok: true };
  });

/** Remove an admin (including yourself, to hand the role over). The last admin cannot be removed. */
export const removeAdmin = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => {
    await requireAdmin();
    if ((await db.collection(harvestAdmins).count()) <= 1) throw new Error('Add another admin before removing the last one.');
    await db.collection(harvestAdmins).doc(data.id).delete();
    return { ok: true };
  });

/** Add or update a member's Harvest login. The token is checked against Harvest before saving. */
export const saveMember = createServerFn({ method: 'POST' })
  .validator(z.object({ mondayUserId: z.string().regex(/^\d+$/), name: z.string().min(1).max(200), token: z.string().min(10).max(500), accountId: z.string().regex(/^\d+$/) }))
  .handler(async ({ data }) => {
    const me = await requireAdmin();
    const auth = { token: data.token.trim(), accountId: data.accountId.trim() };
    const hu = await hv<{ id: number; email: string; first_name: string; last_name: string }>(auth, '/users/me').catch((e) => { throw new Error(`Harvest rejected this token: ${errMsg(e)}`); });
    const mu = await new MondayRequestBoard().users.where({ ids: [data.mondayUserId] }).withPagination({ limit: 1, page: 0 }).execute();
    const doc = { mondayUserId: data.mondayUserId, name: data.name, mondayEmail: String(mu?.[0]?.email ?? ''), harvestToken: auth.token, harvestAccountId: auth.accountId, harvestUserId: hu.id, harvestName: `${hu.first_name} ${hu.last_name}`.trim(), harvestEmail: hu.email, updatedBy: String(me.id), updatedAt: new Date().toISOString() };
    const existing = await db.collection(harvestMembers).where('mondayUserId', '==', data.mondayUserId).limit(1).get();
    if (existing[0]) await db.collection(harvestMembers).doc(existing[0].id).set(doc);
    else await db.collection(harvestMembers).add(doc);
    return { ok: true, emailMatch: !!doc.mondayEmail && doc.mondayEmail.toLowerCase() === hu.email.toLowerCase() };
  });

export const removeMember = createServerFn({ method: 'POST' })
  .validator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data }) => { await requireAdmin(); await db.collection(harvestMembers).doc(data.id).delete(); return { ok: true }; });

/** Connect to a member's Harvest with their stored login. */
export const memberConnect = createServerFn({ method: 'POST' })
  .validator(z.object({ memberId: z.string().min(1) }))
  .handler(async ({ data }): Promise<HvSession> => {
    await requireAdmin();
    const { doc, auth } = await memberAuth(data.memberId);
    const [hu, company, projects] = await Promise.all([
      hv<{ id: number; email: string; first_name: string; last_name: string }>(auth, '/users/me'),
      hv<{ name: string; wants_timestamp_timers: boolean }>(auth, '/company'),
      loadProjects(auth),
    ]);
    const mEmail = doc.data.mondayEmail;
    return { harvestUserId: hu.id, harvestEmail: hu.email, harvestName: `${hu.first_name} ${hu.last_name}`.trim(), mondayUserId: doc.data.mondayUserId, mondayEmail: mEmail, mondayName: doc.data.name, emailMatch: !!mEmail && mEmail.trim().toLowerCase() === hu.email.trim().toLowerCase(), timestampMode: !!company.wants_timestamp_timers, companyName: company.name, projects };
  });

export const memberEntries = createServerFn({ method: 'POST' })
  .validator(z.object({ memberId: z.string().min(1), from: z.string().optional(), to: z.string().optional() }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { doc, auth } = await memberAuth(data.memberId);
    return { entries: await listEntries(auth, doc.data.harvestUserId, data.from, data.to) };
  });

const body = z.object({
  project_id: z.number(), task_id: z.number(), spent_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string(),
  hours: z.number().min(0).max(24).optional(), started_time: z.string().optional(), ended_time: z.string().optional(),
  external_reference: z.object({ id: z.string(), group_id: z.string(), permalink: z.string() }),
});
const op = z.object({ rowKey: z.string(), kind: z.enum(['create', 'update']), entryId: z.number().optional(), ticket: z.string(), body, test: z.boolean() });

/** Write entries into the member's own Harvest timesheet. Same safety rules as personal uploads. */
export const memberWrite = createServerFn({ method: 'POST' })
  .validator(z.object({ memberId: z.string().min(1), ops: z.array(op).min(1).max(200) }))
  .handler(async ({ data }) => {
    await requireAdmin();
    const { doc, auth } = await memberAuth(data.memberId);
    const userId = doc.data.harvestUserId;
    const results: WriteResult[] = [];
    for (const o of data.ops) {
      try {
        if (o.test && ((o.kind !== 'create' && o.kind !== 'update') || !o.body.notes.startsWith('[TEST] ') || o.body.external_reference.group_id !== 'vibe-test' || !o.body.external_reference.id.startsWith('TEST:'))) throw new Error('Test mode only creates marked entries.');
        if (!o.test && o.body.external_reference.group_id === 'vibe-test') throw new Error('Live entries cannot use the test group.');
        let id: number;
        // Never create a second entry for the same item in the same period: update the existing one instead.
        let entryId = o.entryId;
        if (o.kind === 'create') {
          const found = await existingForUpload(auth, userId, o.body.external_reference.id, o.ticket, o.test);
          if (found.length > 1) throw new Error(`${found.length} entries already exist in Harvest for this ticket in this period. Delete the extra one first.`);
          entryId = found[0]?.id;
        }
        if (!entryId) {
          id = (await hv<{ id: number }>(auth, '/time_entries', { method: 'POST', body: { user_id: userId, ...o.body } })).id;
        } else {
          const cur = await getEntry(auth, entryId);
          if (cur.locked) throw new Error(`Entry is locked (${cur.lockedReason ?? 'locked'}).`);
          // Test mode may only update its own test entries; live mode never touches test entries.
          if (o.test !== isDeletableTest(cur)) throw new Error(o.test ? 'Test mode can only update test entries.' : 'Live mode cannot update a test entry.');
          id = (await hv<{ id: number }>(auth, `/time_entries/${entryId}`, { method: 'PATCH', body: o.body })).id;
        }
        results.push({ rowKey: o.rowKey, ok: true, entry: await getEntry(auth, id), error: null });
      } catch (e) {
        console.error('memberWrite', o.rowKey, e);
        results.push({ rowKey: o.rowKey, ok: false, entry: null, error: errMsg(e) });
      }
    }
    return { results };
  });
