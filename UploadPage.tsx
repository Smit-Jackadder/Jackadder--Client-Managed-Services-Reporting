import { useEffect, useMemo, useState } from 'react';
import { Download, Loader2, PlugZap, Search, Upload } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@components/ui/alert-dialog';
import { getClientOptions } from '@generated/server/report';
import { getUploadTickets } from '@generated/server/upload';
import { harvestWrite } from '@generated/server/harvest';
import { memberWrite } from '@generated/server/admin';
import { useMemberHarvest } from '@generated/hooks/useMemberHarvest';
import { CLIENT_SETTINGS, EXCLUDED_CLIENT_LABELS, canonicalClient, resolveClient } from '@generated/settings';
import { todayDarwin, monthKey, firstOfMonth, lastOfMonth, addDays, fmtDay } from '@generated/lib/darwin';
import { useHarvest, downloadLogCsv } from '@generated/hooks/useHarvest';
import { actionFor, bodyFor, selectable, initialRow, ticketLabel, toHours, type UploadRow } from '@generated/lib/uploadPlan';
import type { WriteOp } from '@generated/lib/harvestTypes';
import { UploadTable, TaskSelect } from '@generated/components/upload/UploadTable';

type Period = 'weekly' | 'monthly';
const PROJECT_NAME = 'ISACNT Managed Services';
/** Monday of the week containing day (YYYY-MM-DD). */
const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
const input = 'h-10 w-full rounded-md border border-input bg-card px-3 text-sm';

export interface TeamMember { id: string; name: string; mondayUserId: string }

