import type { UploadTicket } from '@generated/server/upload';
import { BOARD_IDS, fmtClock } from '@generated/lib/harvestPlan';
import { entryIsForItem, TEST_GROUP, TEST_PREFIX, type HvEntry, type WriteBody } from '@generated/lib/harvestTypes';

export interface UploadRow {
  key: string; t: UploadTicket; date: string; taskId: number | null; notes: string; minutes: number | null;
}
export interface Change { field: string; from: string; to: string }
export type UploadAction = { kind: 'create' | 'update'; entry: HvEntry | null; label: string; changes?: Change[] } | { kind: 'skip'; entry: HvEntry | null; label: string; changes?: Change[] };

export const ticketLabel = (t: UploadTicket) => t.displayId ?? t.itemId;
export const permalink = (t: UploadTicket) => `https://monday.com/boards/${BOARD_IDS[t.kind]}/pulses/${t.itemId}`;
export const parseMinutes = (raw: string | null) => { const m = (raw ?? '').replace(/[$,\s]/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
/** Rows the user can still fix in the table (task, minutes, date) stay selectable for bulk updates. */
export const FIXABLE = ['Pick a task.', 'No billable minutes.', 'No date.'];
export const selectable = (a: { kind: string; label: string }) => a.kind !== 'skip' || FIXABLE.includes(a.label);
export const toHours = (min: number) => Math.round((min / 60) * 100) / 100;

/** Harvest link id: one entry per ticket per selected period. */
export const refIdFor = (t: UploadTicket) => `${t.itemId}@${t.periodKey}`;

export function initialRow(t: UploadTicket): UploadRow {
  // Finished tickets → Closing Notes; open tickets → Pending Notes, else Support Team Notes (fallback: ticket name).
  const text = (t.done ? t.closingNotes : t.pendingNotes?.trim() || t.supportNotes)?.trim() || '';
  // Ticket name is part of the entry so renaming the ticket on the board is picked up on re-upload.
  const head = t.name.trim() ? `${ticketLabel(t)} – ${t.name.trim()}` : ticketLabel(t);
  return { key: `${t.kind}|${t.itemId}|${t.personId ?? ''}`, t, date: t.workDay, taskId: null, notes: text ? `${head}: ${text}` : head, minutes: t.minutes };
}

/** What happens to a row. Real entries are linked by external_reference id = "<item id>@<worked day>". */
export function actionFor(r: UploadRow, entries: HvEntry[], testMode: boolean, projectId: number | null, myMondayId?: string | null, taskName?: (id: number | null) => string): UploadAction {
  const real = linkedEntries(r, entries);
  const e = real[0] ?? null;
  if (!projectId) return { kind: 'skip', entry: e, label: 'Sync to Harvest first to load the project and tasks.' };
  if (myMondayId && r.t.personId !== myMondayId) return { kind: 'skip', entry: e, label: `Logged by ${r.t.personName}; only your own time can be uploaded to your timesheet.` };
  if (!r.taskId) return { kind: 'skip', entry: e, label: 'Pick a task.' };
  if (r.minutes == null || r.minutes <= 0) return { kind: 'skip', entry: e, label: 'No billable minutes.' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.date)) return { kind: 'skip', entry: e, label: 'No date.' };
  if (testMode) {
    const t = linkedEntries(r, entries, true)[0];
    const tests = linkedEntries(r, entries, true);
    if (tests.length > 1) return { kind: 'skip', entry: t ?? null, label: `${tests.length} test entries already linked to this ticket for this period. Remove test entries first.` };
    if (t) {
      if (t.locked) return { kind: 'skip', entry: t, label: `Locked: ${t.lockedReason ?? 'approved or closed'}` };
      const ch = changesFor(r, t, projectId, taskName, true);
      return ch.length ? { kind: 'update', entry: t, label: `Already uploaded as test entry (#${t.id}) · changes made after upload. Update this entry?`, changes: ch } : { kind: 'skip', entry: t, label: `Already uploaded as test entry (#${t.id}) · no changes` };
    }
    if (e) {
      const ch = changesFor(r, e, projectId, taskName);
      return { kind: 'skip', entry: e, label: ch.length ? `Already uploaded to Harvest (#${e.id}) · changes made after upload. Turn off test mode to update this entry.` : `Already uploaded to Harvest (#${e.id}) · no changes`, changes: ch };
    }
    return { kind: 'create', entry: null, label: 'Create test entry' };
  }
  if (real.length > 1) return { kind: 'skip', entry: e, label: `${real.length} Harvest entries already linked to this ticket for this period. Delete the extra one in Harvest, then fetch again to update.`, changes: e ? changesFor(r, e, projectId, taskName) : [] };
  if (!e) return { kind: 'create', entry: null, label: 'Create' };
  if (e.locked) return { kind: 'skip', entry: e, label: `Locked: ${e.lockedReason ?? 'approved or closed'}` };
  const changes = changesFor(r, e, projectId, taskName);
  return changes.length ? { kind: 'update', entry: e, label: `Already uploaded (#${e.id}) · changes made after upload. Update this entry?`, changes } : { kind: 'skip', entry: e, label: `Already in Harvest (#${e.id}) · no changes` };
}

export function bodyFor(r: UploadRow, projectId: number, testMode: boolean, timestampMode: boolean, startMin: number): WriteBody {
  const b: WriteBody = {
    project_id: projectId, task_id: r.taskId!, spent_date: r.date, notes: `${testMode ? TEST_PREFIX : ''}${r.notes}`,
    external_reference: testMode ? { id: `TEST:${refIdFor(r.t)}`, group_id: TEST_GROUP, permalink: permalink(r.t) } : { id: refIdFor(r.t), group_id: `monday-${BOARD_IDS[r.t.kind]}`, permalink: permalink(r.t) },
  };
  const min = Math.round(r.minutes ?? 0);
  if (timestampMode) { b.started_time = fmtClock(startMin); b.ended_time = fmtClock(startMin + min); } else b.hours = toHours(r.minutes ?? 0);
  return b;
}

/**
 * Harvest entries already uploaded for this ticket. Matched by monday item ID: first the exact
 * ticket + period link, otherwise any entry for the same item ID dated inside the selected period
 * (so a week and a month covering the same days are recognised as the same upload).
 */
export function linkedEntries(r: UploadRow, entries: HvEntry[], tests = false): HvEntry[] {
  // Scan the whole selected period (not just the row's entry date) for any entry of this item.
  const [from, to] = r.t.periodKey.split('_');
  if (!from || !to) return [];
  const ref = tests ? `TEST:${refIdFor(r.t)}` : refIdFor(r.t);
  const found = entries.filter((e) => e.date >= from && e.date <= to && entryIsForItem(e, r.t.itemId, ticketLabel(r.t), tests));
  // Exact period link first, so it is the one that gets updated.
  return found.sort((x, y) => Number(y.refId === ref) - Number(x.refId === ref));
}

/** Field-by-field differences between the board-built row and the uploaded Harvest entry. */
export function changesFor(r: UploadRow, e: HvEntry, projectId: number, taskName?: (id: number | null) => string, test = false): Change[] {
  const out: Change[] = [];
  const h = toHours(r.minutes ?? 0);
  if (Math.abs(e.hours - h) >= 0.005) out.push({ field: 'Duration', from: `${Math.round(e.hours * 60)} min`, to: `${Math.round(h * 60)} min` });
  if (e.date !== r.date) out.push({ field: 'Entry date', from: e.date, to: r.date });
  const was = test ? e.notes.replace(/^\[TEST\]\s*/, '') : e.notes;
  if (was !== r.notes) out.push({ field: 'Notes', from: was || '(empty)', to: r.notes || '(empty)' });
  if (e.taskId !== r.taskId) out.push({ field: 'Task', from: e.taskName || '—', to: taskName?.(r.taskId) ?? String(r.taskId ?? '—') });
  if (e.projectId !== projectId) out.push({ field: 'Project', from: e.projectName || '—', to: 'ISACNT Managed Services' });
  if (e.refId !== (test ? `TEST:${refIdFor(r.t)}` : refIdFor(r.t))) out.push({ field: 'Period link', from: e.refId ?? '—', to: refIdFor(r.t) });
  return out;
}
