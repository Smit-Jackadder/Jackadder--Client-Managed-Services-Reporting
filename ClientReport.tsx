import { forwardRef } from 'react';
import type { Report } from '@generated/lib/compute';
import type { Block } from '@generated/lib/reportDoc';
import { UsageDonut, RollingChart, CarryChart, CarryForwardChart } from '@generated/components/Charts';

interface Props { report: Report; blocks: Block[] }

/** Client-facing report. Content comes solely from `blocks` so exports match exactly. */
export const ClientReport = forwardRef<HTMLDivElement, Props>(function ClientReport({ report, blocks }, ref) {
  return (
    <article ref={ref} className="mx-auto w-full max-w-[860px] rounded-md border border-border bg-[hsl(var(--paper))] px-5 py-10 text-[hsl(218_30%_14%)] shadow-[0_1px_0_hsl(var(--border)),0_12px_32px_-16px_hsl(218_30%_14%/0.25)] sm:px-12">
      {!report.isOfficial && (
        <div className="mb-6 flex justify-center">
          <span className="rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">Interim report, not a monthly record</span>
        </div>
      )}
      {blocks.map((b, i) => <BlockView key={i} b={b} report={report} />)}
    </article>
  );
});

function BlockView({ b, report }: { b: Block; report: Report }) {
  switch (b.type) {
    case 'client':
      return <h1 className="text-center font-[family-name:var(--font-heading)] text-3xl font-bold tracking-[0.08em] sm:text-4xl">{b.text}</h1>;
    case 'title':
      return <p className="mt-2 text-center text-lg font-light">{b.text}</p>;
    case 'h2':
      return <h2 className="mt-10 border-b border-[hsl(215_16%_84%)] pb-2 font-[family-name:var(--font-heading)] text-xl font-semibold">{b.text}</h2>;
    case 'p':
      return <p className={b.muted ? 'mt-3 text-xs leading-relaxed text-[hsl(218_12%_42%)]' : 'mt-3 text-sm leading-relaxed'}>{b.text}</p>;
    case 'chart':
      return (
        <figure className="mt-5">
          <figcaption className="mb-2 text-xs font-medium uppercase tracking-wider text-[hsl(218_12%_42%)]">{b.caption}</figcaption>
          <div data-chart={b.id} className="bg-[hsl(var(--paper))] p-2">
            {b.id === 'usage' && <UsageDonut req={report.usedRequest ?? 0} inc={report.usedIncidents ?? 0} />}
            {b.id === 'rolling' && <RollingChart rows={report.rolling} allocation={report.allocation} />}
            {b.id === 'carry' && report.carry && <CarryChart carry={report.carry} />}
            {b.id === 'carryforward' && <CarryForwardChart rows={report.rolling} />}
          </div>
        </figure>
      );
    case 'table':
      return (
        <div className="mt-4 max-w-full overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-sm">
            <thead>
              <tr>{b.head.map((h, i) => <th key={i} className="border-b-2 border-[hsl(218_30%_14%)] px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide">{h}</th>)}</tr>
            </thead>
            <tbody>
              {b.rows.map((r, i) => (
                <tr key={i} className="border-b border-[hsl(215_16%_88%)]">
                  {r.map((c, j) => <td key={j} className={`px-2 py-2 align-top ${/^-?\d+$|^—$|^Overage/.test(c) ? 'tabular-nums' : ''}`}>{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}
