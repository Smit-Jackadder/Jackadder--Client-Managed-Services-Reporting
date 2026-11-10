import { PieChart, Pie, Cell, ResponsiveContainer, ComposedChart, Bar, XAxis, YAxis, CartesianGrid, ReferenceLine, LabelList, Legend, BarChart } from 'recharts';
import type { Report } from '@generated/lib/compute';

// Charts sit on the white "paper" report; fixed, print-safe colours for export fidelity.
export const COLORS = { incidents: '#2167C9', requests: '#F7BE1E', ink: '#1C2533', grid: '#D9DEE6', neg: '#C8372D', neutral: '#7A8494', pos: '#2F8F5B' };

export function UsageDonut({ req, inc }: { req: number; inc: number }) {
  const total = req + inc;
  const data = [
    { name: 'Service requests', value: req, color: COLORS.requests },
    { name: 'Incidents', value: inc, color: COLORS.incidents },
  ];
  const pct = (v: number) => (total ? `${((v / total) * 100).toFixed(1)}%` : '0%');
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative h-52 w-52 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={total ? data : [{ name: 'none', value: 1, color: COLORS.grid }]} dataKey="value" innerRadius={62} outerRadius={96} stroke="#fff" strokeWidth={2} isAnimationActive={false}>
              {(total ? data : [{ color: COLORS.grid }]).map((d, i) => <Cell key={i} fill={d.color} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums" style={{ color: COLORS.ink }}>{total}</span>
          <span className="text-xs" style={{ color: COLORS.neutral }}>minutes</span>
        </div>
      </div>
      <ul className="space-y-2 text-sm" style={{ color: COLORS.ink }}>
        {data.map((d) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: d.color }} />
            <span>{d.name}: <b className="tabular-nums">{d.value}</b> min ({pct(d.value)})</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RollingChart({ rows, allocation }: { rows: Report['rolling']; allocation: number }) {
  const data = rows.map((r) => ({ ...r, inc: r.inc ?? 0, req: r.req ?? 0, totalLabel: r.total ?? '—' }));
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: COLORS.ink, fontSize: 12 }} axisLine={{ stroke: COLORS.grid }} tickLine={false} />
          <YAxis tick={{ fill: COLORS.neutral, fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
          <Legend wrapperStyle={{ fontSize: 12, color: COLORS.ink }} />
          <Bar dataKey="inc" name="Incidents (min)" stackId="a" fill={COLORS.incidents} isAnimationActive={false} />
          <Bar dataKey="req" name="Requests (min)" stackId="a" fill={COLORS.requests} isAnimationActive={false}>
            <LabelList dataKey="totalLabel" position="top" fill={COLORS.ink} fontSize={12} fontWeight={600} />
          </Bar>
          <ReferenceLine y={allocation} ifOverflow="extendDomain" stroke={COLORS.ink} strokeDasharray="6 4" label={{ value: `Allocation ${allocation}`, position: 'insideTopRight', fill: COLORS.ink, fontSize: 11 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CarryChart({ carry }: { carry: NonNullable<Report['carry']> }) {
  const closingName = carry.closing != null && carry.closing < 0 ? 'Overage' : carry.partial ? 'Balance to date' : 'Closing';
  const data = [
    { name: 'Opening', value: carry.opening, color: COLORS.neutral },
    { name: 'Allocation', value: carry.allocation, color: COLORS.incidents },
    { name: 'Used', value: carry.used, color: COLORS.requests },
    { name: closingName, value: carry.closing == null ? null : Math.abs(carry.closing), color: carry.closing != null && carry.closing < 0 ? COLORS.neg : COLORS.pos },
  ].map((d) => ({ ...d, v: d.value ?? 0, lbl: d.value == null ? '—' : d.value }));
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 24, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="name" tick={{ fill: COLORS.ink, fontSize: 12 }} axisLine={{ stroke: COLORS.grid }} tickLine={false} />
          <YAxis tick={{ fill: COLORS.neutral, fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
          <Bar dataKey="v" isAnimationActive={false} radius={[3, 3, 0, 0]}>
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
            <LabelList dataKey="lbl" position="top" fill={COLORS.ink} fontSize={12} fontWeight={600} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Per month: carried forward in + allocation (stacked = available), used, carried forward out. */
export function CarryForwardChart({ rows }: { rows: Report['rolling'] }) {
  const data = rows.map((r) => {
    const avail = r.opening == null || r.allocation == null ? null : r.opening + r.allocation;
    return {
      label: r.label,
      cin: Math.max(r.opening ?? 0, 0), alloc: r.allocation ?? 0,
      availLbl: avail == null ? '—' : `Available ${avail}`,
      used: r.total ?? 0, usedLbl: r.total == null ? '—' : r.total,
      out: r.closing == null ? 0 : Math.abs(r.closing),
      outLbl: r.closing == null ? '—' : r.closing < 0 ? `Overage ${Math.abs(r.closing)}` : r.closing,
      neg: r.closing != null && r.closing < 0,
    };
  });
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 28, right: 16, left: 0, bottom: 0 }} barGap={6}>
          <CartesianGrid stroke={COLORS.grid} vertical={false} />
          <XAxis dataKey="label" tick={{ fill: COLORS.ink, fontSize: 12 }} axisLine={{ stroke: COLORS.grid }} tickLine={false} />
          <YAxis tick={{ fill: COLORS.neutral, fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
          <Legend wrapperStyle={{ fontSize: 12, color: COLORS.ink }} />
          <Bar dataKey="cin" name="Carried forward in" stackId="avail" fill={COLORS.neutral} isAnimationActive={false}>
            <LabelList dataKey="cin" position="center" fill="#ffffff" fontSize={11} formatter={(v: unknown) => (Number(v) > 0 ? String(v) : "")} />
          </Bar>
          <Bar dataKey="alloc" name="Monthly allocation" stackId="avail" fill={COLORS.incidents} isAnimationActive={false}>
            <LabelList dataKey="alloc" position="center" fill="#ffffff" fontSize={11} />
            <LabelList dataKey="availLbl" position="top" fill={COLORS.ink} fontSize={11} fontWeight={600} />
          </Bar>
          <Bar dataKey="used" name="Minutes used" fill={COLORS.requests} isAnimationActive={false}>
            <LabelList dataKey="usedLbl" position="top" fill={COLORS.ink} fontSize={11} fontWeight={600} />
          </Bar>
          <Bar dataKey="out" name="Carried forward out" fill={COLORS.pos} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.label} fill={d.neg ? COLORS.neg : COLORS.pos} />)}
            <LabelList dataKey="outLbl" position="top" fill={COLORS.ink} fontSize={11} fontWeight={600} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
