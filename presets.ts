import { monthKey, firstOfMonth, lastOfMonth, addMonths } from '@generated/lib/darwin';

export type PresetId = 'this' | 'last' | 'last3' | 'contract' | 'custom';

export function resolvePreset(id: PresetId, today: string, contractStart: string | null, contractMonths: number): { from: string; to: string; label: string } | null {
  const mk = monthKey(today);
  if (id === 'this') return { from: firstOfMonth(mk), to: today, label: 'This month' };
  if (id === 'last') { const p = addMonths(mk, -1); return { from: firstOfMonth(p), to: lastOfMonth(p), label: 'Last month' }; }
  if (id === 'last3') return { from: firstOfMonth(addMonths(mk, -2)), to: today, label: 'Last 3 months' };
  if (id === 'contract') {
    if (!contractStart) return null;
    const firstEnd = addMonths(contractStart, contractMonths - 1);
    if (lastOfMonth(firstEnd) >= today) return { from: firstOfMonth(contractStart), to: today, label: 'Contract year to date' };
    // Most recent complete contract year.
    let start = contractStart;
    while (lastOfMonth(addMonths(start, 2 * contractMonths - 1)) < today) start = addMonths(start, contractMonths);
    return { from: firstOfMonth(start), to: lastOfMonth(addMonths(start, contractMonths - 1)), label: 'Last contract year' };
  }
  return null;
}
