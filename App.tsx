import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { TicketSync } from '@generated/components/harvest/TicketSync';
import { getClientOptions, getReportData, saveDraftRecord, finalizeRecord, uploadReportPdf } from '@generated/server/report';
import { buildPdfBlob, captureCharts } from '@generated/lib/exports';
import { CLIENT_SETTINGS, EXCLUDED_CLIENT_LABELS, canonicalClient, resolveClient } from '@generated/settings';
import { resolvePreset, type PresetId } from '@generated/lib/presets';
import { todayDarwin, monthKey, firstOfMonth, lastOfMonth, monthLabel, fmtDay } from '@generated/lib/darwin';
import { buildReport, type Report } from '@generated/lib/compute';
import { buildBlocks } from '@generated/lib/reportDoc';
import { Setup, type ClientOption } from '@generated/components/Setup';
import { ClientReport } from '@generated/components/ClientReport';
import { InternalPanel } from '@generated/components/InternalPanel';
import { ExportBar } from '@generated/components/ExportBar';
import { HarvestPanel } from '@generated/components/harvest/HarvestPanel';

function blockedReason(name: string): string | null {
  const c = resolveClient(name);
  if (c.allocation == null) return 'no allocation set';
  if (!c.contractStart) return 'no contract start set';
  return null;
}

