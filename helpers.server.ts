import { IsacntEomReportingRecordsBoard } from '@api/BoardSDK';
import type { RecordRaw, SessionRaw } from '@generated/lib/types';
import { darwinDay } from '@generated/lib/darwin';

function toIso(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  if (typeof v === 'string' || typeof v === 'number') {
    const ms = typeof v === 'number' ? v : Date.parse(v);
    return Number.isNaN(ms) ? null : new Date(ms).toISOString();
  }
  return null;
}

/** Darwin day for a date column / timestamp value. */
export function toDay(v: unknown): string | null {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return darwinDay(toIso(v));
}

export function readDisplayId(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  return null;
}

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

/** Parse the time-tracking value into individual sessions, defensively. */
export function parseSessions(v: unknown): { sessions: SessionRaw[]; readable: boolean } {
  if (v == null) return { sessions: [], readable: true };
  if (typeof v !== 'object') return { sessions: [], readable: false };
  const hist = (v as { history?: unknown }).history;
  if (hist == null) return { sessions: [], readable: true };
  if (!Array.isArray(hist)) return { sessions: [], readable: false };
  const sessions: SessionRaw[] = hist.map((h, i) => {
    const o = (h ?? {}) as Record<string, unknown>;
    const dur = o.durationInSeconds;
    return {
      id: str(o.id) ?? `idx-${i}`,
      startedAt: toIso(o.startedAt),
      endedAt: toIso(o.endedAt),
      durationSec: typeof dur === 'number' && Number.isFinite(dur) ? dur : null,
      startedUserId: str(o.startedUserId),
      endedUserId: str(o.endedUserId),
      manuallyEntered: typeof o.manuallyEntered === 'boolean' ? o.manuallyEntered : null,
    };
  });
  return { sessions, readable: true };
}

export async function loadRecords(): Promise<RecordRaw[]> {
  const board = new IsacntEomReportingRecordsBoard();
  const out: RecordRaw[] = [];
  let cursor: string | null | undefined = undefined;
  do {
    const res = await board
      .items()
      .withColumns(['openningBalance', 'allocation', 'usedRequest', 'usedIncidents', 'closingBalance', 'reportStatus', 'closedOn'])
      .withPagination(cursor ? { limit: 100, cursor } : { limit: 100 })
      .execute();
    for (const r of res?.items ?? []) {
      out.push({
        id: String(r.id),
        name: r.name ?? '',
        opening: r.openningBalance ?? null,
        allocation: r.allocation ?? null,
        usedRequest: r.usedRequest ?? null,
        usedIncidents: r.usedIncidents ?? null,
        closing: r.closingBalance ?? null,
        status: typeof r.reportStatus === 'string' ? r.reportStatus : null,
        closedOn: toDay(r.closedOn),
      });
    }
    cursor = res?.cursor ?? null;
  } while (cursor);
  return out;
}
