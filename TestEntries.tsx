import { useState } from 'react';
import { FlaskConical, Loader2, Trash2 } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@components/ui/alert-dialog';
import { isTestish, isDeletableTest, type HvEntry } from '@generated/lib/harvestTypes';
import { harvestEntries, harvestDeleteTests } from '@generated/server/harvest';
import type { HarvestCtx } from '@generated/hooks/useHarvest';

const sumH = (es: HvEntry[]) => Math.round(es.reduce((a, e) => a + e.hours, 0) * 100) / 100;

export function TestEntries({ h }: { h: HarvestCtx }) {
  const s = h.session!;
  const inRange = h.entries.filter(isTestish);
  const [candidates, setCandidates] = useState<HvEntry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);

  async function find() {
    setBusy(true); setMsg(null); setFailures([]);
    try { const res = await harvestEntries({ data: { auth: h.auth, userId: s.harvestUserId } }); setCandidates((res?.entries ?? []).filter(isDeletableTest)); }
    catch (e) { console.error(e); setMsg('Could not list test entries.'); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!candidates?.length) return;
    setBusy(true);
    try {
      const res = await harvestDeleteTests({ data: { auth: h.auth, userId: s.harvestUserId, ids: candidates.map((c) => c.id) } });
      const rs = res?.results ?? [];
      h.addLog(rs.map((r) => ({ time: new Date().toISOString(), action: 'DELETE', entryId: String(r.id), ticket: r.notes, date: r.date, hours: String(r.hours), test: 'yes', result: r.ok ? 'OK' : 'FAILED', detail: r.error ?? '' })));
      setFailures(rs.filter((r) => !r.ok).map((r) => `#${r.id} (${r.date}): ${r.error}`));
      setMsg(`Deleted ${rs.filter((r) => r.ok).length}. Test entries remaining in Harvest: ${res?.remaining ?? '?'}.`);
      setCandidates(null); await h.refresh();
    } catch (e) { console.error(e); setMsg('Removing failed. Nothing further was changed.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[hsl(var(--warn))] bg-[hsl(var(--warn)/0.08)] px-4 py-3 text-sm">
        <p className="flex items-center gap-2"><FlaskConical className="h-4 w-4 text-[hsl(var(--warn))]" />{inRange.length} test entr{inRange.length === 1 ? 'y' : 'ies'} in this range · {sumH(inRange)} h. Excluded from the Harvest check.</p>
        <button onClick={find} disabled={busy} className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-3 font-medium disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Remove test entries
        </button>
      </div>
      {msg && <p className="text-sm">{msg}</p>}
      {failures.map((f) => <p key={f} className="text-sm text-destructive">{f}</p>)}
      <ul className="divide-y divide-border text-sm">
        {inRange.map((e) => <li key={e.id} className="flex flex-wrap justify-between gap-2 py-1.5"><span className="min-w-0 break-words">{e.date} · {e.notes}</span><span className="tabular-nums text-muted-foreground">{e.hours} h · {e.projectCode ?? e.projectName}</span></li>)}
      </ul>
      <AlertDialog open={candidates !== null} onOpenChange={(o) => { if (!o) setCandidates(null); }}>
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {candidates?.length ?? 0} test entries?</AlertDialogTitle>
            <AlertDialogDescription>Only your entries with both the “[TEST] ” notes prefix and the “vibe-test” group are listed. Total {sumH(candidates ?? [])} h.</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-64 divide-y divide-border overflow-y-auto text-sm">
            {(candidates ?? []).map((e) => <li key={e.id} className="py-1.5">#{e.id} · {e.date} · {e.hours} h · {e.notes}{e.locked ? ` · locked (${e.lockedReason})` : ''}</li>)}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy || !candidates?.length} onClick={(ev) => { ev.preventDefault(); void remove(); }}>{busy ? 'Deleting…' : 'Delete test entries'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
