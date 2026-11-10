import { useCallback, useEffect, useState } from 'react';
import { harvestConnect, harvestEntries } from '@generated/server/harvest';
import type { HvEntry, HvSession, LogRow } from '@generated/lib/harvestTypes';

const LS = 'sdr-harvest-v1';
export interface HvPrefs { token: string; accountId: string; testMode: boolean; projectCodes: Record<string, string>; testProjectCode: string; autoSync: boolean; lookbackDays: number }
const DEFAULTS: HvPrefs = { token: '', accountId: '', testMode: false, projectCodes: { ISACNT: 'ISACNT-MS1' }, testProjectCode: '', autoSync: false, lookbackDays: 3 };

export function useHarvest(range: { from: string; to: string } | null) {
  const [prefs, setPrefsState] = useState<HvPrefs>(DEFAULTS);
  const [session, setSession] = useState<HvSession | null>(null);
  const [entries, setEntries] = useState<HvEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [log, setLog] = useState<LogRow[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS);
      if (!raw) return;
      const p = { ...DEFAULTS, ...(JSON.parse(raw) as Partial<HvPrefs>), testMode: false };
      setPrefsState(p);
      // Reconnect automatically with the saved token so auto-sync resumes after a reload.
      if (p.token.trim() && /^\d+$/.test(p.accountId.trim())) {
        setLoading(true);
        harvestConnect({ data: { auth: { token: p.token.trim(), accountId: p.accountId.trim() } } })
          .then((s) => setSession(s)).catch((e) => console.error(e)).finally(() => setLoading(false));
      }
    } catch { /* ignore */ }
  }, []);
  const setPrefs = useCallback((p: Partial<HvPrefs>) => {
    setPrefsState((cur) => { const next = { ...cur, ...p }; try { localStorage.setItem(LS, JSON.stringify(next)); } catch { /* ignore */ } return next; });
  }, []);
  const auth = { token: prefs.token.trim(), accountId: prefs.accountId.trim() };

  const connect = async () => {
    setLoading(true); setError(null);
    try { setSession(await harvestConnect({ data: { auth } })); }
    catch (e) { console.error(e); setSession(null); setError('Could not connect to Harvest. Check the token and account ID.'); }
    finally { setLoading(false); }
  };

  const refresh = useCallback(async () => {
    if (!session || !range) return;
    setLoading(true); setError(null);
    try { const res = await harvestEntries({ data: { auth, userId: session.harvestUserId, from: range.from, to: range.to } }); setEntries(res?.entries ?? []); }
    catch (e) { console.error(e); setError('Could not read Harvest entries.'); }
    finally { setLoading(false); }
  }, [session, range?.from, range?.to, prefs.token, prefs.accountId]);
  useEffect(() => { void refresh(); }, [refresh]);

  const addLog = (rows: LogRow[]) => setLog((l) => [...l, ...rows]);
  return { prefs, setPrefs, auth, session, connect, disconnect: () => { setSession(null); setEntries([]); }, entries, setEntries, refresh, loading, error, log, addLog };
}
export type HarvestCtx = ReturnType<typeof useHarvest>;

export function downloadLogCsv(log: LogRow[]) {
  const cols: (keyof LogRow)[] = ['time', 'action', 'entryId', 'ticket', 'date', 'hours', 'result', 'detail'];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const csv = [cols.join(','), ...log.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = `harvest_write_log_${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.csv`;
  a.click(); URL.revokeObjectURL(a.href);
}
