import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Lock, Loader2, XCircle } from 'lucide-react';
import type { Report } from '@generated/lib/compute';
import { roundingSelfCheck } from '@generated/lib/rounding';
import { fmtDay } from '@generated/lib/darwin';

type Tab = 'entries' | 'review' | 'problems';
interface Props { report: Report; saveStatus: string; canFinalize: boolean; finalizeBlockers: string[]; finalizing: boolean; onFinalize: () => void; pagesRead: { requests: number; incidents: number }; itemCount: number }

const fmtTs = (iso: string) => (iso === '—' ? '—' : new Date(Date.parse(iso) + 9.5 * 3600000).toISOString().slice(0, 16).replace('T', ' '));

export function InternalPanel({ report: r, saveStatus, canFinalize, finalizeBlockers, finalizing, onFinalize, pagesRead, itemCount }: Props) {
  const [tab, setTab] = useState<Tab>('problems');
  const rounding = roundingSelfCheck();
  const byPerson = new Map<string, typeof r.groups>();
  for (const g of r.groups) byPerson.set(g.personName, [...(byPerson.get(g.personName) ?? []), g]);
  const persons = [...byPerson.keys()].sort();
  const tabs: [Tab, string][] = [['entries', `Total Billable Entries (${r.groups.length})`], ['review', `Review list (${r.review.length})`], ['problems', `Data problems (${r.problems.length})`]];

  return (
    <section className="mx-auto mt-10 w-full max-w-[1100px] rounded-md border border-dashed border-[hsl(var(--warn))] bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--warn))]">Internal only · never exported</p>
          <p className="mt-0.5 text-sm">{saveStatus}</p>
        </div>
        {r.isOfficial && (
          <div className="flex flex-col items-end gap-1">
            <button onClick={onFinalize} disabled={!canFinalize || finalizing} className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 text-sm font-medium text-background disabled:opacity-40">
              {finalizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />} Finalize month
            </button>
            {!canFinalize && finalizeBlockers[0] && <p className="max-w-xs text-right text-xs text-muted-foreground">{finalizeBlockers[0]}</p>}
          </div>
        )}
      </header>

      <div className="grid gap-4 border-b border-border px-5 py-4 text-sm sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Tie-out</p>
          <p className={`mt-1 flex items-center gap-1.5 font-medium ${r.tie.ok ? 'text-[hsl(var(--chart-4))]' : 'text-destructive'}`}>{r.tie.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}{r.tie.ok ? 'Passed' : 'Failed'}</p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">Per-ticket {r.tie.perTicket} · Used {r.tie.used} · Entries {r.tie.entries} · Report tables {r.tie.tableSum}{r.tie.reportUsed !== r.tie.used ? ` · Report (saved) ${r.tie.reportUsed ?? '—'}` : ''}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Coverage</p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">{itemCount} client items read across {pagesRead.requests} request page(s) and {pagesRead.incidents} incident page(s) of up to 100.</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Rounding check</p>
          <p className="mt-1 text-xs tabular-nums text-muted-foreground">{rounding.map((x) => `${x.label}→${x.got}${x.ok ? '✓' : `✗(exp ${x.expected})`}`).join(' · ')}</p>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border px-3">
        {tabs.map(([id, l]) => <button key={id} onClick={() => setTab(id)} className={`h-11 shrink-0 border-b-2 px-3 text-sm ${tab === id ? 'border-primary font-medium' : 'border-transparent text-muted-foreground'}`}>{l}</button>)}
      </div>

      <div className="max-h-[520px] overflow-auto px-5 py-4 text-sm">
        {tab === 'entries' && (persons.length === 0 ? <p className="text-muted-foreground">No billable entries in this range.</p> : persons.map((p) => {
          const gs = [...(byPerson.get(p) ?? [])].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
          const days = [...new Set(gs.map((g) => g.day))];
          return (
            <div key={p} className="mb-6">
              <h3 className="font-medium">{p} <span className="text-muted-foreground tabular-nums">· {gs.reduce((a, g) => a + g.minutes, 0)} min</span></h3>
              {days.map((d) => { const dg = gs.filter((g) => g.day === d); return (
                <div key={d} className="mt-2 rounded border border-border">
                  <div className="flex justify-between bg-muted px-3 py-1.5 text-xs"><span>{fmtDay(d)}</span><span className="tabular-nums">Day total {dg.reduce((a, g) => a + g.minutes, 0)} min</span></div>
                  {dg.map((g) => (
                    <div key={`${g.kind}${g.ticketId}`} className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-1.5">
                      <span className="rounded bg-secondary px-1.5 text-xs">{g.kind === 'request' ? 'Request' : 'Incident'}</span>
                      <span className="min-w-0 flex-1 truncate">[{g.displayId ?? '—'}] {g.ticketName}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">raw {(g.rawSec / 60).toFixed(2)} min →</span>
                      <b className="tabular-nums">{g.minutes}</b>
                    </div>
                  ))}
                </div>); })}
            </div>
          );
        }))}
        {tab === 'review' && (r.review.length === 0 ? <p className="text-muted-foreground">No sessions need review.</p> : (
          <table className="w-full min-w-[640px] text-left text-xs"><thead><tr className="text-muted-foreground"><th className="py-1">Ticket</th><th>Person</th><th>Start (Darwin)</th><th>End (Darwin)</th><th>Why</th></tr></thead>
            <tbody>{r.review.map((x, i) => <tr key={i} className="border-t border-border align-top"><td className="py-1.5 pr-2">{x.ticket}</td><td className="pr-2">{x.person}</td><td className="pr-2 tabular-nums">{fmtTs(x.start)}</td><td className="pr-2 tabular-nums">{fmtTs(x.end)}</td><td>{x.reasons.join('; ')}</td></tr>)}</tbody></table>
        ))}
        {tab === 'problems' && (r.problems.length === 0 ? <p className="text-muted-foreground">No data problems found.</p> : (
          <ul className="space-y-2">{r.problems.map((p, i) => <li key={i} className="flex gap-2"><AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${p.blocking ? 'text-destructive' : 'text-[hsl(var(--warn))]'}`} /><span>{p.blocking && <b className="mr-1 text-destructive">Blocking.</b>}{p.text}</span></li>)}</ul>
        ))}
      </div>
    </section>
  );
}
