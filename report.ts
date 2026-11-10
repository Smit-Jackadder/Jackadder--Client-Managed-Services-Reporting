import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';
import { MondayRequestBoard, MondayIncidentsBoard, IsacntEomReportingRecordsBoard } from '@api/BoardSDK';
import type { ReportData, TicketRaw } from '@generated/lib/types';
import { parseSessions, toDay, loadRecords, readDisplayId } from '@generated/server/helpers.server';

export const getClientOptions = createServerFn({ method: 'GET' })
  .validator(z.object({}).optional())
  .handler(async () => {
    const [req, inc] = await Promise.all([
      new MondayRequestBoard().aggregate().groupBy('client').countItems('count').limit(100).execute(),
      new MondayIncidentsBoard().aggregate().groupBy('client').countItems('count').limit(100).execute(),
    ]);
    const labels = [...(req ?? []), ...(inc ?? [])].map((r) => r.client).filter((l): l is string => !!l);
    return { labels: Array.from(new Set(labels)) };
  });

export const getReportData = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      requestLabels: z.array(z.string()).min(1),
      incidentLabels: z.array(z.string()).min(1),
      withRecords: z.boolean(),
    }),
  )
  .handler(async ({ data }): Promise<ReportData> => {
    const reqBoard = new MondayRequestBoard();
    const incBoard = new MondayIncidentsBoard();
    const tickets: TicketRaw[] = [];
    const pagesRead = { requests: 0, incidents: 0 };

    // Requests — loop every page (100 per page) until the cursor is exhausted.
    const reqCols = ['itemId', 'client', 'status', 'creationDate', 'dateCompleted', 'timeWorkedOnTicket', 'clientBillableMinutes'] as const;
    let cursor: string | null | undefined = undefined;
    do {
      const res = await reqBoard
        .items()
        .withColumns([...reqCols])
        .where({ client: data.requestLabels as never })
        .withPagination(cursor ? { limit: 100, cursor } : { limit: 100 })
        .execute();
      pagesRead.requests++;
      for (const it of res?.items ?? []) {
        const s = parseSessions(it.timeWorkedOnTicket);
        tickets.push({
          kind: 'request',
          itemId: String(it.id),
          displayId: readDisplayId(it.itemId),
          name: it.name ?? '',
          status: it.status ?? null,
          category: null,
          priority: null,
          creationDate: toDay(it.creationDate),
          createdAtDay: toDay(it.createdAt),
          dateCompleted: toDay(it.dateCompleted),
          resolutionDate: null,
          billableRaw: it.clientBillableMinutes == null ? null : String(it.clientBillableMinutes),
          sessions: s.sessions,
          historyReadable: s.readable,
        });
      }
      cursor = res?.cursor ?? null;
    } while (cursor);

    const incCols = ['ticketId', 'client', 'status', 'category', 'priority', 'creationDate', 'dateCompleted', 'resolutionDate', 'timeWorkedOnTicket'] as const;
    cursor = undefined;
    do {
      const res = await incBoard
        .items()
        .withColumns([...incCols])
        .where({ client: data.incidentLabels as never })
        .withPagination(cursor ? { limit: 100, cursor } : { limit: 100 })
        .execute();
      pagesRead.incidents++;
      for (const it of res?.items ?? []) {
        const s = parseSessions(it.timeWorkedOnTicket);
        tickets.push({
          kind: 'incident',
          itemId: String(it.id),
          displayId: readDisplayId(it.ticketId),
          name: it.name ?? '',
          status: it.status ?? null,
          category: it.category ?? null,
          priority: it.priority ?? null,
          creationDate: toDay(it.creationDate),
          createdAtDay: toDay(it.createdAt),
          dateCompleted: toDay(it.dateCompleted),
          resolutionDate: toDay(it.resolutionDate),
          billableRaw: null,
          sessions: s.sessions,
          historyReadable: s.readable,
        });
      }
      cursor = res?.cursor ?? null;
    } while (cursor);

    // Resolve user names for every session user.
    const ids = new Set<string>();
    for (const t of tickets) for (const s of t.sessions) {
      if (s.startedUserId) ids.add(s.startedUserId);
      if (s.endedUserId) ids.add(s.endedUserId);
    }
    const users: Record<string, string> = {};
    const idList = Array.from(ids);
    for (let i = 0; i < idList.length; i += 50) {
      const chunk = idList.slice(i, i + 50).filter((n) => /^\d+$/.test(n));
      if (!chunk.length) continue;
      const found = await reqBoard.users.where({ ids: chunk }).withPagination({ limit: 50, page: 0 }).execute();
      for (const u of found ?? []) if (u?.id && u?.name) users[String(u.id)] = u.name;
    }

    // Board-wide counts of blank / N/A client items.
    const [reqAgg, incAgg] = await Promise.all([
      reqBoard.aggregate().groupBy('client').countItems('count').limit(100).execute(),
      incBoard.aggregate().groupBy('client').countItems('count').limit(100).execute(),
    ]);
    const excludedClientCounts: ReportData['excludedClientCounts'] = [];
    for (const [board, rows] of [['Monday Request', reqAgg], ['Monday Incidents', incAgg]] as const) {
      for (const r of rows ?? []) {
        const label = r.client ?? '';
        if (label === '' || label === 'N/A') excludedClientCounts.push({ board, label: label || 'blank', count: r.count ?? 0 });
      }
    }

    const records = data.withRecords ? await loadRecords() : null;
    return { tickets, users, records, excludedClientCounts, pagesRead };
  });