export default function App() {
  const search = useSearch({ from: '/_app/report' });
  const [today, setToday] = useState('');
  const [clients, setClients] = useState<ClientOption[]>(CLIENT_SETTINGS.map((c) => ({ name: c.name, blockedReason: blockedReason(c.name) })));
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState<string | null>(null);
  const [client, setClient] = useState('ISACNT');
  const [preset, setPreset] = useState<PresetId>('last');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [meta, setMeta] = useState({ pages: { requests: 0, incidents: 0 }, items: 0 });
  const [saveStatus, setSaveStatus] = useState('');
  const [draftSaved, setDraftSaved] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const reportRef = useRef<HTMLDivElement | null>(null);
  const [pendingPdf, setPendingPdf] = useState<string | null>(null);

  useEffect(() => { setToday(todayDarwin()); }, []);
  useEffect(() => {
    getClientOptions({ data: {} })
      .then((res) => {
        const names = new Set(CLIENT_SETTINGS.map((c) => c.name));
        for (const l of res?.labels ?? []) if (!EXCLUDED_CLIENT_LABELS.includes(l.trim())) names.add(canonicalClient(l));
        setClients([...names].map((n) => ({ name: n, blockedReason: blockedReason(n) })));
      })
      .catch((e) => { console.error(e); setClientsError('Could not load clients from the boards.'); })
      .finally(() => setClientsLoading(false));
  }, []);

  const setting = client ? resolveClient(client) : null;
  const range = useMemo(() => {
    if (!today) return null;
    if (preset === 'custom') return customFrom && customTo && customFrom <= customTo ? { from: customFrom, to: customTo } : null;
    return resolvePreset(preset, today, setting?.contractStart ?? null, setting?.contractMonths ?? 12);
  }, [preset, today, customFrom, customTo, setting?.contractStart, setting?.contractMonths]);
  const rangeError = preset === 'custom' ? (customFrom && customTo && customFrom > customTo ? 'From must be on or before To.' : 'Pick From and To dates.') : preset === 'contract' ? 'This client has no contract start set.' : null;
  const isOfficial = !!range && monthKey(range.from) === monthKey(range.to) && range.from === firstOfMonth(monthKey(range.from)) && (range.to === lastOfMonth(monthKey(range.to)) || (range.to === today && monthKey(range.to) === monthKey(today)));
  const contractLabel = setting?.contractStart && today ? resolvePreset('contract', today, setting.contractStart, setting.contractMonths)?.label ?? 'Contract year' : 'Contract year to date';
  const blocked = client ? blockedReason(client) : 'select a client';

  async function generate() {
    if (!setting || !range || blocked) return;
    setGenerating(true); setError(null); setDraftSaved(false);
    try {
      const data = await getReportData({ data: { requestLabels: setting.requestLabels, incidentLabels: setting.incidentLabels, withRecords: setting.hasRecordsBoard } });
      if (!data) throw new Error('No data returned');
      const r = buildReport(data, setting, range.from, range.to, today);
      setReport(r); setMeta({ pages: data.pagesRead, items: data.tickets.length });
      if (!r.isOfficial) { setSaveStatus('Interim: no record created or changed.'); return; }
      const o = r.official!;
      if (o.isFinal) { setSaveStatus(`${o.name} is Final and locked. Saved record values are shown and were not changed.`); return; }
      if (o.saveBlockedReason || !o.values) { setSaveStatus(`Not saved because ${o.saveBlockedReason ?? 'values are incomplete'}.`); return; }
      const res = await saveDraftRecord({ data: { name: o.name, values: o.values } });
      if (res?.outcome === 'created' || res?.outcome === 'updated') { setDraftSaved(true); setSaveStatus(`Draft ${res.outcome} for ${o.name}. Attaching the PDF report…`); setPendingPdf(o.name); }
      else setSaveStatus(res?.outcome === 'duplicate' ? 'Not saved because duplicate records exist for this month.' : 'Not saved because this month was finalised meanwhile.');
    } catch (e) {
      console.error(e); setError('Could not build the report from the boards. Please try again.');
    } finally { setGenerating(false); }
  }

  const finalizeBlockers: string[] = [];
  if (report?.isOfficial) {
    if (report.official?.isFinal) finalizeBlockers.push('Already Final.');
    if (!draftSaved) finalizeBlockers.push('A Draft record must be saved first.');
    if (!report.tie.ok) finalizeBlockers.push('Tie-out failed.');
    const b = report.problems.find((p) => p.blocking);
    if (b) finalizeBlockers.push(`Blocking data problem: ${b.text}`);
  }

  async function finalize() {
    const o = report?.official;
    if (!o?.values || finalizeBlockers.length) return;
    const prev = saveStatus;
    setFinalizing(true); setSaveStatus(`Finalising ${o.name}…`);
    try {
      const res = await finalizeRecord({ data: { name: o.name, values: o.values, today } });
      if (res?.ok) { setSaveStatus(`${o.name} is Final and locked (closed on ${today}).`); setDraftSaved(false); setReport({ ...report!, official: { ...o, isFinal: true } }); }
      else setSaveStatus(`Not finalised: ${res?.reason ?? 'unknown reason'}`);
    } catch (e) { console.error(e); setSaveStatus(prev); setError('Finalising failed. Nothing was changed.'); }
    finally { setFinalizing(false); }
  }

  const blocks = useMemo(() => (report ? buildBlocks(report) : []), [report]);

  // After the draft record is saved, attach a PDF copy of the month's report to it.
  useEffect(() => {
    const name = pendingPdf;
    if (!name || !report || !blocks.length) return;
    const t = setTimeout(async () => {
      setPendingPdf(null);
      try {
        const root = reportRef.current;
        if (!root) throw new Error('Report is not on screen.');
        const blob = await buildPdfBlob(blocks, await captureCharts(root), false);
        const form = new FormData();
        form.append('file', new File([blob], `${fileBase}.pdf`, { type: 'application/pdf' }));
        form.append('name', name);
        const res = await uploadReportPdf({ data: form });
        setSaveStatus((cur) => `${cur.replace(' Attaching the PDF report…', '')} ${res?.ok ? 'PDF report attached to the record.' : `PDF not attached: ${res?.reason ?? 'unknown reason'}.`}`);
      } catch (e) {
        console.error('PDF attach failed', e);
        setSaveStatus((cur) => `${cur.replace(' Attaching the PDF report…', '')} PDF could not be attached; use the PDF button and add it to the record by hand.`);
      }
    }, 800); // let the charts finish drawing before capturing them
    return () => clearTimeout(t);
  }, [pendingPdf, report, blocks]);
  const fileBase = report ? `${report.client}_Service_Desk_Report_${report.isOfficial ? monthLabel(monthKey(report.to)) : `${report.from}_to_${report.to}`}`.replace(/[^\w-]+/g, '_') : '';

  if (search.ticket && /^\d+$/.test(search.ticket)) {
    return <div className="min-h-screen bg-background px-4 py-8 font-[family-name:var(--font-body)] text-foreground sm:px-8"><TicketSync kind={search.board ?? 'request'} id={search.ticket} /></div>;
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8 font-[family-name:var(--font-body)] text-foreground sm:px-8">
      <div className="mx-auto max-w-[1100px]">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-muted-foreground">Jackadder International · Managed Services</p>
            <h1 className="font-[family-name:var(--font-heading)] text-3xl font-semibold tracking-tight">Service Desk Report</h1>
          </div>
          {today && <p className="text-sm tabular-nums text-muted-foreground">Current date (Darwin): {fmtDay(today)}</p>}
        </header>
        <Setup clients={clients} clientsLoading={clientsLoading} client={client} onClient={(c) => { setClient(c); setReport(null); }}
          preset={preset} onPreset={setPreset} contractLabel={contractLabel} customFrom={customFrom} customTo={customTo}
          onCustom={(f, t) => { setCustomFrom(f); setCustomTo(t); }} range={range} rangeError={rangeError} isOfficial={isOfficial}
          canGenerate={!!range && !blocked} generating={generating} onGenerate={generate} />
        {clientsError && <p className="mt-3 text-sm text-destructive">{clientsError}</p>}
        {error && <p className="mt-3 text-sm text-destructive" role="alert">{error}</p>}
      </div>

      {generating && !report && <div className="mx-auto mt-8 h-[600px] max-w-[860px] animate-pulse rounded-md bg-muted" />}
      {report && (
        <div className={`mt-8 transition-opacity ${generating ? 'opacity-50' : ''}`}>
          <div className="mx-auto mb-4 flex max-w-[860px] flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">Client-facing report</p>
            <ExportBar blocks={blocks} reportRef={reportRef} interim={!report.isOfficial} fileBase={fileBase} />
          </div>
          <ClientReport ref={reportRef} report={report} blocks={blocks} />
          <InternalPanel report={report} saveStatus={saveStatus} canFinalize={finalizeBlockers.length === 0} finalizeBlockers={finalizeBlockers}
            finalizing={finalizing} onFinalize={finalize} pagesRead={meta.pages} itemCount={meta.items} />
          <HarvestPanel client={report.client} from={report.from} to={report.to} groups={report.groups} />
        </div>
      )}
      {!report && !generating && <p className="mx-auto mt-12 max-w-[860px] text-center text-sm text-muted-foreground">Please select a client and reporting period, then select Generate. All items for the selected client are retrieved before any figures are calculated.</p>}
    </div>
  );
}
