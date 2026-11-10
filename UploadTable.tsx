import { fmtDay } from '@generated/lib/darwin';
import type { HvProject, HvEntry } from '@generated/lib/harvestTypes';
import { actionFor, selectable, ticketLabel, toHours, type UploadRow } from '@generated/lib/uploadPlan';

interface Props {
  maxDate: string; myId: string | null;
  rows: UploadRow[]; entries: HvEntry[]; project: HvProject | null; testMode: boolean;
  picked: Set<string>; onPick: (key: string, on: boolean) => void; onPickAll: (on: boolean) => void;
  onChange: (key: string, patch: Partial<UploadRow>) => void;
  results: Record<string, { ok: boolean; text: string }>;
}

const cell = 'h-9 w-full rounded border border-input bg-card px-2 text-sm';

export function TaskSelect({ project, value, onChange, label }: { project: HvProject | null; value: number | null; onChange: (id: number | null) => void; label: string }) {
  const tasks = project?.tasks ?? [];
  return (
    <select aria-label={label} className={cell} value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}>
      <option value="">{project ? 'Select task…' : 'Sync to Harvest first'}</option>
      <optgroup label="Billable">{tasks.filter((t) => t.billable !== false).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
      <optgroup label="Non-billable">{tasks.filter((t) => t.billable === false).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>
    </select>
  );
}

export function UploadTable({ rows, entries, project, testMode, picked, onPick, onPickAll, onChange, results, maxDate, myId }: Props) {
  const taskName = (id: number | null) => project?.tasks.find((t) => t.id === id)?.name ?? '—';
  const actionable = rows.filter((r) => { const a = actionFor(r, entries, testMode, project?.id ?? null, myId, taskName); return selectable(a); });
  const allOn = actionable.length > 0 && actionable.every((r) => picked.has(r.key));
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[1300px] text-sm">
        <thead className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
          <tr>
            <th className="w-10 px-3 py-2"><input type="checkbox" aria-label="Select all" className="h-4 w-4" checked={allOn} onChange={(e) => onPickAll(e.target.checked)} /></th>
            <th className="px-2 py-2">Ticket</th><th className="w-28 px-2 py-2">Date created</th><th className="w-28 px-2 py-2">Status</th><th className="w-28 px-2 py-2">Date completed</th><th className="w-36 px-2 py-2">Worked on / entry date</th><th className="w-52 px-2 py-2">Task</th>
            <th className="px-2 py-2">Notes</th><th className="w-28 px-2 py-2 text-right">Minutes</th><th className="w-56 px-2 py-2">Harvest</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => {
            const a = actionFor(r, entries, testMode, project?.id ?? null, myId, taskName);
            const res = results[r.key];
            return (
              <tr key={r.key} className="align-top">
                <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${ticketLabel(r.t)}`} className="h-4 w-4" disabled={!selectable(a)} checked={picked.has(r.key) && selectable(a)} onChange={(e) => onPick(r.key, e.target.checked)} /></td>
                <td className="px-2 py-2">
                  <p className="max-w-[18rem] break-words font-medium">{r.t.name || "(no name)"} <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">{r.t.kind}</span></p>
                  <p className="text-xs text-muted-foreground">Worked by {r.t.personName} · {r.t.sessions} log(s) on {r.t.days.length} day(s)</p>
                </td>
                <td className="px-2 py-2 tabular-nums">{r.t.created ? fmtDay(r.t.created) : "—"}</td>
                <td className="px-2 py-2"><span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${r.t.done ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground"}`}>{r.t.status ?? "No status"}</span></td>
                <td className="px-2 py-2 tabular-nums">{r.t.done && r.t.completed ? fmtDay(r.t.completed) : "-"}</td>
                <td className="px-2 py-2"><input type="date" aria-label="Entry date" className={cell} value={r.date} max={maxDate || undefined} onChange={(e) => onChange(r.key, { date: e.target.value })} />{maxDate && r.date > maxDate && <p className="mt-1 text-xs text-destructive">Future date — not allowed</p>}</td>
                <td className="px-2 py-2"><TaskSelect label="Task" project={project} value={r.taskId} onChange={(id) => onChange(r.key, { taskId: id })} /></td>
                <td className="px-2 py-2"><textarea aria-label="Notes" rows={2} className="w-full min-w-[14rem] rounded border border-input bg-card px-2 py-1 text-sm" value={r.notes} onChange={(e) => onChange(r.key, { notes: e.target.value })} /></td>
                <td className="px-2 py-2 text-right">
                  <input aria-label="Minutes" inputMode="decimal" className={`${cell} text-right tabular-nums`} value={r.minutes ?? ''} onChange={(e) => onChange(r.key, { minutes: e.target.value.trim() === '' || Number.isNaN(Number(e.target.value)) ? null : Number(e.target.value) })} />
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">{r.minutes != null ? `${toHours(r.minutes)} h` : 'no value'} · logged {Math.round(r.t.rawSeconds / 60)} min{r.t.boardBillable != null ? ` · board Client Billable ${r.t.boardBillable}` : ""}</p>
                </td>
                <td className="px-2 py-2 text-xs">
                  <p className={a.kind === 'skip' ? 'text-muted-foreground' : 'font-medium'}>{a.label}</p>
                  {a.entry && <p className="text-muted-foreground">#{a.entry.id} · {a.entry.date} · {a.entry.hours} h</p>}
                  {!!a.changes?.length && <div className="mt-1 rounded border border-[hsl(var(--warn))] p-1.5"><p className="font-medium text-[hsl(var(--warn))]">What changed</p>{a.changes.map((c) => <p key={c.field} className="break-words"><span className="font-medium">{c.field}:</span> <span className="text-muted-foreground line-through">{c.from.length > 60 ? `${c.from.slice(0, 60)}…` : c.from}</span> → {c.to.length > 60 ? `${c.to.slice(0, 60)}…` : c.to}</p>)}</div>}
                  {testMode && a.entry && <p className="text-[hsl(var(--warn))]">Real entry exists. The test entry adds hours to your timesheet until removed.</p>}
                  {res && <p className={res.ok ? 'text-[hsl(var(--chart-4))]' : 'text-destructive'}>{res.text}</p>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
