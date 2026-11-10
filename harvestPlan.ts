import type { Group } from '@generated/lib/compute';
import { isTestish, TEST_GROUP, TEST_PREFIX, type HvEntry, type HvProject, type WriteBody } from '@generated/lib/harvestTypes';

export const BOARD_IDS = { request: '5027474596', incident: '5027474595' } as const;
export type Action = 'create' | 'update' | 'link' | 'in-sync' | 'skip-locked' | 'blocked';

export interface PlanRow {
  key: string; g: Group; ticket: string; minutes: number; hours: number; permalink: string;
  real: HvEntry[]; linkCandidate: HvEntry | null; tests: HvEntry[];
  action: Action; reason: string; duplicateForTesting: boolean; target: HvEntry | null;
}

const ticketId = (g: Group) => g.displayId ?? g.ticketId;
const near = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** Real entries for a ticket-day: linked by external_reference, otherwise by "<ticket ID>:" notes prefix. */
export function matchReal(g: Group, entries: HvEntry[]) {
  const real = entries.filter((e) => !isTestish(e) && e.date === g.day);
  const linked = real.filter((e) => e.refId === g.ticketId);
  const byNotes = real.filter((e) => !e.refId && e.notes.trim().startsWith(`${ticketId(g)}:`));
  return { linked, byNotes };
}

export function buildPlan(groups: Group[], entries: HvEntry[], testMode: boolean): PlanRow[] {
  return groups.map((g) => {
    const { linked, byNotes } = matchReal(g, entries);
    const tests = entries.filter((e) => isTestish(e) && e.date === g.day && e.refId === `TEST:${g.ticketId}`);
    const hours = Math.round((g.minutes / 60) * 100) / 100;
    const base = { key: `${g.kind}|${g.ticketId}|${g.day}`, g, ticket: `${ticketId(g)} ${g.ticketName}`, minutes: g.minutes, hours, permalink: `https://monday.com/boards/${BOARD_IDS[g.kind]}/pulses/${g.ticketId}`, real: [...linked, ...byNotes], linkCandidate: byNotes[0] ?? null, tests };
    if (testMode) {
      const dup = linked.length + byNotes.length > 0;
      return { ...base, action: 'create', reason: dup ? 'Duplicate for testing: a real entry exists for this ticket and day.' : tests.length ? 'A test entry already exists; this adds another.' : 'New test entry.', duplicateForTesting: dup, target: null };
    }
    if (linked.length > 1) return { ...base, action: 'blocked', reason: `${linked.length} linked entries for this ticket and day. Fix in Harvest first.`, duplicateForTesting: false, target: null };
    const t = linked[0];
    if (t) {
      if (t.locked) return { ...base, action: 'skip-locked', reason: `Locked: ${t.lockedReason ?? 'locked'}.`, duplicateForTesting: false, target: t };
      if (near(t.hours, hours)) return { ...base, action: 'in-sync', reason: 'Already matches.', duplicateForTesting: false, target: t };
      return { ...base, action: 'update', reason: `Harvest has ${t.hours} h; app has ${hours} h.`, duplicateForTesting: false, target: t };
    }
    if (byNotes.length > 1) return { ...base, action: 'blocked', reason: `${byNotes.length} unlinked entries start with "${ticketId(g)}:". Link one manually in Harvest.`, duplicateForTesting: false, target: null };
    const c = byNotes[0];
    if (c) {
      if (c.locked) return { ...base, action: 'skip-locked', reason: `Locked: ${c.lockedReason ?? 'locked'}.`, duplicateForTesting: false, target: c };
      return { ...base, action: 'link', reason: near(c.hours, hours) ? 'Matches by notes; will add the link.' : `Matches by notes; will link and set ${hours} h (was ${c.hours} h).`, duplicateForTesting: false, target: c };
    }
    return { ...base, action: 'create', reason: 'No Harvest entry yet.', duplicateForTesting: false, target: null };
  });
}

export const fmtClock = (min: number) => { const h = Math.floor(min / 60) % 24; const m = min % 60; return `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`; };

/** Request body for a row. Timestamp mode stacks entries per day from 9:00am. */
export function buildBody(r: PlanRow, o: { project: HvProject; taskId: number; closingNotes: string | null; testMode: boolean; timestampMode: boolean; startMin: number }): WriteBody {
  const notes = `${o.testMode ? TEST_PREFIX : ''}${ticketId(r.g)}: ${o.closingNotes?.trim() || r.g.ticketName}`;
  const b: WriteBody = {
    project_id: o.project.id, task_id: o.taskId, spent_date: r.g.day, notes,
    external_reference: o.testMode ? { id: `TEST:${r.g.ticketId}`, group_id: TEST_GROUP, permalink: r.permalink } : { id: r.g.ticketId, group_id: `monday-${BOARD_IDS[r.g.kind]}`, permalink: r.permalink },
  };
  if (o.timestampMode) { b.started_time = fmtClock(o.startMin); b.ended_time = fmtClock(o.startMin + r.minutes); }
  else b.hours = r.hours;
  return b;
}

export const defaultTask = (p: HvProject) => p.tasks.find((t) => !/on[\s-]?call/i.test(t.name)) ?? p.tasks[0] ?? null;
