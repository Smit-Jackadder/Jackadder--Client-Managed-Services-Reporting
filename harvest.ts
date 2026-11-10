import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { MondayRequestBoard, MondayIncidentsBoard } from '@api/BoardSDK';
import { hv, listEntries, getEntry, HvError, existingForUpload } from '@generated/server/harvest.server';
import type { HvSession, HvProject, WriteResult } from '@generated/lib/harvestTypes';
import { isDeletableTest } from '@generated/lib/harvestTypes';
import { parseSessions, readDisplayId, toDay } from '@generated/server/helpers.server';

const auth = z.object({ token: z.string().min(10), accountId: z.string().regex(/^\d+$/) });
const errMsg = (e: unknown) => (e instanceof HvError ? e.message : e instanceof Error ? e.message : 'Unknown error');

interface PA { project: { id: number; name: string; code: string | null }; client: { name: string } | null; is_active: boolean; task_assignments: { is_active: boolean; billable: boolean | null; task: { id: number; name: string } }[] }

/** Identify the person on both sides (email check), read company tracking mode and their projects. */
export const harvestConnect = createServerFn({ method: 'POST' })
  .validator(z.object({ auth }))
  .handler(async ({ data }): Promise<HvSession> => {
    const [me, company, mondayMe] = await Promise.all([
      hv<{ id: number; email: string; first_name: string; last_name: string }>(data.auth, '/users/me'),
      hv<{ name: string; wants_timestamp_timers: boolean }>(data.auth, '/company'),
      new MondayRequestBoard().users.me().execute(),
    ]);
    const projects: HvProject[] = [];
    let page: number | null = 1;
    while (page) {
      const res: { project_assignments: PA[]; next_page: number | null } = await hv<{ project_assignments: PA[]; next_page: number | null }>(data.auth, `/users/me/project_assignments?per_page=100&page=${page}`);
      for (const p of res.project_assignments ?? []) {
        if (!p.is_active) continue;
        projects.push({ id: p.project.id, name: p.project.name, code: p.project.code, clientName: p.client?.name ?? '', tasks: p.task_assignments.filter((t) => t.is_active).map((t) => ({ ...t.task, billable: t.billable !== false })) });
      }
      page = res.next_page ?? null;
    }
    const mEmail = String(mondayMe?.email ?? '');
    return {
      harvestUserId: me.id, harvestEmail: me.email, harvestName: `${me.first_name} ${me.last_name}`.trim(),
      mondayUserId: String(mondayMe?.id ?? ''), mondayEmail: mEmail, mondayName: String(mondayMe?.name ?? ''),
      emailMatch: !!mEmail && mEmail.trim().toLowerCase() === me.email.trim().toLowerCase(),
      timestampMode: !!company.wants_timestamp_timers, companyName: company.name, projects,
    };
  });

export const harvestEntries = createServerFn({ method: 'POST' })
  .validator(z.object({ auth, userId: z.number(), from: z.string().optional(), to: z.string().optional() }))
  .handler(async ({ data }) => ({ entries: await listEntries(data.auth, data.userId, data.from, data.to) }));

/** Closing Notes for the tickets being synced (read-only from monday). */
export const getClosingNotes = createServerFn({ method: 'POST' })
  .validator(z.object({ requestIds: z.array(z.string()), incidentIds: z.array(z.string()) }))
  .handler(async ({ data }) => {
    const notes: Record<string, string> = {}; const types: Record<string, string> = {};
    const req = new MondayRequestBoard(); const inc = new MondayIncidentsBoard();
    await Promise.all([
      ...data.requestIds.map(async (id) => { const it = await req.item(id).withColumns(['closingNotes', 'requestType']).execute(); if (it?.closingNotes) notes[id] = String(it.closingNotes); if (it?.requestType) types[id] = String(it.requestType); }),
      ...data.incidentIds.map(async (id) => { const it = await inc.item(id).withColumns(['closingNotes', 'category']).execute(); if (it?.closingNotes) notes[id] = String(it.closingNotes); if (it?.category) types[id] = String(it.category); }),
    ]);
    return { notes, types };
  });

