import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Loader2, Send } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@components/ui/alert-dialog';
import type { Group } from '@generated/lib/compute';
import { buildPlan, buildBody, defaultTask, type PlanRow } from '@generated/lib/harvestPlan';
import type { WriteOp, HvEntry } from '@generated/lib/harvestTypes';
import { getClosingNotes, harvestWrite } from '@generated/server/harvest';
import type { HarvestCtx } from '@generated/hooks/useHarvest';
import { fmtDay } from '@generated/lib/darwin';

/** Task with the same name as the ticket's Request Type / Category; falls back to the default task. */
function pickTask(project: Parameters<typeof defaultTask>[0], type: string | undefined) {
  const want = (type ?? '').trim().toLowerCase();
  return (want && project.tasks.find((t) => t.name.trim().toLowerCase() === want)) || defaultTask(project);
}

export function HarvestSync({ h, groups, clientName }: { h: HarvestCtx; groups: Group[]; clientName: string }) {
  const s = h.session!;
  const test = h.prefs.testMode;
  const code = test && h.prefs.testProjectCode.trim() ? h.prefs.testProjectCode.trim() : h.prefs.projectCodes[clientName] ?? '';
  const project = s.projects.find((p) => p.code === code) ?? null;
  const plan = useMemo(() => buildPlan(groups, h.entries, test), [groups, h.entries, test]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [types, setTypes] = useState<Record<string, string>>({});
  const [tasks, setTasks] = useState<Record<string, number>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [after, setAfter] = useState<Record<string, { entry: HvEntry | null; error: string | null }>>({});

  useEffect(() => {
    const ids = (k: Group['kind']) => [...new Set(groups.filter((g) => g.kind === k).map((g) => g.ticketId))];
    if (!groups.length) return;
    getClosingNotes({ data: { requestIds: ids('request'), incidentIds: ids('incident') } }).then((r) => { setNotes(r?.notes ?? {}); setTypes(r?.types ?? {}); }).catch((e) => console.error(e));
  }, [groups]);

  const writable = (r: PlanRow) => r.action === 'create' || (!test && (r.action === 'update' || r.action === 'link'));
  const dayStart = new Map<string, number>();
  const bodies = new Map(plan.map((r) => {
    const taskId = tasks[r.key] ?? (project ? pickTask(project, types[r.g.ticketId])?.id : undefined);
    const start = dayStart.get(r.g.day) ?? 540; dayStart.set(r.g.day, start + r.minutes);
    return [r.key, project && taskId ? buildBody(r, { project, taskId, closingNotes: notes[r.g.ticketId] ?? null, testMode: test, timestampMode: s.timestampMode, startMin: start }) : null];
  }));
  const chosen = plan.filter((r) => picked.has(r.key) && writable(r) && bodies.get(r.key));
  const TEST_MAX = 3;
  const toggle = (k: string) => setPicked((p) => { const n = new Set(p); if (n.has(k)) n.delete(k); else if (!test || n.size < TEST_MAX) n.add(k); return n; });

  async function run() {
    setBusy(true);
    const ops: WriteOp[] = chosen.map((r) => ({ rowKey: r.key, kind: r.action as WriteOp['kind'], entryId: r.target?.id, ticket: r.ticket, body: bodies.get(r.key)!, test }));
    try {
      const res = await harvestWrite({ data: { auth: h.auth, userId: s.harvestUserId, ops } });
      const map: typeof after = {};
      for (const x of res?.results ?? []) map[x.rowKey] = { entry: x.entry, error: x.error };
      setAfter((a) => ({ ...a, ...map }));
      h.addLog(ops.map((o) => { const x = map[o.rowKey]; return { time: new Date().toISOString(), action: o.kind.toUpperCase(), entryId: String(x?.entry?.id ?? o.entryId ?? ''), ticket: o.ticket, date: o.body.spent_date, hours: String(o.body.hours ?? `${o.body.started_time}-${o.body.ended_time}`), test: test ? 'yes' : 'no', result: x?.error ? 'FAILED' : 'OK', detail: x?.error ?? JSON.stringify(o.body) }; }));
      setPicked(new Set()); await h.refresh();
    } catch (e) { console.error(e); h.addLog([{ time: new Date().toISOString(), action: 'WRITE', entryId: '', ticket: '', date: '', hours: '', test: test ? 'yes' : 'no', result: 'FAILED', detail: 'Request failed' }]); }
    finally { setBusy(false); setConfirm(false); }
  }

  const dupCount = chosen.filter((r) => r.duplicateForTesting).length;
  return (
    <div className="space-y-3">
      {!project && <p className="flex items-center gap-2 text-sm text-destructive"><AlertTriangle className="h-4 w-4" />No Harvest project with code “{code || '(not set)'}” is assigned to you. Set the project code in settings.</p>}
      {test && <p className="text-xs text-muted-foreground">Test mode: rows are created as marked test entries. Update and Link are disabled. You can tick up to {TEST_MAX} rows at a time.</p>}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground"><tr><th className="w-8 py-2"><span className="sr-only">Select</span></th><th className="pr-3">Day</th><th className="pr-3">Ticket</th><th className="pr-3 text-right">Min</th><th className="pr-3">Task</th><th className="pr-3">Action</th><th>Request body / result</th></tr></thead>
          <tbody>
            {plan.map((r) => {
              const b = bodies.get(r.key); const a = after[r.key]; const ok = writable(r) && !!b;
              return (
                <tr key={r.key} className="border-t border-border align-top">
                  <td className="py-2"><input type="checkbox" aria-label={`Select ${r.ticket}`} className="h-4 w-4" disabled={!ok || (test && !picked.has(r.key) && picked.size >= TEST_MAX)} checked={picked.has(r.key)} onChange={() => toggle(r.key)} /></td>
                  <td className="py-2 pr-3 tabular-nums">{fmtDay(r.g.day)}</td>
                  <td className="py-2 pr-3">{r.ticket}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{r.minutes}</td>
                  <td className="py-2 pr-3">{project && (
                    <select aria-label="Task" className="h-9 rounded border border-input bg-card px-2" value={tasks[r.key] ?? pickTask(project, types[r.g.ticketId])?.id ?? ''} onChange={(e) => setTasks((t) => ({ ...t, [r.key]: Number(e.target.value) }))}>
                      {project.tasks.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>)}</td>
                  <td className="py-2 pr-3"><p className="font-medium capitalize">{r.action.replace('-', ' ')}</p><p className={`text-xs ${r.duplicateForTesting ? 'text-[hsl(var(--warn))]' : 'text-muted-foreground'}`}>{r.duplicateForTesting ? 'Duplicate for testing' : r.reason}</p></td>
                  <td className="py-2">
                    {a ? (a.error ? <p className="text-xs text-destructive">{a.error}</p> : <p className="text-xs text-[hsl(var(--chart-4))]">Saved #{a.entry?.id} · {a.entry?.date} · {a.entry?.hours} h · {a.entry?.notes}</p>)
                      : b && <pre className="max-w-[360px] overflow-x-auto whitespace-pre-wrap break-all rounded bg-muted p-2 text-[11px]">{JSON.stringify(b, null, 1)}</pre>}
                  </td>
                </tr>
              );
            })}
            {!plan.length && <tr><td colSpan={7} className="py-4 text-muted-foreground">You have no billable entries in this range.</td></tr>}
          </tbody>
        </table>
      </div>
      <button disabled={!chosen.length || busy} onClick={() => setConfirm(true)} className="inline-flex h-11 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-40">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Sync {chosen.length} row(s) to Harvest{test ? ' (test)' : ''}
      </button>
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{test ? 'Create test entries?' : 'Write real entries to Harvest?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {chosen.length} row(s) will be written to your timesheet ({chosen.reduce((x, r) => x + r.hours, 0)} h).
              {dupCount > 0 && ` ${dupCount} duplicate a real entry and temporarily add hours to your timesheet. Remove them with “Remove test entries” before the timesheet is submitted or approved.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void run(); }}>{busy ? 'Writing…' : 'Confirm'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
