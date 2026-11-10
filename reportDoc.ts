import type { Report, TicketRow } from '@generated/lib/compute';
import { fmtBal } from '@generated/lib/compute';
import { fmtDay } from '@generated/lib/darwin';

export type Block =
  | { type: 'client'; text: string }
  | { type: 'title'; text: string }
  | { type: 'h2'; text: string }
  | { type: 'p'; text: string; muted?: boolean }
  | { type: 'chart'; id: 'usage' | 'rolling' | 'carry' | 'carryforward'; caption: string }
  | { type: 'table'; name: string; head: string[]; rows: string[][] };

const n = (v: number | null) => (v == null ? '—' : String(v));
const hours = (v: number | null) => (v == null ? '—' : (v / 60).toFixed(2));

export function buildBlocks(r: Report): Block[] {
  const w = r.periodWord;
  const b: Block[] = [
    { type: 'client', text: r.client.toUpperCase() },
    { type: 'title', text: r.title },
    { type: 'p', text: r.periodLine },
    { type: 'h2', text: 'Overview' },
    { type: 'p', text: `The Service Request and Incident Report provides an overview of the incidents and service requests actioned during the ${w}.` },
    { type: 'h2', text: 'Managed Service usage summary' },
    { type: 'p', text: `${r.usageIntro}, ${r.client} used ${n(r.used)} minutes of support which equates to ${hours(r.used)} hours.` },
    { type: 'p', text: `Service requests: ${n(r.usedRequest)} minutes. Incidents: ${n(r.usedIncidents)} minutes.` },
    { type: 'chart', id: 'usage', caption: 'Minutes used by source' },
    { type: 'h2', text: 'Billing per month (3 months rolling)' },
    { type: 'chart', id: 'rolling', caption: 'Minutes billed per month' },
    { type: 'table', name: 'Billing per month', head: ['', ...r.rolling.map((m) => m.label)], rows: [
      ['Incidents (min)', ...r.rolling.map((m) => n(m.inc))],
      ['Requests (min)', ...r.rolling.map((m) => n(m.req))],
      ['Total (min)', ...r.rolling.map((m) => n(m.total))],
      ['Carry over total (min)', ...r.rolling.map((m) => fmtBal(m.closing))],
    ] },
    { type: 'p', text: 'Based on the carry over minutes from previous months.', muted: true },
    { type: 'h2', text: 'Carry forward minutes (3 months rolling)' },
    { type: 'p', text: `The contract started in ${r.contractStartLabel}, so carry forward minutes start at 0 in that month. Each month, the minutes carried forward from the previous month are added to the monthly allocation to give the total minutes available. Minutes used are subtracted, and whatever is left is carried forward to the next month.` },
    { type: 'chart', id: 'carryforward', caption: 'Carry forward minutes per month' },
    { type: 'table', name: 'Carry forward minutes', head: ['', ...r.rolling.map((m) => m.label)], rows: [
      ['Carried forward from previous month', ...r.rolling.map((m) => fmtBal(m.opening))],
      ['+ Monthly allocation', ...r.rolling.map((m) => n(m.allocation))],
      ['= Total minutes available', ...r.rolling.map((m) => (m.opening == null || m.allocation == null ? '—' : fmtBal(m.opening + m.allocation)))],
      ['− Minutes used', ...r.rolling.map((m) => n(m.total))],
      ['= Carried forward to next month', ...r.rolling.map((m) => fmtBal(m.closing))],
    ] },
    { type: 'p', text: 'A negative balance is shown as Overage.', muted: true },
  ];
  if (!r.carry && r.monthTable) {
    b.push(
      { type: 'h2', text: 'Minute balance by month' },
      { type: 'table', name: 'Minute balance by month', head: ['Month', 'Opening', 'Allocation', 'Used', 'Closing', 'Status'], rows: r.monthTable.map((m) => [m.label, fmtBal(m.opening), n(m.allocation), n(m.used), fmtBal(m.closing), m.status]) },
    );
  }
  const spentHead = `Time spent this ${w} (min)`;
  const sum = (rows: TicketRow[]) => rows.reduce((a, t) => a + t.periodMinutes, 0);
  const incRows = (rows: TicketRow[]) => [
    ...rows.map((t) => [t.id, t.name, t.category, t.status, t.created, t.resolved, String(t.periodMinutes)]),
    ['', 'Total', '', '', '', '', String(sum(rows))],
  ];
  const reqRows = (rows: TicketRow[], withCompleted: boolean) => [
    ...rows.map((t) => [t.id, t.name, t.status, t.created, ...(withCompleted ? [t.resolved || '—'] : []), t.billableMonths ? `${t.minutes} (${t.billableMonths})` : t.minutes, String(t.periodMinutes)]),
    ['', 'Total', '', '', ...(withCompleted ? [''] : []), '', String(sum(rows))],
  ];
  const isClosedInc = (t: TicketRow) => /^(Resolved|Closed)/.test(t.status);
  const openInc = r.incidents.filter((t) => !isClosedInc(t)); const closedInc = r.incidents.filter(isClosedInc);
  b.push(
    { type: 'h2', text: 'Current Open Incidents' },
    { type: 'p', text: 'Incidents in "Pending" status are waiting on more information from the client or a vendor.' },
    { type: 'p', text: `Incidents that are Waiting for Support, Work in Progress or Pending, or were worked on this ${w} and not resolved or closed. "${spentHead}" shows only the time worked during this ${w}.` },
    { type: 'p', text: `Count: ${openInc.length}` },
  );
  if (openInc.length) b.push({ type: 'table', name: 'Open incidents', head: ['ID', 'Name', 'Category', 'Status', 'Created', 'Resolved', spentHead], rows: incRows(openInc) });
  else b.push({ type: 'p', text: 'There are no open incidents.' });
  b.push(
    { type: 'h2', text: r.isOfficial ? 'Incidents resolved and closed this month' : 'Incidents resolved and closed in this period' },
    { type: 'p', text: `Incidents with a status of Resolved or Closed that were resolved or worked on this ${w}.` },
    { type: 'p', text: `Count: ${closedInc.length}` },
  );
  if (closedInc.length) b.push({ type: 'table', name: 'Closed incidents', head: ['ID', 'Name', 'Category', 'Status', 'Created', 'Resolved', spentHead], rows: incRows(closedInc) });
  else b.push({ type: 'p', text: `No incidents were resolved or closed this ${w}.` });
  const statusKey = 'Status: Waiting for Support - initial status. Work in Progress - logged and work commenced. Pending - waiting on feedback (either client or vendor). Completed.';
  b.push(
    { type: 'p', text: statusKey, muted: true },
    { type: 'p', text: 'Priority: Critical, High, Medium, Low in accordance with SLA.', muted: true },
    { type: 'h2', text: 'Current open service requests' },
    { type: 'p', text: `The following service requests are Waiting for Support, Work in Progress or Pending as at ${fmtTo(r)}, or were worked on this ${w} and not completed in it.` },
    { type: 'p', text: `Count: ${r.openRequests.length}` },
  );
  if (r.openRequests.length) b.push({ type: 'table', name: 'Open service requests', head: ['ID', 'Name', 'Status', 'Created', 'Client billable minutes', spentHead], rows: reqRows(r.openRequests, false) });
  else b.push({ type: 'p', text: 'There are no open service requests.' });
  b.push(
    { type: 'p', text: `${statusKey} Completed - moves to Closed after 7 days.`, muted: true },
    { type: 'h2', text: r.isOfficial ? 'Service requests completed and closed this month' : 'Service requests completed and closed in this period' },
    { type: 'p', text: 'Service requests with a Date Completed inside this period. Please note that completed requests move to closed after 7 days.' },
    { type: 'p', text: `Count: ${r.closedRequests.length}` },
  );
  if (r.closedRequests.length) b.push({ type: 'table', name: 'Closed service requests', head: ['ID', 'Name', 'Status', 'Created', 'Completed', 'Client billable minutes', spentHead], rows: reqRows(r.closedRequests, true) });
  else b.push({ type: 'p', text: `No service requests were completed or closed this ${w}.` });
  const all = sum(r.incidents) + sum(r.openRequests) + sum(r.closedRequests);
  b.push({ type: 'p', text: `Total time spent this ${w} across all tables: ${all} minutes (open incidents ${sum(openInc)} + closed incidents ${sum(closedInc)} + open requests ${sum(r.openRequests)} + completed and closed requests ${sum(r.closedRequests)}).${all === r.used ? ` This matches the usage summary of ${all} minutes.` : ""}` });
  return b;
}

function fmtTo(r: Report) { return fmtDay(r.to); }
