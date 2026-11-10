/**
 * Round a group's raw seconds to billable minutes.
 * ≤ 22.5 min → 15; otherwise 15 × ceil((raw − 7.5) / 15). Ties round down.
 * Works in whole seconds to avoid floating-point drift.
 */
export function roundBillable(rawSeconds: number): number {
  if (rawSeconds <= 0) return 0;
  if (rawSeconds <= 1350) return 15; // 22.5 min
  // ceil((s - 450) / 900) using integer maths
  return 15 * Math.ceil((rawSeconds - 450) / 900);
}

/** Verified examples from the spec (checked at startup of the internal panel). */
export const ROUNDING_EXAMPLES: { seconds: number; label: string; expected: number }[] = [
  { seconds: 1350, label: '22 min 30 s', expected: 15 },
  { seconds: 1351, label: '22 min 31 s', expected: 30 },
  { seconds: 2250, label: '37 min 30 s', expected: 30 },
  { seconds: 2251, label: '37 min 31 s', expected: 45 },
  { seconds: 60, label: '1 min', expected: 15 },
];

export function roundingSelfCheck(): { label: string; expected: number; got: number; ok: boolean }[] {
  return ROUNDING_EXAMPLES.map((e) => {
    const got = roundBillable(e.seconds);
    return { label: e.label, expected: e.expected, got, ok: got === e.expected };
  });
}
