import { useEffect, useMemo, useState } from 'react';
import { getTicketForSync } from '@generated/server/harvest';
import type { Group } from '@generated/lib/compute';
import { roundBillable } from '@generated/lib/rounding';
import { darwinDay, todayDarwin, monthKey, firstOfMonth, lastOfMonth } from '@generated/lib/darwin';
import { canonicalClient } from '@generated/settings';
import { HarvestPanel } from '@generated/components/harvest/HarvestPanel';

type Ticket = NonNullable<Awaited<ReturnType<typeof getTicketForSync>>['ticket']>;

/** Opened from a board button: one ticket, the signed-in person only. */
export function TicketSync({ kind, id }: { kind: 'request' | 'incident'; id: string }) {
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');

  useEffect(() => { const t = todayDarwin(); setFrom(firstOfMonth(monthKey(t))); setTo(lastOfMonth(monthKey(t))); }, []);
  useEffect(() => {
    getTicketForSync({ data: { kind, id } })
      .then((r) => { if (r?.ticket) setTicket(r.ticket); else setError('Ticket not found.'); })
      .catch((e) => { console.error(e); setError('Could not load this ticket.'); })
      .finally(() => setLoading(false));
  }, [kind, id]);

  const groups = useMemo(() => {
    if (!ticket || !from || !to) return [];
    const m = new Map<string, Group>();
    for (const s of ticket.sessions) {
      const day = darwinDay(s.startedAt);
      if (!day || day < from || day > to || s.endedAt == null || s.durationSec == null) continue;
      const key = `${s.startedUserId ?? ''}|${day}`;
      const g = m.get(key) ?? { kind: ticket.kind, ticketId: ticket.itemId, displayId: ticket.displayId, ticketName: ticket.name, personId: s.startedUserId, personName: s.startedUserId ?? '', day, rawSec: 0, minutes: 0 };
      g.rawSec += s.durationSec; m.set(key, g);
    }
    return [...m.values()].filter((g) => g.rawSec > 0).map((g) => ({ ...g, minutes: roundBillable(g.rawSec) })).sort((a, b) => a.day.localeCompare(b.day));
  }, [ticket, from, to]);

  return (
    <div className="mx-auto max-w-[1100px]">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card px-5 py-4 text-sm">
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Sync one ticket to Harvest</p>
          <p className="mt-1 font-medium">{loading ? 'Loading ticket…' : ticket ? `${ticket.displayId ?? ticket.itemId} ${ticket.name}` : '—'}</p>
          {ticket && !ticket.readable && <p className="text-destructive">Time tracking history could not be read.</p>}
          {error && <p className="text-destructive">{error}</p>}
        </div>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">From</span><input type="date" className="h-10 rounded-md border border-input bg-card px-2" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">To</span><input type="date" className="h-10 rounded-md border border-input bg-card px-2" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {ticket && from && to && from <= to && <HarvestPanel client={canonicalClient(ticket.client ?? '')} from={from} to={to} groups={groups} ticketMode />}
    </div>
  );
}