const valuesSchema = z.object({
  opening: z.number(),
  allocation: z.number(),
  usedRequest: z.number(),
  usedIncidents: z.number(),
  closing: z.number(),
});

export const saveDraftRecord = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().min(1), values: valuesSchema }))
  .handler(async ({ data }) => {
    const matches = (await loadRecords()).filter((r) => r.name.trim() === data.name);
    if (matches.length > 1) return { outcome: 'duplicate' as const };
    const existing = matches[0];
    if (existing && existing.status === 'Done') return { outcome: 'locked' as const };
    const board = new IsacntEomReportingRecordsBoard();
    const v = {
      openningBalance: data.values.opening,
      allocation: data.values.allocation,
      usedRequest: data.values.usedRequest,
      usedIncidents: data.values.usedIncidents,
      closingBalance: data.values.closing,
      reportStatus: 'Working on it' as const,
    };
    if (existing) {
      await board.item(existing.id).update(v).execute();
      return { outcome: 'updated' as const };
    }
    await board.item().create({ name: data.name, ...v }).execute();
    return { outcome: 'created' as const };
  });

export const finalizeRecord = createServerFn({ method: 'POST' })
  .validator(z.object({ name: z.string().min(1), values: valuesSchema, today: z.string() }))
  .handler(async ({ data }) => {
    const matches = (await loadRecords()).filter((r) => r.name.trim() === data.name);
    if (matches.length !== 1) return { ok: false as const, reason: matches.length ? 'Duplicate records for this month.' : 'No draft record found. Save the draft first.' };
    const rec = matches[0]!;
    if (rec.status === 'Done') return { ok: false as const, reason: 'This month is already Final and locked.' };
    const v = data.values;
    if (rec.opening !== v.opening || rec.allocation !== v.allocation || rec.usedRequest !== v.usedRequest || rec.usedIncidents !== v.usedIncidents || rec.closing !== v.closing) {
      return { ok: false as const, reason: 'The saved draft does not match this report. Regenerate the report first.' };
    }
    await new IsacntEomReportingRecordsBoard()
      .item(rec.id)
      .update({ reportStatus: 'Done', closedOn: new Date(`${data.today}T00:00:00Z`) })
      .execute();
    return { ok: true as const };
  });

/** Attach the generated month's PDF to its record on the EOM Reporting Records board ("Previous Reports"). */
export const uploadReportPdf = createServerFn({ method: 'POST' })
  .validator((data: FormData) => data)
  .handler(async ({ data }) => {
    const file = data.get('file');
    const name = String(data.get('name') ?? '').trim();
    if (!(file instanceof Blob) || !name) throw new Error('Missing file or month.');
    const matches = (await loadRecords()).filter((r) => r.name.trim() === name);
    if (matches.length !== 1) return { ok: false as const, reason: matches.length ? 'duplicate records exist for this month' : 'no record found for this month' };
    if (matches[0]!.status === 'Done') return { ok: false as const, reason: 'the month is Final and locked' };
    await new IsacntEomReportingRecordsBoard().item(matches[0]!.id).uploadFile({ columnId: 'file_mm7pm7b1' as 'previousReports' /* monday needs the real column id here */, file: file as File }).execute();
    return { ok: true as const };
  });