/** One ticket's time-tracking sessions, for the per-ticket sync opened from a board button. */
export const getTicketForSync = createServerFn({ method: 'POST' })
  .validator(z.object({ kind: z.enum(['request', 'incident']), id: z.string().regex(/^\d+$/) }))
  .handler(async ({ data }) => {
    const it = data.kind === 'request'
      ? await new MondayRequestBoard().item(data.id).withColumns(['itemId', 'client', 'timeWorkedOnTicket']).execute()
      : await new MondayIncidentsBoard().item(data.id).withColumns(['ticketId', 'client', 'timeWorkedOnTicket']).execute();
    if (!it) return { ticket: null };
    const s = parseSessions(it.timeWorkedOnTicket);
    const displayId = readDisplayId((it as { itemId?: unknown }).itemId ?? (it as { ticketId?: unknown }).ticketId ?? null);
    return { ticket: { kind: data.kind, itemId: String(it.id), displayId, name: it.name ?? '', client: it.client ?? null, sessions: s.sessions, readable: s.readable } };
  });

/** Tickets completed in [from, to] (by Date Completed), with time sessions and Closing Notes. Read-only. */
export const getCompletedTickets = createServerFn({ method: 'POST' })
  .validator(z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }))
  .handler(async ({ data }) => {
    const out: { kind: 'request' | 'incident'; itemId: string; displayId: string | null; name: string; client: string | null; status: string | null; dateCompleted: string | null; closingNotes: string | null; workType: string | null; sessions: ReturnType<typeof parseSessions>['sessions']; readable: boolean }[] = [];
    const between = { between: { from: data.from, to: data.to } };
    let cursor: string | null | undefined = undefined;
    const req = new MondayRequestBoard();
    do {
      const res = await req.items()
        .withColumns(['itemId', 'client', 'status', 'dateCompleted', 'closingNotes', 'requestType', 'timeWorkedOnTicket'])
        .where({ status: ['Completed'], dateCompleted: between } as never)
        .withPagination(cursor ? { limit: 100, cursor } : { limit: 100 }).execute();
      for (const it of res?.items ?? []) { const s = parseSessions(it.timeWorkedOnTicket); out.push({ kind: 'request', itemId: String(it.id), displayId: readDisplayId(it.itemId), name: it.name ?? '', client: it.client ?? null, status: it.status ?? null, dateCompleted: toDay(it.dateCompleted), closingNotes: it.closingNotes ? String(it.closingNotes) : null, workType: it.requestType ?? null, sessions: s.sessions, readable: s.readable }); }
      cursor = res?.cursor ?? null;
    } while (cursor);
    const inc = new MondayIncidentsBoard();
    cursor = undefined;
    do {
      const res = await inc.items()
        .withColumns(['ticketId', 'client', 'status', 'dateCompleted', 'closingNotes', 'category', 'timeWorkedOnTicket'])
        .where({ status: ['Resolved'], dateCompleted: between } as never)
        .withPagination(cursor ? { limit: 100, cursor } : { limit: 100 }).execute();
      for (const it of res?.items ?? []) { const s = parseSessions(it.timeWorkedOnTicket); out.push({ kind: 'incident', itemId: String(it.id), displayId: readDisplayId(it.ticketId), name: it.name ?? '', client: it.client ?? null, status: it.status ?? null, dateCompleted: toDay(it.dateCompleted), closingNotes: it.closingNotes ? String(it.closingNotes) : null, workType: it.category ?? null, sessions: s.sessions, readable: s.readable }); }
      cursor = res?.cursor ?? null;
    } while (cursor);
    return { tickets: out };
  });

const body = z.object({
  project_id: z.number(), task_id: z.number(), spent_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), notes: z.string(),
  hours: z.number().min(0).max(24).optional(), started_time: z.string().optional(), ended_time: z.string().optional(),
  external_reference: z.object({ id: z.string(), group_id: z.string(), permalink: z.string() }),
});
const op = z.object({ rowKey: z.string(), kind: z.enum(['create', 'update', 'link']), entryId: z.number().optional(), ticket: z.string(), body, test: z.boolean() });

