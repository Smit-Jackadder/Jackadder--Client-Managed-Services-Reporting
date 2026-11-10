import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { MondayRequestBoard, MondayIncidentsBoard } from '@api/BoardSDK';
import { parseSessions, readDisplayId, toDay } from '@generated/server/helpers.server';
import { darwinDay } from '@generated/lib/darwin';
import { roundBillable } from '@generated/lib/rounding';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** One row = time logged on one ticket by one person within the period (total rounded once, like Client Billable Minutes). */
export interface UploadTicket {
  kind: 'request' | 'incident'; itemId: string; displayId: string | null; name: string; client: string | null;
  status: string | null; done: boolean; created: string | null; completed: string | null;
  closingNotes: string | null; pendingNotes: string | null; supportNotes: string | null;
  /** Client Billable Minutes on the board (ticket lifetime, for reference). */
  boardBillable: number | null;
  /** Last day worked in the period (default entry date); days lists every worked day. */
  workDay: string; days: string[]; periodKey: string; personId: string | null; personName: string;
  rawSeconds: number; minutes: number; sessions: number;
}

const DONE = { request: ['Completed', 'Closed'], incident: ['Resolved', 'Closed'] } as const;
const asStr = (v: unknown) => (v == null || v === '' ? null : String(v));
const num = (v: unknown) => { const m = String(v ?? '').replace(/[$,\s]/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

interface Base { kind: UploadTicket['kind']; itemId: string; displayId: string | null; name: string; client: string | null; status: string | null; created: string | null; completedRaw: string | null; closingNotes: string | null; pendingNotes: string | null; supportNotes: string | null; boardBillable: number | null; time: unknown; assignees: string[] }

/**
 * Every ticket for the client (any status), read from the "Time worked on Ticket" logs.
 * Sessions that started in [from, to] (Darwin day) are summed per ticket + person and
 * rounded with the 15-minute rule. Read-only.
 */
export const getUploadTickets = createServerFn({ method: 'POST' })
  .validator(z.object({ requestLabels: z.array(z.string()).min(1), incidentLabels: z.array(z.string()).min(1), from: day, to: day, assigneeId: z.string().regex(/^\d+$/).optional() }))
  .handler(async ({ data }) => {
    const base: Base[] = [];
    const errors: string[] = [];
    const req = new MondayRequestBoard();
    try {
      let cursor: string | null | undefined = undefined;
      do {
        const res = await req.items()
          .withColumns(['itemId', 'client', 'status', 'creationDate', 'dateCompleted', 'closingNotes', 'pendingNotes', 'supportTeamNotes', 'clientBillableMinutes', 'timeWorkedOnTicket', 'assignedTo'])
          .where({ client: data.requestLabels } as never)
          .withPagination(cursor ? { limit: 100, cursor } : { limit: 100 }).execute();
        for (const it of res?.items ?? []) base.push({ kind: 'request', itemId: String(it.id), displayId: readDisplayId(it.itemId), name: it.name ?? '', client: it.client ?? null, status: it.status ?? null, created: toDay(it.creationDate) ?? toDay(it.createdAt), completedRaw: toDay(it.dateCompleted), closingNotes: asStr(it.closingNotes), pendingNotes: asStr(it.pendingNotes), supportNotes: asStr(it.supportTeamNotes), boardBillable: num(it.clientBillableMinutes), time: it.timeWorkedOnTicket, assignees: (it.assignedTo ?? []).map((p) => String(p.id)) });
        cursor = res?.cursor ?? null;
      } while (cursor);
    } catch (e) { console.error('Monday Request fetch failed', e); errors.push(`Monday Request: ${errText(e)}`); }
    try {
      const inc = new MondayIncidentsBoard();
      let cursor: string | null | undefined = undefined;
      do {
        const res = await inc.items()
          .withColumns(['ticketId', 'client', 'status', 'creationDate', 'dateCompleted', 'resolutionDate', 'closingNotes', 'pendingNotes', 'supportTeamNotes', 'timeWorkedOnTicket', 'assignedTo'])
          .where({ client: data.incidentLabels } as never)
          .withPagination(cursor ? { limit: 100, cursor } : { limit: 100 }).execute();
        for (const it of res?.items ?? []) base.push({ kind: 'incident', itemId: String(it.id), displayId: readDisplayId(it.ticketId), name: it.name ?? '', client: it.client ?? null, status: it.status ?? null, created: toDay(it.creationDate) ?? toDay(it.createdAt), completedRaw: toDay(it.dateCompleted) ?? toDay(it.resolutionDate), closingNotes: asStr(it.closingNotes), pendingNotes: asStr(it.pendingNotes), supportNotes: asStr(it.supportTeamNotes), boardBillable: null, time: it.timeWorkedOnTicket, assignees: (it.assignedTo ?? []).map((p) => String(p.id)) });
        cursor = res?.cursor ?? null;
      } while (cursor);
    } catch (e) { console.error('Monday Incidents fetch failed', e); errors.push(`Monday Incidents: ${errText(e)}`); }

    const groups = new Map<string, UploadTicket>();
    let running = 0; let unreadable = 0; let notAssigned = 0;
    for (const b of base) {
    // Admin team upload: only tickets assigned to the chosen person, and only their own logged time.
    if (data.assigneeId && !b.assignees.includes(data.assigneeId)) continue;
      const parsed = parseSessions(b.time);
      if (!parsed.readable) { unreadable++; continue; }
      const done = !!b.status && (DONE[b.kind] as readonly string[]).includes(b.status);
      for (const s of parsed.sessions) {
        const d = darwinDay(s.startedAt);
        if (!d || d < data.from || d > data.to) continue;
        if (data.assigneeId && s.startedUserId !== data.assigneeId) continue;
        // Every person assigned to the ticket gets their own entry, but only for time they logged themselves.
        if (!s.startedUserId || !b.assignees.includes(s.startedUserId)) { if (s.endedAt && s.durationSec) notAssigned++; continue; }
        if (!s.endedAt || s.durationSec == null) { running++; continue; }
        const key = `${b.kind}|${b.itemId}|${s.startedUserId ?? ''}`;
        const g = groups.get(key) ?? { kind: b.kind, itemId: b.itemId, displayId: b.displayId, name: b.name, client: b.client, status: b.status, done, created: b.created, completed: done ? b.completedRaw : null, closingNotes: b.closingNotes, pendingNotes: b.pendingNotes, supportNotes: b.supportNotes, boardBillable: b.boardBillable, workDay: d, days: [] as string[], periodKey: `${data.from}_${data.to}`, personId: s.startedUserId, personName: '', rawSeconds: 0, minutes: 0, sessions: 0 };
        g.rawSeconds += s.durationSec; g.sessions++;
        if (d > g.workDay) g.workDay = d;
        if (!g.days.includes(d)) g.days.push(d);
        groups.set(key, g);
      }
    }
    const rows = [...groups.values()].filter((g) => g.rawSeconds > 0);
    for (const g of rows) g.minutes = roundBillable(g.rawSeconds);

    // Names of the people who logged time.
    const ids = [...new Set(rows.map((g) => g.personId).filter((x): x is string => !!x && /^\d+$/.test(x)))];
    const names: Record<string, string> = {};
    for (let i = 0; i < ids.length; i += 50) {
      try {
        const found = await req.users.where({ ids: ids.slice(i, i + 50) }).withPagination({ limit: 50, page: 0 }).execute();
        for (const u of found ?? []) if (u?.id && u?.name) names[String(u.id)] = u.name;
      } catch (e) { console.error('User lookup failed', e); }
    }
    for (const g of rows) g.personName = g.personId ? names[g.personId] ?? `User ${g.personId}` : '— (no user)';

    rows.sort((a, b) => a.workDay.localeCompare(b.workDay) || a.name.localeCompare(b.name));
    const tickets = new Set(rows.map((r) => `${r.kind}|${r.itemId}`)).size;
    return { tickets: rows, stats: { scanned: base.length, tickets, open: rows.filter((r) => !r.done).length, running, unreadable, notAssigned }, errors };
  });
