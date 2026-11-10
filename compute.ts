import type { ReportData, TicketRaw, RecordRaw } from '@generated/lib/types';
import type { ClientSetting } from '@generated/settings';
import { roundBillable } from '@generated/lib/rounding';
import { darwinDay, monthKey, monthLabel, shortMonthLabel, firstOfMonth, lastOfMonth, addMonths, monthsBetween, addDays, fmtDay, dayStartMs, daysInclusive } from '@generated/lib/darwin';

export interface Problem { text: string; blocking: boolean }
export interface Group { kind: TicketRaw['kind']; ticketId: string; displayId: string | null; ticketName: string; personId: string | null; personName: string; day: string; rawSec: number; minutes: number }
export interface ReviewRow { ticket: string; kind: TicketRaw['kind']; start: string; end: string; person: string; reasons: string[] }
export interface MonthRow { mk: string; label: string; opening: number | null; allocation: number | null; usedRequest: number | null; usedIncidents: number | null; used: number | null; closing: number | null; status: 'Final' | 'Draft' | 'Calculated, not finalised' }
export interface TicketRow { id: string; name: string; category: string; status: string; created: string; resolved: string; minutes: string; billableMonths?: string; periodMinutes: number }
export interface OfficialInfo { name: string; values: { opening: number; allocation: number; usedRequest: number; usedIncidents: number; closing: number } | null; record: RecordRaw | null; isFinal: boolean; duplicate: boolean; saveBlockedReason: string | null }

export interface Report {
  client: string; from: string; to: string; days: number; isOfficial: boolean; singleMonth: boolean; title: string; periodLine: string; periodWord: 'month' | 'period'; usageIntro: string; contractStartLabel: string;
  usedRequest: number | null; usedIncidents: number | null; used: number | null;
  rolling: { mk: string; label: string; req: number | null; inc: number | null; total: number | null; opening: number | null; allocation: number | null; closing: number | null; status: MonthRow['status'] }[];
  allocation: number;
  carry: { opening: number | null; allocation: number; used: number | null; usedRequest: number | null; usedIncidents: number | null; closing: number | null; partial: boolean } | null;
  monthTable: MonthRow[] | null;
  incidents: TicketRow[]; openRequests: TicketRow[]; closedRequests: TicketRow[];
  groups: Group[]; review: ReviewRow[]; problems: Problem[];
  tie: { perTicket: number; used: number; entries: number; tableSum: number; reportUsed: number | null; ok: boolean };
  official: OfficialInfo | null; monthIncomplete: boolean;
}

const ACTIVE_STATUSES = ['Waiting for Support', 'Work in Progress', 'Pending'];
const SUMMARY_RE = /^\s*(total|totals|summary|subtotal)\b/i;
const label = (t: TicketRaw) => `[${t.displayId ?? '—'}] ${t.name}`;
const inRange = (d: string | null, f: string, t: string) => !!d && d >= f && d <= t;

