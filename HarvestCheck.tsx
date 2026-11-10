import type { Group } from '@generated/lib/compute';
import { isTestish, type HvEntry } from '@generated/lib/harvestTypes';
import { matchReal } from '@generated/lib/harvestPlan';
import { fmtDay } from '@generated/lib/darwin';

/** Read-only comparison. Test entries are excluded from every match and total. */
export function HarvestCheck({ groups, entries }: { groups: Group[]; entries: HvEntry[] }) {
  const real = entries.filter((e) => !isTestish(e));
  const rows = groups.map((g) => {
    const { linked, byNotes } = matchReal(g, entries);
    const hvMin = Math.round([...linked, ...byNotes].reduce((a, e) => a + e.hours * 60, 0));
    return { g, hvMin, via: linked.length ? 'Link' : byNotes.length ? 'Notes' : '—' };
  });
  const appTotal = groups.reduce((a, g) => a + g.minutes, 0);
  const byProject = new Map<string, number>();
  for (const e of real) { const k = e.projectCode || e.projectName || '—'; byProject.set(k, (byProject.get(k) ?? 0) + e.hours * 60); }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-6 text-sm">
        <p><span className="text-muted-foreground">App minutes (you): </span><span className="font-medium tabular-nums">{appTotal}</span></p>
        {[...byProject.entries()].sort().map(([code, min]) => (
          <p key={code}><span className="text-muted-foreground">Harvest {code}: </span><span className="font-medium tabular-nums">{Math.round(min)} min</span></p>
        ))}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr><th className="py-2 pr-3">Day</th><th className="pr-3">Ticket</th><th className="pr-3 text-right">App</th><th className="pr-3 text-right">Harvest</th><th className="pr-3">Matched by</th><th>Result</th></tr>
          </thead>
          <tbody>
            {rows.map(({ g, hvMin, via }) => {
              const diff = hvMin - g.minutes;
              return (
                <tr key={`${g.kind}|${g.ticketId}|${g.day}`} className="border-t border-border">
                  <td className="py-1.5 pr-3 tabular-nums">{fmtDay(g.day)}</td>
                  <td className="pr-3">{g.displayId ?? g.ticketId} {g.ticketName}</td>
                  <td className="pr-3 text-right tabular-nums">{g.minutes}</td>
                  <td className="pr-3 text-right tabular-nums">{hvMin}</td>
                  <td className="pr-3">{via}</td>
                  <td className={diff === 0 ? 'text-[hsl(var(--chart-4))]' : 'text-destructive'}>{via === '—' ? 'Missing in Harvest' : diff === 0 ? 'Match' : `Differs by ${diff}`}</td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={6} className="py-4 text-muted-foreground">You have no billable entries in this range.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
