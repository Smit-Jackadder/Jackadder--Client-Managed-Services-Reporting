import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Play, Zap } from 'lucide-react';
import type { Group } from '@generated/lib/compute';
import { roundBillable } from '@generated/lib/rounding';
import { darwinDay, todayDarwin, addDays, fmtDay } from '@generated/lib/darwin';
import { canonicalClient } from '@generated/settings';
import { buildPlan, buildBody } from '@generated/lib/harvestPlan';
import type { WriteOp } from '@generated/lib/harvestTypes';
import { getCompletedTickets, harvestEntries, harvestWrite } from '@generated/server/harvest';
import type { HarvestCtx } from '@generated/hooks/useHarvest';

const EVERY_MS = 5 * 60 * 1000;
interface Activity { key: string; when: string; ticket: string; client: string; day: string; minutes: number; outcome: string; ok: boolean }

/** Watches for tickets that reached Completed/Closed/Resolved and writes YOUR time on them to Harvest. */
export function AutoSync({ h }: { h: HarvestCtx }) {
  const s = h.session!;
  const test = false; // auto-sync always writes real (live) entries
  const on = h.prefs.autoSync;
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<string | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [clients, setClients] = useState<string[]>([]);
  const busy = useRef(false);

  const cycle = useCallback(async () => {
    if (busy.current) return;
    busy.current = true; setRunning(true);
    const now = new Date().toISOString();
    const acts: Activity[] = [];
    try {
      const today = todayDarwin();
      const res = await getCompletedTickets({ data: { from: addDays(today, -Math.max(0, h.prefs.lookbackDays)), to: today } });
      const tickets = res?.tickets ?? [];
      // Build your billable groups (ticket × day) from each completed ticket's time log.
      const work: { g: Group; client: string; notes: string | null; type: string | null }[] = [];
      for (const t of tickets) {
        const m = new Map<string, Group>();
        for (const x of t.sessions) {
          if (x.startedUserId !== s.mondayUserId || x.endedAt == null || x.durationSec == null) continue;
          const day = darwinDay(x.startedAt); if (!day) continue;
          const g = m.get(day) ?? { kind: t.kind, ticketId: t.itemId, displayId: t.displayId, ticketName: t.name, personId: x.startedUserId, personName: s.mondayName, day, rawSec: 0, minutes: 0 };
          g.rawSec += x.durationSec; m.set(day, g);
        }
        for (const g of m.values()) if (g.rawSec > 0) work.push({ g: { ...g, minutes: roundBillable(g.rawSec) }, client: canonicalClient(t.client ?? ''), notes: t.closingNotes, type: t.workType });
      }
      setClients([...new Set(work.map((w) => w.client))]);
      if (work.length) {
        const from = work.reduce((a, w) => (w.g.day < a ? w.g.day : a), today);
        const ent = await harvestEntries({ data: { auth: h.auth, userId: s.harvestUserId, from, to: today } });
        const plan = buildPlan(work.map((w) => w.g), ent?.entries ?? [], test);
        const ops: WriteOp[] = []; const dayStart = new Map<string, number>();
        plan.forEach((r, i) => {
          const w = work[i]!;
          const base = { key: r.key, when: now, ticket: r.ticket, client: w.client || '(no client)', day: r.g.day, minutes: r.minutes };
          const code = test && h.prefs.testProjectCode.trim() ? h.prefs.testProjectCode.trim() : h.prefs.projectCodes[w.client] ?? '';
          const project = s.projects.find((p) => p.code === code);
          if (!project) { acts.push({ ...base, outcome: `Skipped: no Harvest project ${code ? `with code “${code}” assigned to you` : `code set for ${base.client}`}.`, ok: false }); return; }
          // Project type → Harvest task with the same name (Request Type on requests, Category on incidents).
          const wanted = (w.type ?? '').trim().toLowerCase();
          const task = wanted ? project.tasks.find((t) => t.name.trim().toLowerCase() === wanted) : undefined;
          if (!task) { acts.push({ ...base, outcome: w.type ? `Skipped: project ${project.code ?? project.name} has no task named “${w.type}”.` : `Skipped: ${r.g.kind === 'request' ? 'Request Type' : 'Category'} is empty on the ticket.`, ok: false }); return; }
          if (test && r.tests.length) { acts.push({ ...base, outcome: 'Test entry already exists.', ok: true }); return; }
          if (r.action === 'in-sync') { acts.push({ ...base, outcome: `Already in Harvest (#${r.target?.id}).`, ok: true }); return; }
          if (r.action === 'skip-locked' || r.action === 'blocked') { acts.push({ ...base, outcome: r.reason, ok: false }); return; }
          const start = dayStart.get(r.g.day) ?? 540; dayStart.set(r.g.day, start + r.minutes);
          const body = buildBody(r, { project, taskId: task.id, closingNotes: w.notes, testMode: test, timestampMode: s.timestampMode, startMin: start });
          ops.push({ rowKey: r.key, kind: r.action as WriteOp['kind'], entryId: r.target?.id, ticket: r.ticket, body, test });
        });
        if (ops.length) {
          const wr = await harvestWrite({ data: { auth: h.auth, userId: s.harvestUserId, ops } });
          const byKey = new Map((wr?.results ?? []).map((x) => [x.rowKey, x]));
          h.addLog(ops.map((o) => { const x = byKey.get(o.rowKey); return { time: now, action: `AUTO ${o.kind.toUpperCase()}`, entryId: String(x?.entry?.id ?? o.entryId ?? ''), ticket: o.ticket, date: o.body.spent_date, hours: String(o.body.hours ?? `${o.body.started_time}-${o.body.ended_time}`), test: test ? 'yes' : 'no', result: x?.ok ? 'OK' : 'FAILED', detail: x?.error ?? JSON.stringify(o.body) }; }));
          for (const o of ops) {
            const x = byKey.get(o.rowKey); const r = plan.find((p) => p.key === o.rowKey)!; const w = work[plan.indexOf(r)]!;
            acts.push({ key: o.rowKey, when: now, ticket: o.ticket, client: w.client, day: o.body.spent_date, minutes: r.minutes, outcome: x?.ok ? `${o.kind === 'create' ? 'Created' : o.kind === 'update' ? 'Updated' : 'Linked'} #${x.entry?.id} · ${x.entry?.projectCode ?? ''} · ${x.entry?.hours} h · ${x.entry?.notes}` : `Failed: ${x?.error ?? 'unknown'}`, ok: !!x?.ok });
          }
          await h.refresh();
        }
      }
      setActivity((a) => [...acts, ...a.filter((p) => !acts.some((n) => n.key === p.key))].slice(0, 100));
      setLastRun(now);
    } catch (e) { console.error('autoSync', e); setActivity((a) => [{ key: `err-${now}`, when: now, ticket: '—', client: '', day: '', minutes: 0, outcome: 'Check failed. Will retry next cycle.', ok: false }, ...a]); }
    finally { busy.current = false; setRunning(false); }
  }, [h, s, test]);

  const latest = useRef(cycle);
  useEffect(() => { latest.current = cycle; }, [cycle]);
  useEffect(() => {
    if (!on) return;
    void latest.current();
    const t = setInterval(() => { void latest.current(); }, EVERY_MS);
    return () => clearInterval(t);
  }, [on, test]);

  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-3 rounded-md border border-border px-4 py-3">
        <label className="inline-flex items-center gap-2 font-medium"><input type="checkbox" className="h-4 w-4" checked={on} onChange={(e) => h.setPrefs({ autoSync: e.target.checked })} /><Zap className="h-4 w-4" />Auto-sync completed tickets</label>
        <label className="inline-flex items-center gap-2 text-muted-foreground">Look back
          <input type="number" min={0} max={31} className="h-9 w-16 rounded border border-input bg-card px-2" value={h.prefs.lookbackDays} onChange={(e) => h.setPrefs({ lookbackDays: Number(e.target.value) || 0 })} /> days</label>
        <button onClick={() => void cycle()} disabled={running} className="ml-auto inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 disabled:opacity-40">{running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Check now</button>
      </div>
      <p className="text-muted-foreground">
        {on ? `Checking every 5 minutes while this app is open${lastRun ? ` · last check ${new Date(lastRun).toLocaleTimeString()}` : ''}. ` : 'Off. '}
        Live entries only. A ticket is picked up when its Status is Completed (Monday Request) or Resolved (Monday Incidents) and Date Completed is within the look-back. Project comes from the ticket's Client, task from its Request Type / Category, notes are “Item ID: Closing Notes”, hours are your own logged time rounded to 15-minute blocks. One entry per ticket per day; already-synced tickets are skipped.
      </p>
      {clients.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {clients.map((c) => (
            <label key={c} className="inline-flex items-center gap-2"><span className="text-muted-foreground">Project code for {c || '(no client)'}</span>
              <input className="h-9 w-36 rounded border border-input bg-card px-2" value={h.prefs.projectCodes[c] ?? ''} onChange={(e) => h.setPrefs({ projectCodes: { ...h.prefs.projectCodes, [c]: e.target.value } })} /></label>
          ))}
        </div>
      )}
      <ul className="divide-y divide-border">
        {activity.map((a) => (
          <li key={`${a.key}-${a.when}`} className="flex flex-wrap justify-between gap-2 py-2">
            <span className="min-w-0 break-words"><span className="font-medium">{a.ticket}</span>{a.day && ` · ${fmtDay(a.day)} · ${a.minutes} min · ${a.client}`}</span>
            <span className={`min-w-0 break-words ${a.ok ? 'text-[hsl(var(--chart-4))]' : 'text-destructive'}`}>{a.outcome}</span>
          </li>
        ))}
        {!activity.length && <li className="py-3 text-muted-foreground">No completed tickets with your time yet.</li>}
      </ul>
    </div>
  );
}
