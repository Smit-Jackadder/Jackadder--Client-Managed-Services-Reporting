import type { PresetId } from '@generated/lib/presets';
import { fmtDay, daysInclusive } from '@generated/lib/darwin';

export interface ClientOption { name: string; blockedReason: string | null }
const PRESETS: { id: PresetId; label: string }[] = [
  { id: 'this', label: 'This month' },
  { id: 'last', label: 'Last month' },
  { id: 'last3', label: 'Last 3 months' },
  { id: 'contract', label: 'Contract year' },
  { id: 'custom', label: 'Custom range' },
];

interface Props {
  clients: ClientOption[]; clientsLoading: boolean; client: string; onClient: (c: string) => void;
  preset: PresetId; onPreset: (p: PresetId) => void; contractLabel: string;
  customFrom: string; customTo: string; onCustom: (f: string, t: string) => void;
  range: { from: string; to: string } | null; rangeError: string | null; isOfficial: boolean;
  canGenerate: boolean; generating: boolean; onGenerate: () => void;
}

export function Setup(p: Props) {
  const sel = p.clients.find((c) => c.name === p.client);
  return (
    <section className="rounded-md border border-border bg-card p-5">
      <div className="grid gap-6 lg:grid-cols-[260px_1fr_auto] lg:items-end">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Client</span>
          <select value={p.client} onChange={(e) => p.onClient(e.target.value)} disabled={p.clientsLoading}
            className="h-11 rounded-md border border-input bg-background px-3 text-sm">
            <option value="">{p.clientsLoading ? 'Loading clients…' : 'Select a client'}</option>
            {p.clients.map((c) => <option key={c.name} value={c.name}>{c.name}{c.blockedReason ? ` (${c.blockedReason})` : ''}</option>)}
          </select>
        </label>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Date range (Darwin time)</span>
          <div className="flex flex-wrap gap-1 rounded-md bg-muted p-1">
            {PRESETS.map((pr) => (
              <button key={pr.id} onClick={() => p.onPreset(pr.id)}
                className={`h-9 rounded px-3 text-sm transition-colors ${p.preset === pr.id ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                {pr.id === 'contract' ? p.contractLabel : pr.label}
              </button>
            ))}
          </div>
          {p.preset === 'custom' && (
            <div className="mt-1 flex flex-wrap gap-3 text-sm">
              <label className="flex items-center gap-2">From <input type="date" value={p.customFrom} onChange={(e) => p.onCustom(e.target.value, p.customTo)} className="h-10 rounded-md border border-input bg-background px-2" /></label>
              <label className="flex items-center gap-2">To <input type="date" value={p.customTo} onChange={(e) => p.onCustom(p.customFrom, e.target.value)} className="h-10 rounded-md border border-input bg-background px-2" /></label>
            </div>
          )}
        </div>
        <button onClick={p.onGenerate} disabled={!p.canGenerate || p.generating}
          className="h-11 rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {p.generating ? 'Reading all items…' : 'Generate report'}
        </button>
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4 text-sm">
        {p.range ? <span className="tabular-nums">{fmtDay(p.range.from)} to {fmtDay(p.range.to)} ({daysInclusive(p.range.from, p.range.to)} days)</span> : <span className="text-muted-foreground">{p.rangeError ?? 'No range'}</span>}
        {p.range && (p.isOfficial
          ? <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">Official monthly report</span>
          : <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">Interim report, not a monthly record</span>)}
        {sel?.blockedReason && <span className="text-destructive">Report generation blocked: {sel.blockedReason}.</span>}
      </div>
    </section>
  );
}