export const harvestWrite = createServerFn({ method: 'POST' })
  .validator(z.object({ auth, userId: z.number(), ops: z.array(op).min(1).max(200) }))
  .handler(async ({ data }) => {
    const results: WriteResult[] = [];
    for (const o of data.ops) {
      try {
        // Test mode may only create, and must carry both markers.
        if (o.test && ((o.kind !== 'create' && o.kind !== 'update') || !o.body.notes.startsWith('[TEST] ') || o.body.external_reference.group_id !== 'vibe-test' || !o.body.external_reference.id.startsWith('TEST:'))) throw new Error('Test mode only creates marked entries.');
        if (!o.test && o.body.external_reference.group_id === 'vibe-test') throw new Error('Live entries cannot use the test group.');
        let id: number;
        // Never create a second entry for the same item in the same period: update the existing one instead.
        let entryId = o.entryId;
        if (o.kind === 'create') {
          const found = await existingForUpload(data.auth, data.userId, o.body.external_reference.id, o.ticket, o.test);
          if (found.length > 1) throw new Error(`${found.length} entries already exist in Harvest for this ticket in this period. Delete the extra one first.`);
          entryId = found[0]?.id;
        }
        if (!entryId) {
          id = (await hv<{ id: number }>(data.auth, '/time_entries', { method: 'POST', body: { user_id: data.userId, ...o.body } })).id;
        } else {
          const cur = await getEntry(data.auth, entryId);
          if (cur.locked) throw new Error(`Entry is locked (${cur.lockedReason ?? 'locked'}).`);
          // Test mode may only update its own test entries; live mode never touches test entries.
          if (o.test !== isDeletableTest(cur)) throw new Error(o.test ? 'Test mode can only update test entries.' : 'Live mode cannot update a test entry.');
          id = (await hv<{ id: number }>(data.auth, `/time_entries/${entryId}`, { method: 'PATCH', body: o.body })).id;
        }
        results.push({ rowKey: o.rowKey, ok: true, entry: await getEntry(data.auth, id), error: null });
      } catch (e) {
        console.error('harvestWrite', o.rowKey, e);
        results.push({ rowKey: o.rowKey, ok: false, entry: null, error: errMsg(e) });
      }
    }
    return { results };
  });

/** Delete ONLY entries carrying both test markers that belong to this user. Re-verified server-side. */
export const harvestDeleteTests = createServerFn({ method: 'POST' })
  .validator(z.object({ auth, userId: z.number(), ids: z.array(z.number()).min(1).max(500) }))
  .handler(async ({ data }) => {
    const mine = new Map((await listEntries(data.auth, data.userId)).map((e) => [e.id, e]));
    const results: { id: number; ok: boolean; error: string | null; date: string; hours: number; notes: string }[] = [];
    for (const id of data.ids) {
      const e = mine.get(id);
      if (!e || !isDeletableTest(e)) { results.push({ id, ok: false, error: 'Not a test entry of yours; left untouched.', date: e?.date ?? '', hours: e?.hours ?? 0, notes: e?.notes ?? '' }); continue; }
      if (e.locked) { results.push({ id, ok: false, error: `Cannot delete: ${e.lockedReason ?? 'locked'}.`, date: e.date, hours: e.hours, notes: e.notes }); continue; }
      try { await hv(data.auth, `/time_entries/${id}`, { method: 'DELETE' }); results.push({ id, ok: true, error: null, date: e.date, hours: e.hours, notes: e.notes }); }
      catch (err) { console.error('harvestDelete', id, err); results.push({ id, ok: false, error: errMsg(err), date: e.date, hours: e.hours, notes: e.notes }); }
    }
    const remaining = (await listEntries(data.auth, data.userId)).filter(isDeletableTest).length;
    return { results, remaining };
  });
