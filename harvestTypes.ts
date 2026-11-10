export interface HvEntry {
  id: number; date: string; hours: number; notes: string;
  locked: boolean; lockedReason: string | null;
  startedTime: string | null; endedTime: string | null;
  projectId: number | null; projectCode: string | null; projectName: string;
  taskId: number | null; taskName: string;
  refId: string | null; refGroup: string | null; refLink: string | null;
}
export interface HvProject { id: number; name: string; code: string | null; clientName: string; tasks: { id: number; name: string; billable?: boolean }[] }
export interface HvSession {
  harvestUserId: number; harvestEmail: string; harvestName: string;
  mondayUserId: string; mondayEmail: string; mondayName: string;
  emailMatch: boolean; timestampMode: boolean; companyName: string;
  projects: HvProject[];
}

export const TEST_PREFIX = '[TEST] ';
export const TEST_GROUP = 'vibe-test';

/** Any test marker → ignored by the Harvest check. */
export const isTestish = (e: HvEntry) => e.notes.startsWith(TEST_PREFIX) || e.refGroup === TEST_GROUP || (e.refId ?? '').startsWith('TEST:');
/** Both markers → eligible for "Remove test entries". */
export const isDeletableTest = (e: HvEntry) => e.notes.startsWith(TEST_PREFIX) && e.refGroup === TEST_GROUP;

export interface WriteBody {
  project_id: number; task_id: number; spent_date: string; notes: string;
  hours?: number; started_time?: string; ended_time?: string;
  external_reference: { id: string; group_id: string; permalink: string };
}
export interface WriteOp { rowKey: string; kind: 'create' | 'update' | 'link'; entryId?: number; ticket: string; body: WriteBody; test: boolean }
export interface WriteResult { rowKey: string; ok: boolean; entry: HvEntry | null; error: string | null }
export interface LogRow { time: string; action: string; entryId: string; ticket: string; date: string; hours: string; test: string; result: string; detail: string }

/**
 * Does this Harvest entry belong to the monday item? Matched by item ID however it was uploaded:
 * the period link ("<id>@<period>"), the per-day link ("<id>"), the monday link, or notes starting with the ticket ID.
 */
export function entryIsForItem(e: HvEntry, itemId: string, label: string, test: boolean): boolean {
  if (test !== isTestish(e)) return false;
  const ref = (e.refId ?? '').replace(/^TEST:/, '');
  if (ref === itemId || ref.startsWith(`${itemId}@`)) return true;
  if ((e.refLink ?? '').endsWith(`/pulses/${itemId}`)) return true;
  const n = e.notes.replace(/^\[TEST\]\s*/, '').trim();
  return n === label || n.startsWith(`${label}:`) || n.startsWith(`${label} `);
}
