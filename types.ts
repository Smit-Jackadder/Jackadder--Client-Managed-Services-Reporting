export interface SessionRaw {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSec: number | null;
  startedUserId: string | null;
  endedUserId: string | null;
  manuallyEntered: boolean | null;
}

export interface TicketRaw {
  kind: 'request' | 'incident';
  itemId: string;
  displayId: string | null;
  name: string;
  status: string | null;
  category: string | null;
  priority: string | null;
  creationDate: string | null; // Darwin day
  createdAtDay: string | null; // item created day (fallback)
  dateCompleted: string | null;
  resolutionDate: string | null;
  billableRaw: string | null;
  sessions: SessionRaw[];
  historyReadable: boolean;
}

export interface RecordRaw {
  id: string;
  name: string;
  opening: number | null;
  allocation: number | null;
  usedRequest: number | null;
  usedIncidents: number | null;
  closing: number | null;
  status: string | null;
  closedOn: string | null;
}

export interface ReportData {
  tickets: TicketRaw[];
  users: Record<string, string>;
  records: RecordRaw[] | null;
  excludedClientCounts: { board: string; label: string; count: number }[];
  pagesRead: { requests: number; incidents: number };
}
