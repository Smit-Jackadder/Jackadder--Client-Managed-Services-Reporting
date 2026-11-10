import { useCallback, useEffect, useState } from 'react';
import { memberConnect, memberEntries } from '@generated/server/admin';
import type { HvEntry, HvSession } from '@generated/lib/harvestTypes';

/** Harvest session for a team member, using the login stored for them by an admin. */
export function useMemberHarvest(memberId: string | null, range: { from: string; to: string } | null) {
  const [session, setSession] = useState<HvSession | null>(null);
  const [entries, setEntries] = useState<HvEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSession(null); setEntries([]); setError(null);
    if (!memberId) return;
    let active = true;
    setLoading(true);
    memberConnect({ data: { memberId } })
      .then((s) => { if (active) setSession(s); })
      .catch((e) => { console.error(e); if (active) setError(`Could not connect to this person's Harvest: ${e instanceof Error ? e.message : 'unknown error'}`); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [memberId]);

  const refresh = useCallback(async () => {
    if (!memberId || !session || !range) return;
    setLoading(true);
    try { const res = await memberEntries({ data: { memberId, from: range.from, to: range.to } }); setEntries(res?.entries ?? []); }
    catch (e) { console.error(e); setError("Could not read this person's Harvest entries."); }
    finally { setLoading(false); }
  }, [memberId, session, range?.from, range?.to]);
  useEffect(() => { void refresh(); }, [refresh]);

  return { session, entries, refresh, loading, error };
}
