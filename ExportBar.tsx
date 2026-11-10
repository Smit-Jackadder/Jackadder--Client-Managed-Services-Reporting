import { useState, type RefObject } from 'react';
import { Loader2, FileText, FileType2, Sheet, Code2 } from 'lucide-react';
import type { Block } from '@generated/lib/reportDoc';
import { captureCharts, exportCsv, exportHtml, exportPdf, exportWord } from '@generated/lib/exports';

type Kind = 'PDF' | 'Word' | 'CSV' | 'HTML';
const ICONS = { PDF: FileText, Word: FileType2, CSV: Sheet, HTML: Code2 };

export function ExportBar({ blocks, reportRef, interim, fileBase }: { blocks: Block[]; reportRef: RefObject<HTMLDivElement | null>; interim: boolean; fileBase: string }) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: Kind) {
    setBusy(kind); setError(null);
    try {
      if (kind === 'CSV') { exportCsv(blocks, fileBase); return; }
      const root = reportRef.current;
      if (!root) throw new Error('Report is not on screen.');
      const imgs = await captureCharts(root);
      if (kind === 'PDF') await exportPdf(blocks, imgs, interim, fileBase);
      if (kind === 'Word') exportWord(blocks, imgs, interim, fileBase);
      if (kind === 'HTML') exportHtml(blocks, imgs, interim, fileBase);
    } catch (e) {
      console.error(e);
      setError(`${kind} export failed. Please try again.`);
    } finally { setBusy(null); }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        {(Object.keys(ICONS) as Kind[]).map((k) => {
          const Icon = ICONS[k];
          return (
            <button key={k} onClick={() => run(k)} disabled={busy !== null}
              className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium transition-colors hover:bg-secondary disabled:opacity-50">
              {busy === k ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />} {k}
            </button>
          );
        })}
      </div>
      {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
    </div>
  );
}
