// Australia/Darwin is a fixed UTC+09:30 (no daylight saving).
const OFFSET_MS = 9.5 * 60 * 60 * 1000;
const DAY_MS = 86400000;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Darwin calendar day 'YYYY-MM-DD' for an ISO timestamp. null if unparseable. */
export function darwinDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  return new Date(ms + OFFSET_MS).toISOString().slice(0, 10);
}

export function todayDarwin(): string {
  return new Date(Date.now() + OFFSET_MS).toISOString().slice(0, 10);
}

/** Darwin day → UTC ms at Darwin midnight. */
export function dayStartMs(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) - OFFSET_MS;
}

function parts(day: string) {
  const [y, m, d] = day.split('-').map(Number);
  return { y: y ?? 0, m: m ?? 1, d: d ?? 1 };
}
const pad = (n: number) => String(n).padStart(2, '0');

export function monthKey(day: string): string {
  return day.slice(0, 7);
}
export function firstOfMonth(mk: string): string {
  return `${mk}-01`;
}
export function lastOfMonth(mk: string): string {
  const { y, m } = parts(`${mk}-01`);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${mk}-${pad(last)}`;
}
export function addMonths(mk: string, n: number): string {
  const { y, m } = parts(`${mk}-01`);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${pad((idx % 12) + 1)}`;
}
export function monthsBetween(a: string, b: string): string[] {
  const out: string[] = [];
  let cur = a;
  while (cur <= b) {
    out.push(cur);
    cur = addMonths(cur, 1);
  }
  return out;
}
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}
export function daysInclusive(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}
export function monthLabel(mk: string): string {
  const { y, m } = parts(`${mk}-01`);
  return `${MONTHS[m - 1]} ${y}`;
}
export function shortMonthLabel(mk: string): string {
  const { y, m } = parts(`${mk}-01`);
  return `${SHORT[m - 1]} ${y}`;
}
export function fmtDay(day: string | null | undefined): string {
  if (!day) return '—';
  const { y, m, d } = parts(day);
  return `${d} ${SHORT[m - 1]} ${y}`;
}
export function fmtDayLong(day: string): string {
  const { y, m, d } = parts(day);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
