import { useEffect, useState } from 'react';
import { Loader2, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { addAdmin, getTeamCandidates, removeAdmin, removeMember, saveMember, type getAdminState } from '@generated/server/admin';

type State = Awaited<ReturnType<typeof getAdminState>>;
type Person = { id: string; name: string; email: string };
const input = 'h-10 w-full rounded-md border border-input bg-card px-3 text-sm';

/** Manage admins and the team members' stored Harvest logins. */
export function TeamAdmin({ state, onChanged }: { state: State; onChanged: () => Promise<void> }) {
  const [people, setPeople] = useState<Person[]>([]);
  const [pick, setPick] = useState(''); const [token, setToken] = useState(''); const [account, setAccount] = useState('');
  const [adminPick, setAdminPick] = useState('');
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => { getTeamCandidates({ data: {} }).then((r) => setPeople(r?.people ?? [])).catch((e) => console.error(e)); }, []);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ ok: true, text: ok }); await onChanged(); }
    catch (e) { console.error(e); setMsg({ ok: false, text: e instanceof Error ? e.message : 'Something went wrong.' }); }
    finally { setBusy(false); }
  }
  const person = people.find((p) => p.id === pick);
  const adminPerson = people.find((p) => p.id === adminPick);

  return (
    <div className="space-y-5 text-sm">
      <section className="space-y-3 rounded-md border border-border bg-card p-4">
        <h2 className="font-[family-name:var(--font-heading)] text-lg font-medium">Team members' Harvest logins</h2>
        <p className="text-xs text-muted-foreground">Tokens are stored securely in the app and are never shown again or sent to the browser. Only admins can use them.</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Person</span>
            <select className={input} value={pick} onChange={(e) => setPick(e.target.value)}><option value="">Select a person</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Their Harvest personal access token</span><input type="password" className={input} value={token} onChange={(e) => setToken(e.target.value)} /></label>
          <label className="space-y-1"><span className="text-xs text-muted-foreground">Their account ID</span><input inputMode="numeric" className={input} value={account} onChange={(e) => setAccount(e.target.value)} /></label>
          <div className="flex items-end"><button disabled={busy || !person || token.length < 10 || !/^\d+$/.test(account.trim())} onClick={() => void run(async () => { await saveMember({ data: { mondayUserId: person!.id, name: person!.name, token: token.trim(), accountId: account.trim() } }); setToken(''); setAccount(''); setPick(''); }, `${person?.name ?? 'Member'} saved.`)} className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-foreground px-4 font-medium text-background disabled:opacity-40">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}Save login</button></div>
        </div>
        {state.members.length === 0 ? <p className="text-muted-foreground">No team members added yet.</p> : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {state.members.map((mb) => (
              <li key={mb.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <span className="min-w-0 flex-1"><span className="font-medium">{mb.name}</span> <span className="text-muted-foreground">· Harvest: {mb.harvestName} ({mb.harvestEmail}) · account {mb.accountId}</span></span>
                {!mb.emailMatch && <span className="text-xs text-destructive">Email differs from monday</span>}
                <button aria-label={`Remove ${mb.name}`} disabled={busy} onClick={() => void run(() => removeMember({ data: { id: mb.id } }), `${mb.name} removed.`)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-border bg-card p-4">
        <h2 className="font-[family-name:var(--font-heading)] text-lg font-medium">Admins</h2>
        <p className="text-xs text-muted-foreground">Any admin can add another admin. To hand the role over, add the new admin, then remove yourself.</p>
        <ul className="divide-y divide-border rounded-md border border-border">
          {state.admins.map((a) => (
            <li key={a.id} className="flex items-center gap-3 px-3 py-2">
              <ShieldCheck className="h-4 w-4 text-muted-foreground" /><span className="flex-1">{a.name}{a.mondayUserId === state.me ? ' (you)' : ''}</span>
              <button aria-label={`Remove admin ${a.name}`} disabled={busy || state.admins.length <= 1} onClick={() => void run(() => removeAdmin({ data: { id: a.id } }), `${a.name} is no longer an admin.`)} className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-40"><Trash2 className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end gap-3">
          <label className="w-64 space-y-1"><span className="text-xs text-muted-foreground">Add admin</span>
            <select className={input} value={adminPick} onChange={(e) => setAdminPick(e.target.value)}><option value="">Select a person</option>{people.filter((p) => !state.admins.some((a) => a.mondayUserId === p.id)).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <button disabled={busy || !adminPerson} onClick={() => void run(async () => { await addAdmin({ data: { mondayUserId: adminPerson!.id, name: adminPerson!.name } }); setAdminPick(''); }, `${adminPerson?.name ?? 'Person'} is now an admin.`)} className="h-10 rounded-md border border-border px-4 disabled:opacity-40">Add admin</button>
        </div>
      </section>
      {msg && <p className={msg.ok ? 'text-muted-foreground' : 'text-destructive'}>{msg.text}</p>}
    </div>
  );
}
