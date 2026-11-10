import type { Block } from '@generated/lib/reportDoc';

export type ChartImages = Partial<Record<'usage' | 'rolling' | 'carry' | 'carryforward' | 'logo', string>>;

/** Company logo shown at the top right of every export. */
export const LOGO_URL = 'https://files-public.monday.com/apse2/11f739a9-c65f-438a-b28a-8dbe377c851a/Small%20logo.webp';

/** Logo as a PNG data URL (PDF needs PNG/JPEG; embedding keeps HTML/Word files self-contained). Null if it cannot be loaded. */
export async function loadLogo(): Promise<string | null> {
  try {
    const res = await fetch(LOGO_URL, { mode: 'cors' });
    if (!res.ok) throw new Error(`Logo HTTP ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d')?.drawImage(bmp, 0, 0);
    return c.toDataURL('image/png');
  } catch (e) { console.error('Logo could not be loaded for export', e); return null; }
}

export async function captureCharts(root: HTMLElement): Promise<ChartImages> {
  const { toPng } = await import('html-to-image');
  const out: ChartImages = {};
  const nodes = root.querySelectorAll<HTMLElement>('[data-chart]');
  for (const node of Array.from(nodes)) {
    const id = node.dataset.chart as keyof ChartImages;
    out[id] = await toPng(node, { pixelRatio: 2, backgroundColor: '#ffffff' });
  }
  const logo = await loadLogo();
  if (logo) out.logo = logo;
  return out;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function toHtmlBody(blocks: Block[], imgs: ChartImages, interim: boolean): string {
  const parts: string[] = [];
  parts.push(`<div class="logo"><img src="${imgs.logo ?? LOGO_URL}" alt="Jackadder International" width="72" height="72" /></div>`);
  if (interim) parts.push('<p class="badge">Interim report, not a monthly record</p>');
  for (const b of blocks) {
    if (b.type === 'client') parts.push(`<h1 class="client">${esc(b.text)}</h1>`);
    else if (b.type === 'title') parts.push(`<p class="title">${esc(b.text)}</p>`);
    else if (b.type === 'h2') parts.push(`<h2>${esc(b.text)}</h2>`);
    else if (b.type === 'p') parts.push(`<p class="${b.muted ? 'muted' : ''}">${esc(b.text)}</p>`);
    else if (b.type === 'chart') { const src = imgs[b.id]; parts.push(src ? `<p class="cap">${esc(b.caption)}</p><img src="${src}" alt="${esc(b.caption)}" width="640" />` : `<p>— (chart unavailable)</p>`); }
    else if (b.type === 'table') parts.push(`<table><thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
  }
  return parts.join('\n');
}

const CSS = `.logo{text-align:right;margin:0 0 4px}.logo img{width:72px;height:72px}
@media print{.logo{position:fixed;top:0;right:0;margin:0}.logo img{width:56px;height:56px}body{margin-top:72px}}
body{font-family:Arial,Helvetica,sans-serif;color:#1C2533;max-width:820px;margin:32px auto;padding:0 16px;font-size:13px;line-height:1.5}
.client{text-align:center;font-size:30px;font-weight:bold;text-transform:uppercase;letter-spacing:2px;margin:0}
.title{text-align:center;font-size:17px;margin-top:4px}.badge{text-align:center;color:#555;background:#eee;padding:4px 10px;border-radius:12px;display:inline-block}
h2{font-size:18px;border-bottom:1px solid #ccd;padding-bottom:4px;margin-top:28px}.muted{color:#667;font-size:11px}.cap{font-size:11px;text-transform:uppercase;color:#667;letter-spacing:1px}
img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%;margin-top:8px}th{text-align:left;border-bottom:2px solid #1C2533;padding:5px;font-size:11px;text-transform:uppercase}td{border-bottom:1px solid #dde;padding:5px;vertical-align:top}`;

export function exportHtml(blocks: Block[], imgs: ChartImages, interim: boolean, file: string) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(file)}</title><style>${CSS}</style></head><body>${toHtmlBody(blocks, imgs, interim)}</body></html>`;
  download(new Blob([html], { type: 'text/html;charset=utf-8' }), `${file}.html`);
}

export function exportWord(blocks: Block[], imgs: ChartImages, interim: boolean, file: string) {
  // Word page header (mso-header) repeats the logo at the top right of every page.
  const body = toHtmlBody(blocks, imgs, interim).replace(/^<div class="logo">.*?<\/div>\n?/, '');
  const wordCss = `${CSS}\n@page Section1{size:21cm 29.7cm;margin:2.5cm 2cm 2cm 2cm;mso-header-margin:1cm;mso-header:h1}div.Section1{page:Section1}`;
  const header = `<div style="mso-element:header" id="h1"><p class="MsoHeader" align="right" style="text-align:right"><img src="${LOGO_URL}" alt="Jackadder International" width="48" height="48" /></p></div>`;
  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><title>${esc(file)}</title><style>${wordCss}</style></head><body><div class="Section1">${header}${body}</div></body></html>`;
  download(new Blob(['\ufeff', html], { type: 'application/msword' }), `${file}.doc`);
}

