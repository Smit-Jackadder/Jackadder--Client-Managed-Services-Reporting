import { useMemo, useState } from 'react';
import { Download, Loader2, PlugZap, RefreshCw, ShieldAlert } from 'lucide-react';
import type { Group } from '@generated/lib/compute';
import { useHarvest, downloadLogCsv } from '@generated/hooks/useHarvest';
import { HarvestCheck } from '@generated/components/harvest/HarvestCheck';
import { HarvestSync } from '@generated/components/harvest/HarvestSync';
import { AutoSync } from '@generated/components/harvest/AutoSync';

type Tab = 'auto' | 'check' | 'sync';
const input = 'h-10 w-full rounded-md border border-input bg-card px-3 text-sm';

export function HarvestPanel({ client, from, to, groups, ticketMode = false, autoFirst = false }: { client: string; from: string; to: string; groups: Group[]; ticketMode?: boolean; autoFirst?: boolean }) {
  const range = useMemo(() => ({ from, to }), [from, to]);
  const h = useHarvest(range);
  const [tab, setTab] = useState<Tab>(ticketMode ? 'sync' : 'check');
  const s = h.session;
  const mine = useMemo(() => (s ? groups.filter((g) => g.personId === s.mondayUserId) : []), [groups, s]);
  const ready = !!s?.emailMatch;

  return (
    <section className="mx-auto mt-6 w-full max-w-[1100px] rounded-md border border-dashed border-[hsl(var(--warn))] bg-card">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[hsl(var(--warn))]">Harvest · internal only · never exported</p>
          <p className="mt-0.5 text-sm">{s ? `${s.harvestName} (${s.harvestEmail}) · ${s.companyName} · ${s.timestampMode ? 'start and end time' : 'duration'} tracking` : 'Connect with your own Harvest personal access token.'}</p>
        </div>
        <span className={`rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wider bg-destructive/10 text-destructive`}>Live mode</span>
      </header>

      <div className="grid gap-3 border-b border-border px-5 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Personal access token</span><input type="password" className={input} value={h.prefs.token} onChange={(e) => h.setPrefs({ token: e.target.value })} /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Account ID</span><input className={input} inputMode="numeric" value={h.prefs.accountId} onChange={(e) => h.setPrefs({ accountId: e.target.value })} /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Project code for {client}</span><input className={input} value={h.prefs.projectCodes[client] ?? ''} onChange={(e) => h.setPrefs({ projectCodes: { ...h.prefs.projectCodes, [client]: e.target.value } })} /></label>
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-4">
          <button onClick={() => void h.connect()} disabled={h.loading || !h.prefs.token || !h.prefs.accountId} className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 font-medium text-background disabled:opacity-40">{h.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}{s ? 'Reconnect' : 'Connect'}</button>
          {s && <button onClick={() => void h.refresh()} disabled={h.loading} className="inline-flex h-10 items-center gap-2 rounded-md border border-border px-3"><RefreshCw className="h-4 w-4" />Refresh entries</button>}
          <button onClick={() => downloadLogCsv(h.log)} disabled={!h.log.length} className="ml-auto inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 disabled:opacity-40"><Download className="h-4 w-4" />Write log ({h.log.length})</button>
        </div>
        {h.error && <p className="text-destructive sm:col-span-2 lg:col-span-4">{h.error}</p>}
        {s && !s.emailMatch && <p className="flex items-center gap-2 text-destructive sm:col-span-2 lg:col-span-4"><ShieldAlert className="h-4 w-4" />Your Harvest email ({s.harvestEmail}) does not match your monday email ({s.mondayEmail || 'unknown'}). Use your own token.</p>}
      </div>

      {ready && (
        <>
          <nav className="flex gap-1 overflow-x-auto border-b border-border px-3">
            {([['check', 'Harvest check'], ['sync', 'Sync to Harvest']] as [Tab, string][]).map(([id, l]) => (
              <button key={id} onClick={() => setTab(id)} className={`h-11 shrink-0 border-b-2 px-3 text-sm ${tab === id ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground'}`}>{l}</button>
            ))}
          </nav>
          <div className={`px-5 py-4 ${h.loading ? 'opacity-60' : ''}`}>
            {tab === 'auto' && <AutoSync h={h} />}
            {tab === 'check' && <HarvestCheck groups={mine} entries={h.entries} />}
            {tab === 'sync' && <HarvestSync h={h} groups={mine} clientName={client} />}
          </div>
        </>
      )}

    </section>
  );
}
