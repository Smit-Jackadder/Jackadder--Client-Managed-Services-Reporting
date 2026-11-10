import { useCallback, useEffect, useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { UploadPage } from '@generated/components/upload/UploadPage';
import { TeamAdmin } from '@generated/components/upload/TeamAdmin';
import { claimAdmin, getAdminState } from '@generated/server/admin';

export const Route = createFileRoute('/_app/harvest')({ component: HarvestUpload });

type State = Awaited<ReturnType<typeof getAdminState>>;
type Tab = 'mine' | 'team' | 'admin';

function HarvestUpload() {
  const [state, setState] = useState<State | null>(null);
  const [tab, setTab] = useState<Tab>('mine');
  const [memberId, setMemberId] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setState(await getAdminState({ data: {} })); setErr(null); }
    catch (e) { console.error(e); setErr('Could not load admin settings.'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const member = state?.members.find((m) => m.id === memberId) ?? null;
  const tabBtn = (t: Tab, label: string) => (
    <button key={t} onClick={() => setTab(t)} className={`h-10 border-b-2 px-3 text-sm ${tab === t ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>{label}</button>
  );

  return (
    <div className="min-h-screen bg-background px-4 py-8 font-[family-name:var(--font-body)] text-foreground sm:px-8">
      <div className="mx-auto mb-5 flex max-w-[1280px] flex-wrap items-center gap-1 border-b border-border">
        {tabBtn('mine', 'My upload')}
        {state?.isAdmin && tabBtn('team', 'Team upload')}
        {state?.isAdmin && tabBtn('admin', 'Team admin')}
        {state?.noAdminsYet && <button onClick={() => void claimAdmin({ data: {} }).then(load).catch((e: Error) => setErr(e.message))} className="ml-auto h-9 rounded-md border border-border px-3 text-sm">Become admin</button>}
        {err && <span className="ml-auto text-sm text-destructive">{err}</span>}
      </div>
      {tab === 'mine' && <UploadPage />}
      {tab === 'team' && state?.isAdmin && (
        <div className="space-y-5">
          <div className="mx-auto flex max-w-[1280px] flex-wrap items-end gap-3 text-sm">
            <label className="w-72 space-y-1"><span className="text-xs text-muted-foreground">Team member</span>
              <select className="h-10 w-full rounded-md border border-input bg-card px-3" value={memberId} onChange={(e) => setMemberId(e.target.value)}>
                <option value="">Select a person</option>{state.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select></label>
            <p className="pb-2 text-xs text-muted-foreground">Fetches tickets assigned to this person and only the time they logged, then uploads to their own Harvest.{state.members.length === 0 ? ' Add team members in Team admin first.' : ''}</p>
          </div>
          {member ? <UploadPage key={member.id} member={{ id: member.id, name: member.name, mondayUserId: member.mondayUserId }} /> : <p className="py-10 text-center text-sm text-muted-foreground">Select a team member to fetch their tickets.</p>}
        </div>
      )}
      {tab === 'admin' && state?.isAdmin && <div className="mx-auto max-w-[1280px]"><TeamAdmin state={state} onChanged={load} /></div>}
    </div>
  );
}