export function exportCsv(blocks: Block[], file: string) {
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines: string[] = [];
  // CSV cannot hold images: the logo reference sits in the top-right cell of the first row.
  lines.push(['', '', '', '', q(`Jackadder International logo: ${LOGO_URL}`)].join(','));
  for (const b of blocks) {
    if (b.type === 'table') { lines.push(q(b.name)); lines.push(b.head.map(q).join(',')); for (const r of b.rows) lines.push(r.map(q).join(',')); lines.push(''); }
    else if (b.type === 'chart') lines.push(q(`[Chart] ${b.caption}`));
    else lines.push(q(b.text));
  }
  download(new Blob(['\ufeff', lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${file}.csv`);
}

export async function exportPdf(blocks: Block[], imgs: ChartImages, interim: boolean, file: string) {
  download(await buildPdfBlob(blocks, imgs, interim), `${file}.pdf`);
}

/** The report as a PDF file (same layout as the PDF export). */
export async function buildPdfBlob(blocks: Block[], imgs: ChartImages, interim: boolean): Promise<Blob> {
  const pdfMakeMod = await import('pdfmake/build/pdfmake');
  const fontsMod = await import('pdfmake/build/vfs_fonts');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfMake: any = (pdfMakeMod as any).default ?? pdfMakeMod;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const f: any = (fontsMod as any).default ?? fontsMod;
  pdfMake.vfs = f?.pdfMake?.vfs ?? f?.vfs ?? f;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const content: any[] = [];
  if (interim) content.push({ text: 'Interim report, not a monthly record', alignment: 'center', color: '#666', fontSize: 9, margin: [0, 0, 0, 8] });
  for (const b of blocks) {
    if (b.type === 'client') content.push({ text: b.text, alignment: 'center', bold: true, fontSize: 24, characterSpacing: 1.5 });
    else if (b.type === 'title') content.push({ text: b.text, alignment: 'center', fontSize: 14, margin: [0, 2, 0, 10] });
    else if (b.type === 'h2') content.push({ text: b.text, fontSize: 14, bold: true, margin: [0, 16, 0, 4] });
    else if (b.type === 'p') content.push({ text: b.text, fontSize: b.muted ? 8 : 10, color: b.muted ? '#667' : '#1C2533', margin: [0, 3, 0, 3] });
    else if (b.type === 'chart') { const src = imgs[b.id]; content.push(src ? { image: src, width: 480, alignment: 'center', margin: [0, 6, 0, 6] } : { text: '— (chart unavailable)' }); }
    else if (b.type === 'table') content.push({
      table: { headerRows: 1, widths: b.head.map((_, i) => (i === 1 && b.head[1] === 'Name' ? '*' : 'auto')), body: [b.head.map((h) => ({ text: h, bold: true, fontSize: 8 })), ...b.rows.map((r) => r.map((c) => ({ text: c, fontSize: 8 })))] },
      layout: 'lightHorizontalLines', margin: [0, 4, 0, 6],
    });
  }
  const doc = {
    pageSize: 'A4', pageMargins: [40, 72, 40, 48], content,
    // Logo repeats at the top right of every page.
    header: () => (imgs.logo ? { image: imgs.logo, width: 44, alignment: 'right', margin: [0, 16, 40, 0] } : { text: '' }), defaultStyle: { font: 'Roboto' },
    footer: (page: number, count: number) => ({ text: `Page ${page} of ${count}`, alignment: 'center', fontSize: 8, color: '#667', margin: [0, 16, 0, 0] }),
  };
  return await new Promise<Blob>((resolve, reject) => {
    try { pdfMake.createPdf(doc).getBlob((blob: Blob) => resolve(blob)); } catch (e) { reject(e); }
  });
}