export function UploadPage({ member = null }: { member?: TeamMember | null }) {
  const [today, setToday] = useState('');
  const [client, setClient] = useState('ISACNT');
  const [clients, setClients] = useState<string[]>(CLIENT_SETTINGS.map((c) => c.name));
  const [period, setPeriod] = useState<Period>('monthly');
  const [anchor, setAnchor] = useState(''); const [month, setMonth] = useState('');
  useEffect(() => { const t = todayDarwin(); setToday(t); setAnchor(mondayOf(t)); setMonth(monthKey(t)); }, []);
  const { from, to } = useMemo(() => {
    // Periods never run past today (Darwin): no future entries.
    const cap = (d: string) => (today && d > today ? today : d);
    if (period === 'monthly') return month ? { from: firstOfMonth(month), to: cap(lastOfMonth(month)) } : { from: '', to: '' };
    if (!anchor) return { from: '', to: '' };
    const start = mondayOf(anchor);
    return { from: start, to: cap(addDays(start, 6)) };
  }, [period, anchor, month, today]);
  useEffect(() => {
    getClientOptions({ data: {} }).then((r) => { const n = new Set(CLIENT_SETTINGS.map((c) => c.name)); for (const l of r?.labels ?? []) if (!EXCLUDED_CLIENT_LABELS.includes(l.trim())) n.add(canonicalClient(l)); setClients([...n]); }).catch((e) => console.error(e));
  }, []);
  const wide = useMemo(() => (from && to ? { from: addDays(from, -62), to: addDays(to, 62) } : null), [from, to]);
  const h = useHarvest(wide);
  const m = useMemberHarvest(member?.id ?? null, wide);
  const s = member ? m.session : h.session;
  const entries = member ? m.entries : h.entries;
  useEffect(() => { setRows([]); setResults({}); }, [member?.id]); const ready = !!s?.emailMatch; const test = false; // Live only: uploads always create or update real Harvest entries.
  // The Harvest project is always "ISACNT Managed Services".
  const project = s?.projects.find((p) => p.name.trim().toLowerCase() === PROJECT_NAME.toLowerCase())
    ?? s?.projects.find((p) => /isacnt/i.test(`${p.name} ${p.clientName} ${p.code ?? ''}`) && /managed\s*services|-MS\d/i.test(`${p.name} ${p.code ?? ''}`)) ?? null;

  const [rows, setRows] = useState<UploadRow[]>([]);
  const [fetching, setFetching] = useState(false); const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [fetchInfo, setFetchInfo] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [bulkTask, setBulkTask] = useState<number | null>(null);
  const [confirm, setConfirm] = useState(false); const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});

  async function fetchTickets() {
    if (!from || !to || from > to) return;
    setFetching(true); setFetchErr(null); setFetchInfo(null); setResults({});
    try {
      const c = resolveClient(client);
      const res = await getUploadTickets({ data: { requestLabels: c.requestLabels, incidentLabels: c.incidentLabels, from, to, assigneeId: member?.mondayUserId } });
      const list = res?.tickets ?? [];
      setRows(list.map(initialRow)); setPicked(new Set());
      if (res?.errors?.length) setFetchErr(`Some tickets could not be read: ${res.errors.join(' · ')}`);
      const st = res?.stats;
      setFetchInfo(st ? `${client}${member ? ` · ${member.name}` : ''}: ${st.scanned} ticket(s) checked · ${list.length} time entr${list.length === 1 ? 'y' : 'ies'} across ${st.tickets} ticket(s) worked in this period · ${st.open} on tickets not yet completed${st.running ? ` · ${st.running} running timer(s) not counted` : ''}${st.unreadable ? ` · ${st.unreadable} ticket(s) with unreadable time logs` : ''}${st.notAssigned ? ` · ${st.notAssigned} time log(s) by people not assigned to the ticket, not included` : ''}.` : null);
    } catch (e) { console.error(e); setFetchErr(`Could not fetch tickets from the boards: ${e instanceof Error ? e.message : 'unknown error'}`); }
    finally { setFetching(false); }
  }
  // Default task for every ticket: "monday Managed Services" (rows can still be changed).
  const defaultTaskId = project?.tasks.find((t) => t.name.trim().toLowerCase() === 'monday managed services')?.id
    ?? project?.tasks.find((t) => /monday/i.test(t.name) && /managed\s*services/i.test(t.name))?.id ?? null;
  useEffect(() => {
    if (defaultTaskId) setRows((rs) => (rs.some((r) => !r.taskId) ? rs.map((r) => (r.taskId ? r : { ...r, taskId: defaultTaskId })) : rs));
  }, [defaultTaskId, rows.length]);
  const patch = (key: string, p: Partial<UploadRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const taskName = (id: number | null) => project?.tasks.find((t) => t.id === id)?.name ?? '—';
  const act = (r: UploadRow) => actionFor(r, entries, test, project?.id ?? null, s?.mondayUserId ?? null, taskName);
  const [skipUpd, setSkipUpd] = useState<Set<string>>(new Set());
  const future = (r: UploadRow) => !!today && r.date > today;
  const chosen = rows.filter((r) => picked.has(r.key) && act(r).kind !== 'skip' && !future(r) && !skipUpd.has(r.key));
  const pickedUpdates = rows.filter((r) => picked.has(r.key) && act(r).kind === 'update' && !future(r));
  const newOnes = chosen.filter((r) => act(r).kind === 'create');
  const [bulkDate, setBulkDate] = useState('');
  const totalMin = chosen.reduce((a, r) => a + (r.minutes ?? 0), 0);

  async function upload() {
    if (!s || !project || !chosen.length) return;
    setBusy(true);
    const dayStart = new Map<string, number>();
    const ops: WriteOp[] = chosen.map((r) => {
      const a = act(r); const st = dayStart.get(r.date) ?? 540; dayStart.set(r.date, st + Math.round(r.minutes ?? 0));
      return { rowKey: r.key, kind: a.kind === 'update' ? 'update' : 'create', entryId: a.kind === 'update' ? a.entry?.id : undefined, ticket: ticketLabel(r.t), body: bodyFor(r, project.id, test, s.timestampMode, st), test };
    });
    try {
      const res = member
        ? await memberWrite({ data: { memberId: member.id, ops: ops.map((o) => ({ ...o, kind: o.kind === 'update' ? 'update' as const : 'create' as const })) } })
        : await harvestWrite({ data: { auth: h.auth, userId: s.harvestUserId, ops } });
      const by = new Map((res?.results ?? []).map((x) => [x.rowKey, x]));
      const now = new Date().toISOString();
      h.addLog(ops.map((o) => { const x = by.get(o.rowKey); return { time: now, action: `UPLOAD ${o.kind.toUpperCase()}${member ? ` FOR ${member.name}` : ''}`, entryId: String(x?.entry?.id ?? o.entryId ?? ''), ticket: o.ticket, date: o.body.spent_date, hours: String(o.body.hours ?? `${o.body.started_time}-${o.body.ended_time}`), test: test ? 'yes' : 'no', result: x?.ok ? 'OK' : 'FAILED', detail: x?.error ?? JSON.stringify(o.body) }; }));
      setResults(Object.fromEntries(ops.map((o) => { const x = by.get(o.rowKey); return [o.rowKey, x?.ok ? { ok: true, text: `Saved #${x.entry?.id} · ${x.entry?.date} · ${x.entry?.hours} h · ${x.entry?.taskName}` } : { ok: false, text: `Failed: ${x?.error ?? 'unknown'}` }]; })));
      setPicked(new Set()); setSkipUpd(new Set()); await (member ? m.refresh() : h.refresh());
    } catch (e) { console.error(e); setResults({ _: { ok: false, text: 'Upload failed.' } }); }
    finally { setBusy(false); setConfirm(false); }
  }

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Jackadder International · Timesheets</p>
          <h1 className="font-[family-name:var(--font-heading)] text-3xl font-semibold tracking-tight">Harvest Monthly Data Upload</h1>
        </div>
        <span className={`rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wider ${test ? 'bg-[hsl(var(--warn)/0.15)] text-[hsl(var(--warn))]' : 'bg-destructive/10 text-destructive'}`}>{test ? 'Test mode' : 'Live mode'}</span>
      </header>

      <section className="grid gap-3 rounded-md border border-border bg-card p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {member ? (
          <div className="space-y-1 sm:col-span-2 lg:col-span-2"><span className="text-xs text-muted-foreground">Uploading for</span><p className="flex h-10 items-center gap-2 font-medium">{m.loading && <Loader2 className="h-4 w-4 animate-spin" />}{member.name} · their own Harvest login</p></div>
        ) : (<>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Harvest personal access token</span><input type="password" className={input} value={h.prefs.token} onChange={(e) => h.setPrefs({ token: e.target.value })} /></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Account ID</span><input className={input} inputMode="numeric" value={h.prefs.accountId} onChange={(e) => h.setPrefs({ accountId: e.target.value })} /></label>
        </>)}
        <div className="flex items-end gap-2 lg:col-span-2">
          {!member && <button onClick={() => void h.connect()} disabled={h.loading || !h.prefs.token || !h.prefs.accountId} className="inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 font-medium text-background disabled:opacity-40">{h.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}Sync to Harvest</button>}
          <span className="inline-flex h-10 items-center text-xs text-muted-foreground">Live: real Harvest entries</span>
          <button onClick={() => downloadLogCsv(h.log)} disabled={!h.log.length} className="ml-auto inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 disabled:opacity-40"><Download className="h-4 w-4" />Log ({h.log.length})</button>
        </div>
        {s && <p className="text-muted-foreground sm:col-span-2 lg:col-span-4">{s.harvestName} ({s.harvestEmail}) · {s.companyName} · {s.timestampMode ? 'start and end time' : 'duration'} tracking</p>}
        <p className="sm:col-span-2 lg:col-span-4"><span className="text-muted-foreground">Harvest project: </span>{project ? <span className="font-medium">{project.name}{project.code ? ` · code ${project.code}` : ' · no code set in Harvest'}{` · ${project.tasks.length} task(s)`}</span> : <span className="text-muted-foreground">{s ? '—' : `${PROJECT_NAME}. Click Sync to Harvest to load its code and tasks.`}</span>}</p>
        {s && !project && <p className="text-muted-foreground sm:col-span-2 lg:col-span-4">Your Harvest projects: {s.projects.map((p) => `${p.name}${p.code ? ` (${p.code})` : ''}`).join(', ') || 'none assigned'}.</p>}
        {s && !project && <p className="text-destructive sm:col-span-2 lg:col-span-4">The Harvest project “{PROJECT_NAME}” is not assigned to you in Harvest, so nothing can be uploaded.</p>}
        {s && !s.emailMatch && <p className="text-destructive sm:col-span-2 lg:col-span-4">{member ? `${member.name}'s Harvest email does not match their monday email (${s.mondayEmail || 'unknown'}). Update their token in Team admin.` : `Your Harvest email does not match your monday email (${s.mondayEmail || 'unknown'}). Use your own token.`}</p>}
        {(member ? m.error : h.error) && <p className="text-destructive sm:col-span-2 lg:col-span-4">{member ? m.error : h.error}</p>}
      </section>

      <section className="grid gap-3 rounded-md border border-border bg-card p-4 text-sm sm:grid-cols-2 lg:grid-cols-5">
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Client</span>
          <select className={input} value={client} onChange={(e) => { setClient(e.target.value); setRows([]); }}>{clients.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="space-y-1"><span className="text-xs text-muted-foreground">Date range</span>
          <select className={input} value={period} onChange={(e) => { setPeriod(e.target.value as Period); setRows([]); }}>
            <option value="weekly">Weekly</option><option value="monthly">Monthly</option>
          </select></label>
        {period === 'monthly' && <label className="space-y-1"><span className="text-xs text-muted-foreground">Month</span><input type="month" className={input} value={month} max={today ? monthKey(today) : undefined} onChange={(e) => setMonth(e.target.value)} /></label>}
        {period === 'weekly' && <label className="space-y-1"><span className="text-xs text-muted-foreground">Week of</span><input type="date" className={input} value={anchor} max={today || undefined} onChange={(e) => setAnchor(e.target.value)} /></label>}
        {<div className="space-y-1"><span className="text-xs text-muted-foreground">Period</span><p className="flex h-10 items-center tabular-nums">{from && to ? `${fmtDay(from)} – ${fmtDay(to)}` : '—'}</p></div>}
        <div className="flex items-end"><button onClick={() => void fetchTickets()} disabled={fetching || !from || !to || from > to} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 font-medium text-primary-foreground disabled:opacity-40">{fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}Fetch tickets</button></div>
        <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">Time is taken from the “Time worked on Ticket” logs for every ticket of the selected client, regardless of status, so work performed on tickets that remain open is also captured. Each entry represents one ticket and one person for the period: the time logged in the period is totalled and rounded once to the nearest 15-minute block (minimum 15), the same rule as the Client Billable Minutes column. The entry is dated the last day worked in the period. Notes use the Closing Notes for completed tickets and the Pending Notes (otherwise Support Team Notes) for open tickets. Project: {PROJECT_NAME}.</p>
        {fetchInfo && <p className="text-muted-foreground sm:col-span-2 lg:col-span-5">{fetchInfo}</p>}
        {fetchErr && <p className="text-destructive sm:col-span-2 lg:col-span-5">{fetchErr}</p>}
      </section>

      {fetching && !rows.length && <div className="h-64 animate-pulse rounded-md bg-muted" />}
      {rows.length > 0 && (
        <section className={`space-y-3 ${fetching ? 'opacity-60' : ''}`}>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <p className="w-full font-medium">Bulk update {picked.size ? `(${picked.size} selected)` : '— tick rows below'}</p>
            <p className="text-muted-foreground">{rows.length} tickets · {chosen.length} ready · {toHours(totalMin)} h</p>
            <div className="w-56"><TaskSelect label="Task for selected" project={project} value={bulkTask} onChange={setBulkTask} /></div>
            <button disabled={!bulkTask || !picked.size} onClick={() => setRows((rs) => rs.map((r) => (picked.has(r.key) ? { ...r, taskId: bulkTask } : r)))} className="h-9 rounded-md border border-border px-3 disabled:opacity-40">Apply task</button>
            <label className="flex items-center gap-2"><span className="text-xs text-muted-foreground">Entry date</span><input type="date" aria-label="Entry date for selected" className="h-9 rounded-md border border-input bg-card px-2" value={bulkDate} max={today || undefined} onChange={(e) => setBulkDate(e.target.value)} /></label>
            <button disabled={!bulkDate || bulkDate > today || !picked.size} onClick={() => setRows((rs) => rs.map((r) => (picked.has(r.key) ? { ...r, date: bulkDate } : r)))} className="h-9 rounded-md border border-border px-3 disabled:opacity-40">Apply date</button>
            <button disabled={!bulkTask} onClick={() => setRows((rs) => rs.map((r) => ({ ...r, taskId: r.taskId ?? bulkTask })))} className="h-9 rounded-md border border-border px-3 disabled:opacity-40">Apply to rows without task</button>
            <button onClick={() => setConfirm(true)} disabled={!ready || !chosen.length || busy} className="ml-auto inline-flex h-10 items-center gap-2 rounded-md bg-foreground px-4 font-medium text-background disabled:opacity-40"><Upload className="h-4 w-4" />Upload {chosen.length} to Harvest{test ? ' (test)' : ''}</button>
          </div>
          {!ready && <p className="text-sm text-muted-foreground">Connect Harvest to choose tasks and upload.</p>}
          <UploadTable rows={rows} entries={entries} project={project} testMode={test} picked={picked} results={results} maxDate={today} myId={s?.mondayUserId ?? null}
            onPick={(k, on) => setPicked((p) => { const n = new Set(p); if (on) n.add(k); else n.delete(k); return n; })}
            onPickAll={(on) => setPicked(on ? new Set(rows.filter((r) => selectable(act(r))).map((r) => r.key)) : new Set())} onChange={patch} />
        </section>
      )}
      {!rows.length && !fetching && <p className="py-10 text-center text-sm text-muted-foreground">Please select a client and reporting period, then select Fetch tickets.</p>}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Upload {chosen.length} entries ({toHours(totalMin)} h)?</AlertDialogTitle>
            <AlertDialogDescription>{test ? 'Test mode: each entry is marked “[TEST] ” and can be removed with Remove test entries.' : 'Live mode: these become real timesheet entries in Harvest.'} Project: {project?.name ?? '—'}.</AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="max-h-64 divide-y divide-border overflow-y-auto text-sm">
            {newOnes.map((r) => <li key={r.key} className="py-1.5">{act(r).label} · {r.date} · {toHours(r.minutes ?? 0)} h · {taskName(r.taskId)} · {r.notes}</li>)}
          </ul>
          {pickedUpdates.length > 0 && (
            <div className="space-y-2 rounded-md border border-[hsl(var(--warn))] p-3 text-sm">
              <p className="font-medium">Same item already in Harvest — changes made after upload ({pickedUpdates.length})</p>
              <p className="text-xs text-muted-foreground">These tickets are already uploaded, but they have changed on the board since. Do you want to update these entries? Untick any you want to leave as they are.</p>
              <ul className="max-h-64 divide-y divide-border overflow-y-auto">
                {pickedUpdates.map((r) => { const a = act(r); return (
                  <li key={r.key} className="flex gap-2 py-2">
                    <input type="checkbox" className="mt-0.5 h-4 w-4" aria-label={`Update ${ticketLabel(r.t)}`} checked={!skipUpd.has(r.key)} onChange={(e) => setSkipUpd((p) => { const n = new Set(p); if (e.target.checked) n.delete(r.key); else n.add(r.key); return n; })} />
                    <div className="min-w-0"><p className="font-medium">{ticketLabel(r.t)} · {r.t.name} · Harvest #{a.entry?.id}</p>
                      {a.changes?.map((c) => <p key={c.field} className="break-words text-xs"><span className="font-medium">{c.field}:</span> <span className="text-muted-foreground line-through">{c.from}</span> → {c.to}</p>)}</div>
                  </li>); })}
              </ul>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={busy} onClick={(e) => { e.preventDefault(); void upload(); }}>{busy ? 'Uploading…' : 'Confirm upload'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
