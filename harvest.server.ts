// Server-only Harvest API helper. Every call uses the signed-in person's own token.
import { entryIsForItem, type HvEntry } from '@generated/lib/harvestTypes';

const BASE = 'https://api.harvestapp.com/v2';
export interface HvAuth { token: string; accountId: string }

export async function hv<T>(auth: HvAuth, path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: init?.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${auth.token}`,
      'Harvest-Account-Id': auth.accountId,
      'User-Agent': 'Service Desk Report (monday Vibe app)',
      'Content-Type': 'application/json',
    },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { const j = JSON.parse(text) as { message?: string; error_description?: string }; msg = j.message ?? j.error_description ?? text; } catch { /* keep raw */ }
    throw new HvError(res.status, msg || res.statusText);
  }
  return (text ? JSON.parse(text) : {}) as T;
}

export class HvError extends Error {
  constructor(public status: number, message: string) { super(`Harvest ${status}: ${message}`); }
}

interface RawEntry {
  id: number; spent_date: string; hours: number | null; notes: string | null;
  is_locked: boolean; locked_reason: string | null; is_closed?: boolean; approval_status?: string | null;
  started_time: string | null; ended_time: string | null;
  project: { id: number; name: string; code: string | null } | null;
  task: { id: number; name: string } | null;
  user: { id: number } | null;
  external_reference: { id: string | null; group_id: string | null; permalink: string | null } | null;
}

export function mapEntry(e: RawEntry): HvEntry {
  return {
    id: e.id, date: e.spent_date, hours: e.hours ?? 0, notes: e.notes ?? '',
    locked: !!e.is_locked || !!e.is_closed || e.approval_status === 'approved' || e.approval_status === 'submitted',
    lockedReason: e.locked_reason ?? (e.approval_status === 'approved' ? 'Approved' : e.approval_status === 'submitted' ? 'Submitted for approval' : e.is_closed ? 'Closed' : null),
    startedTime: e.started_time, endedTime: e.ended_time,
    projectId: e.project?.id ?? null, projectCode: e.project?.code ?? null, projectName: e.project?.name ?? '',
    taskId: e.task?.id ?? null, taskName: e.task?.name ?? '',
    refId: e.external_reference?.id ?? null, refGroup: e.external_reference?.group_id ?? null, refLink: e.external_reference?.permalink ?? null,
  };
}

/** All of the user's time entries (optionally within a range), every page. */
export async function listEntries(auth: HvAuth, userId: number, from?: string, to?: string): Promise<HvEntry[]> {
  const out: HvEntry[] = [];
  let page: number | null = 1;
  while (page) {
    const q = new URLSearchParams({ user_id: String(userId), per_page: '2000', page: String(page) });
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    const res = await hv<{ time_entries: RawEntry[]; next_page: number | null }>(auth, `/time_entries?${q}`);
    out.push(...(res.time_entries ?? []).map(mapEntry));
    page = res.next_page ?? null;
  }
  return out;
}

export async function getEntry(auth: HvAuth, id: number): Promise<HvEntry> {
  return mapEntry(await hv<RawEntry>(auth, `/time_entries/${id}`));
}

/** Server-side duplicate guard: entries already in Harvest for this item within the upload's period. */
export async function existingForUpload(auth: HvAuth, userId: number, refId: string, label: string, test: boolean): Promise<HvEntry[]> {
  const m = refId.replace(/^TEST:/, '').match(/^(\d+)@(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/);
  if (!m) return [];
  const [, itemId, from, to] = m as unknown as [string, string, string, string];
  return (await listEntries(auth, userId, from, to)).filter((e) => entryIsForItem(e, itemId, label, test));
}