export function buildReport(data: ReportData, client: ClientSetting, from: string, to: string, today: string): Report {
  const problems: Problem[] = [];
  const P = (text: string, blocking = false) => problems.push({ text, blocking });
  const allocation = client.allocation ?? 0;
  const cStart = client.contractStart!;
  const cStartDay = firstOfMonth(cStart);
  const endMk = monthKey(to);
  const singleMonth = monthKey(from) === endMk;
  // A whole month, or the current month up to today (saved as a draft record that updates each time it is generated).
  const isOfficial = singleMonth && from === firstOfMonth(endMk) && (to === lastOfMonth(endMk) || (to === today && endMk === monthKey(today)));
  const monthIncomplete = isOfficial && (to < lastOfMonth(endMk) || to > today);

  for (const e of data.excludedClientCounts) if (e.count > 0) P(`${e.board}: ${e.count} item(s) with ${e.label} Client were excluded.`);
  if (from < cStartDay) P(`Range starts before the contract start (${fmtDay(cStartDay)}). Balances begin at the contract start.`);
  if (monthIncomplete) P(`${monthLabel(endMk)} is not complete yet (today is ${fmtDay(today)}). It cannot be finalised.`, true);

  const summaryRows = data.tickets.filter((t) => SUMMARY_RE.test(t.name));
  if (summaryRows.length) P(`${summaryRows.length} summary row(s) (Total/Summary/Subtotal) excluded: ${summaryRows.map(label).join(', ')}.`);
  const tickets = data.tickets.filter((t) => !SUMMARY_RE.test(t.name));

  // ---- Sessions → groups ----
  const gmap = new Map<string, Group>();
  const review: ReviewRow[] = [];
  const endMs = dayStartMs(addDays(to, 1));
  const uname = (id: string | null) => (id ? data.users[id] ?? `Unknown user (${id})` : '— (no user)');
  for (const t of tickets) {
    if (!t.historyReadable) P(`${label(t)}: time tracking history could not be read.`, true);
    for (const s of t.sessions) {
      const day = darwinDay(s.startedAt);
      if (!day) { P(`${label(t)}: a session has no start time and was excluded.`, true); continue; }
      if (day > to) continue;
      const inR = day >= from;
      if (inR) {
        const reasons: string[] = [];
        if (s.manuallyEntered) reasons.push('Manually entered');
        const sMs = Date.parse(s.startedAt!); const eMs = s.endedAt ? Date.parse(s.endedAt) : null;
        if (eMs != null && s.durationSec != null && Math.abs((eMs - sMs) / 1000 - s.durationSec) > 60) reasons.push('Possibly edited (duration ≠ end − start)');
        if ((s.durationSec ?? 0) > 36000) reasons.push('Longer than 10 hours');
        if (s.endedAt && darwinDay(s.endedAt) !== day) reasons.push('Crosses midnight');
        if (!s.endedAt || (eMs != null && eMs > endMs)) reasons.push('Still running at range end');
        if (s.startedUserId && s.endedUserId && s.startedUserId !== s.endedUserId) reasons.push('Started and ended by different users');
        if (!s.startedUserId) reasons.push('No user');
        if (reasons.length) review.push({ ticket: label(t), kind: t.kind, start: s.startedAt ?? '—', end: s.endedAt ?? '—', person: uname(s.startedUserId), reasons });
      }
      if (s.endedAt == null || s.durationSec == null) {
        if (day >= cStartDay || inR) P(`${label(t)}: session started ${fmtDay(day)} has no end/duration and was not counted.`, inR);
        continue;
      }
      if (day < cStartDay && !inR) continue;
      const key = `${t.kind}|${t.itemId}|${s.startedUserId ?? ''}|${day}`;
      const g = gmap.get(key) ?? { kind: t.kind, ticketId: t.itemId, displayId: t.displayId, ticketName: t.name, personId: s.startedUserId, personName: uname(s.startedUserId), day, rawSec: 0, minutes: 0 };
      g.rawSec += s.durationSec; gmap.set(key, g);
    }
  }
  const allGroups = [...gmap.values()].filter((g) => g.rawSec > 0);
  for (const g of allGroups) g.minutes = roundBillable(g.rawSec);
  const groups = allGroups.filter((g) => inRange(g.day, from, to));
  const sumKind = (gs: Group[], k: TicketRaw['kind']) => gs.filter((g) => g.kind === k).reduce((a, g) => a + g.minutes, 0);
  const calcReq = sumKind(groups, 'request'); const calcInc = sumKind(groups, 'incident');
  const ticketMin = new Map<string, number>();
  for (const g of groups) ticketMin.set(`${g.kind}|${g.ticketId}`, (ticketMin.get(`${g.kind}|${g.ticketId}`) ?? 0) + g.minutes);

  // ---- Month chain ----
  const recs = data.records;
  if (!client.hasRecordsBoard) P(`${client.name} has no EOM Reporting Records board; no record is saved and all months are calculated.`);
  const chain: MonthRow[] = [];
  const chainMonths = cStart <= endMk ? monthsBetween(cStart, endMk) : [];
  for (const mk of chainMonths) {
    const inMonth = allGroups.filter((g) => g.day >= firstOfMonth(mk) && g.day <= lastOfMonth(mk) && g.day <= to);
    const cR = sumKind(inMonth, 'request'); const cI = sumKind(inMonth, 'incident');
    const matches = (recs ?? []).filter((r) => r.name.trim() === monthLabel(mk));
    if (matches.length > 1) P(`${monthLabel(mk)}: duplicate records on the records board (${matches.length}). Nothing is saved for this month.`, mk === endMk && isOfficial);
    const rec = matches.length === 1 ? matches[0]! : null;
    const prev = chain[chain.length - 1];
    if (rec && rec.status === 'Done') {
      const miss = (['opening', 'allocation', 'usedRequest', 'usedIncidents', 'closing'] as const).filter((k) => rec[k] == null);
      if (miss.length) P(`${monthLabel(mk)} Final record is missing: ${miss.join(', ')}.`, true);
      if (rec.usedRequest != null && rec.usedRequest !== cR) P(`${monthLabel(mk)} (Final): saved Used - Request ${rec.usedRequest} differs from current data ${cR}. Record the difference (${cR - rec.usedRequest}) as an adjustment next month.`);
      if (rec.usedIncidents != null && rec.usedIncidents !== cI) P(`${monthLabel(mk)} (Final): saved Used - Incidents ${rec.usedIncidents} differs from current data ${cI}. Record the difference (${cI - rec.usedIncidents}) as an adjustment next month.`);
      const used = rec.usedRequest != null && rec.usedIncidents != null ? rec.usedRequest + rec.usedIncidents : null;
      // New contract = new rollover cycle: the first contract month always opens at 0.
      const isStart = mk === cStart;
      if (isStart && rec.opening != null && rec.opening !== 0) P(`${monthLabel(mk)} (Final): saved Opening Balance ${rec.opening} ignored; the contract started this month so rollover resets to 0.`);
      const opening = isStart ? 0 : rec.opening;
      const closing = isStart ? (rec.allocation != null && used != null ? rec.allocation - used : null) : rec.closing;
      chain.push({ mk, label: monthLabel(mk), opening, allocation: rec.allocation, usedRequest: rec.usedRequest, usedIncidents: rec.usedIncidents, used, closing, status: 'Final' });
    } else {
      const opening = prev ? prev.closing : 0;
      chain.push({ mk, label: monthLabel(mk), opening, allocation, usedRequest: cR, usedIncidents: cI, used: cR + cI, closing: opening == null ? null : opening + allocation - cR - cI, status: rec ? 'Draft' : 'Calculated, not finalised' });
    }
  }
  const row = (mk: string) => chain.find((c) => c.mk === mk) ?? null;

  // ---- Official month ----
  let official: OfficialInfo | null = null;
  let usedRequest: number | null = calcReq; let usedIncidents: number | null = calcInc;
  let carryOpening: number | null = row(endMk)?.opening ?? null;
  if (isOfficial) {
    const matches = (recs ?? []).filter((r) => r.name.trim() === monthLabel(endMk));
    const rec = matches.length === 1 ? matches[0]! : null;
    const isFinal = rec?.status === 'Done';
    let reason: string | null = null;
    let values: OfficialInfo['values'] = null;
    if (isFinal) {
      const r = row(endMk)!; usedRequest = r.usedRequest; usedIncidents = r.usedIncidents; carryOpening = r.opening;
    } else {
      let opening: number | null = null;
      if (endMk === cStart) opening = 0;
      else {
        const prevRow = row(addMonths(endMk, -1));
        const prevLabel = monthLabel(addMonths(endMk, -1));
        if (prevRow?.status === 'Final' && prevRow.closing != null) opening = prevRow.closing;
        else if (prevRow?.closing != null) {
          // Past month: roll over the previous month's closing worked out from the time logs (chain from contract start).
          opening = prevRow.closing;
          P(`Opening balance ${opening} is the rolled-over closing of ${prevLabel}, worked out from the time logs because ${prevLabel} is not Final. Finalize ${prevLabel} first before finalising this month.`, true);
        } else { P(`Opening balance is unknown: the closing of ${prevLabel} cannot be worked out (see other data problems).`, true); reason = 'the previous month closing is unknown'; }
      }
      carryOpening = opening;
      if (opening != null) values = { opening, allocation, usedRequest: calcReq, usedIncidents: calcInc, closing: opening + allocation - calcReq - calcInc };
    }
    if (!client.hasRecordsBoard) reason = 'this client has no records board';
    if (matches.length > 1) reason = 'duplicate records exist for this month';
    if (endMk < cStart) reason = 'the month is before the contract start';
    official = { name: monthLabel(endMk), values, record: rec, isFinal, duplicate: matches.length > 1, saveBlockedReason: isFinal ? null : reason };
  }
  const used = usedRequest != null && usedIncidents != null ? usedRequest + usedIncidents : null;

  // ---- Tables ----
  const created = (t: TicketRaw) => {
    if (t.creationDate) return t.creationDate;
    P(`${label(t)}: Creation Date is empty; the item's created date was used.`);
    return t.createdAtDay;
  };
  const incidents: TicketRow[] = []; const openRequests: TicketRow[] = []; const closedRequests: TicketRow[] = [];
  const shown = new Set<string>();
  for (const t of tickets) {
    const key = `${t.kind}|${t.itemId}`;
    const c = created(t);
    const mins = ticketMin.get(key) ?? 0;
    const active = !!t.status && ACTIVE_STATUSES.includes(t.status) && !!c && c <= to;
    if (t.kind === 'incident') {
      const res = t.dateCompleted ?? t.resolutionDate;
      const isDone = t.status === 'Resolved' || t.status === 'Closed';
      if (isDone && !res) P(`${label(t)}: status ${t.status} but no Date Completed / Resolution Date; not shown.`);
      if (c && res && res < c) P(`${label(t)}: resolved date is before the created date.`);
      const resolvedHere = isDone && inRange(res, from, to);
      // Any incident worked on in the period is always listed so the column adds up to the total.
      if (active || resolvedHere || mins > 0) {
        const status = isDone && res && res > to ? `${t.status} after period (${fmtDay(res)})` : t.status ?? '—';
        incidents.push({ id: t.displayId ?? '—', name: t.name, category: t.category ?? '—', status, created: fmtDay(c), resolved: isDone && res && res <= to ? fmtDay(res) : '—', minutes: '', periodMinutes: mins });
        shown.add(key);
      }
    } else {
      const done = t.dateCompleted;
      const isDone = t.status === 'Completed' || t.status === 'Closed';
      if (isDone && !done) P(`${label(t)}: status ${t.status} but Date Completed is empty; not shown.`);
      if (c && done && done < c) P(`${label(t)}: Date Completed is before the Creation Date.`);
      const closedHere = isDone && inRange(done, from, to);
      // Any request worked on in the period is always listed so the column adds up to the total.
      if (!active && !closedHere && mins <= 0) continue;
      const raw = t.billableRaw?.trim() ?? '';
      let billable = '—';
      if (/^-?\d+(\.\d+)?$/.test(raw)) billable = raw;
      else P(`${label(t)}: Client Billable Minutes is ${raw ? `"${raw}" (not a number)` : 'empty'}; shown as —.`);
      const completedAfter = isDone && !!done && done > to;
      const completedBefore = isDone && !!done && done < from;
      // Completed / Closed tickets never appear in the open table.
      const toClosed = isDone || closedHere || completedBefore;
      const status = completedAfter ? `${t.status} after period (${fmtDay(done)})` : t.status ?? '—';
      const row = { id: t.displayId ?? '—', name: t.name, category: '', status, created: fmtDay(c), resolved: toClosed && done ? fmtDay(done) : '', minutes: billable, billableMonths: billable === '—' ? '' : workedMonths(t, monthKey(from), monthKey(to)), periodMinutes: mins };
      (toClosed ? closedRequests : openRequests).push(row);
      if (completedBefore) P(`${label(t)}: completed ${fmtDay(done)} (before this period) but has ${mins} minutes logged in this period; listed under completed and closed.`);
      shown.add(key);
    }
  }
  const hidden = tickets.filter((t) => (ticketMin.get(`${t.kind}|${t.itemId}`) ?? 0) > 0 && !shown.has(`${t.kind}|${t.itemId}`));
  if (hidden.length) P(`${hidden.length} ticket(s) have minutes in this period but do not appear in any report table: ${hidden.map(label).join(', ')}.`);

  // ---- Tie-out ----
  const perTicket = [...ticketMin.values()].reduce((a, b) => a + b, 0);
  const entries = groups.reduce((a, g) => a + g.minutes, 0);
  const tableSum = [...incidents, ...openRequests, ...closedRequests].reduce((a, t) => a + t.periodMinutes, 0);
  const tieOk = perTicket === calcReq + calcInc && entries === perTicket && tableSum === perTicket && (used == null || official?.isFinal === true || used === perTicket);
  if (!tieOk) P(`Tie-out failed: per-ticket ${perTicket}, used ${used ?? "—"}, billable entries ${entries}, report tables ${tableSum}.`, true);

  // ---- Rolling 3 months ----
  const rollStart = addMonths(endMk, -2) < cStart ? cStart : addMonths(endMk, -2);
  const rolling = chainMonths.filter((mk) => mk >= rollStart).map((mk) => {
    const r = row(mk)!;
    return { mk, label: shortMonthLabel(mk), req: r.usedRequest, inc: r.usedIncidents, total: r.used, opening: r.opening, allocation: r.allocation, closing: r.closing, status: r.status };
  });

  const carry = singleMonth ? { opening: carryOpening, allocation, used, usedRequest, usedIncidents, closing: carryOpening == null || used == null ? null : carryOpening + allocation - used, partial: !isOfficial } : null;
  const monthTable = singleMonth ? null : chain.filter((c) => c.mk >= monthKey(from));
  if (!singleMonth && (from !== firstOfMonth(monthKey(from)))) P('The month balance table shows full-month figures; the range starts mid-month.');

  const span = `${fmtDay(from)} to ${fmtDay(to)}`;
  return {
    client: client.name, from, to, days: daysInclusive(from, to), isOfficial, singleMonth,
    title: isOfficial ? `Service Desk Report, ${monthLabel(endMk)}` : `Service Desk Report, ${span}`,
    periodLine: isOfficial ? `Reporting Period as at: ${fmtDay(to)}` : `Reporting Period: ${span}`,
    periodWord: isOfficial ? 'month' : 'period',
    contractStartLabel: monthLabel(cStart),
    usageIntro: isOfficial ? `For the month of ${monthLabel(endMk)}` : `For the period ${span}`,
    usedRequest, usedIncidents, used, rolling, allocation, carry, monthTable,
    incidents, openRequests, closedRequests, groups, review, problems,
    tie: { perTicket, used: calcReq + calcInc, entries, tableSum, reportUsed: used, ok: tieOk },
    official, monthIncomplete,
  };
}

export const fmtBal = (n: number | null) => (n == null ? '—' : n < 0 ? `Overage ${Math.abs(n)}` : String(n));

const MON = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Months outside the selected period (Darwin time, by session start) with logged time in the Time worked on Ticket log, e.g. "jul, aug". */
export function workedMonths(t: TicketRaw, skipFrom: string, skipTo: string): string {
  const mks = new Set<string>();
  for (const s of t.sessions) {
    const d = darwinDay(s.startedAt);
    if (!d || (s.durationSec ?? 0) <= 0) continue;
    const mk = monthKey(d);
    if (mk < skipFrom || mk > skipTo) mks.add(mk);
  }
  const sorted = [...mks].sort();
  const multiYear = new Set(sorted.map((mk) => mk.slice(0, 4))).size > 1;
  return sorted.map((mk) => `${MON[Number(mk.slice(5, 7)) - 1]}${multiYear ? ` ${mk.slice(2, 4)}` : ''}`).join(', ');
}
