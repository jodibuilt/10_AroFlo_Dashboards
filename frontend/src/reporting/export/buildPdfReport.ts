import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
// No type declarations shipped for plotly.js-dist-min; used only for its
// toImage() static method, called dynamically below.
import Plotly from 'plotly.js-dist-min';
import { ReportingKpisResponse, BreakdownRow } from '../types';
import { LIGHT, Palette } from '../theme';

const KPI_LABELS: [string, string][] = [
  ['issued', 'Issued'],
  ['completed', 'Completed'],
  ['outstanding', 'Outstanding'],
  ['overdue', 'Overdue'],
  ['completionRate', 'Completion Rate'],
  ['overdueRate', 'Overdue Rate'],
];

// Exports always render in the LIGHT palette regardless of on-screen theme —
// same deliberate choice aroflo_dash's report_export.py makes (dark
// backgrounds waste ink / aren't standard for print).
const PALETTE: Palette = LIGHT;

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}

// Best-effort: captures whatever Plotly chart divs are currently mounted on
// the Reports page via Plotly's own toImage() — mirrors aroflo_dash's
// kaleido-based PNG embedding (real chart images, not a tabular substitute),
// but silently skips a chart on failure rather than failing the whole PDF,
// same fallback report_export.py's _fig_to_image uses.
async function captureChartImages(): Promise<string[]> {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>('.js-plotly-plot'));
  const images: string[] = [];
  for (const node of nodes) {
    try {
      const uri = await Plotly.toImage(node, { format: 'png', width: 760, height: 340, scale: 2 });
      images.push(uri);
    } catch {
      // Skipped — same as report_export.py's silent skip-on-failure.
    }
  }
  return images;
}

export async function buildPdfReport({
  data,
  dateFrom,
  dateTo,
  view,
}: {
  data: ReportingKpisResponse;
  dateFrom: string;
  dateTo: string;
  view: string;
  palette: Palette;
}): Promise<{ blob: Blob; filename: string }> {
  const doc = new jsPDF({ format: 'a4', unit: 'pt' });
  const margin = 1.5 * 28.35; // 1.5cm in pt
  let y = margin;

  doc.setFontSize(16);
  doc.text('AroFlo Reporting Dashboard', margin, y);
  y += 18;
  doc.setFontSize(10);
  doc.setTextColor(...hexToRgb(PALETTE.inkSecondary));
  doc.text(`${dateFrom} - ${dateTo} · ${view}`, margin, y);
  y += 14;
  doc.text(`Generated ${new Date().toISOString().slice(0, 10)}`, margin, y);
  y += 20;
  doc.setTextColor(...hexToRgb(PALETTE.inkPrimary));

  doc.setFontSize(13);
  doc.text('General Statistics', margin, y);
  y += 8;
  autoTable(doc, {
    startY: y,
    head: [KPI_LABELS.map(([, label]) => label)],
    body: [
      KPI_LABELS.map(([key]) => {
        const raw = (data.summary as unknown as Record<string, number>)[key];
        return key.includes('Rate') ? `${raw.toFixed(1)}%` : String(raw);
      }),
    ],
    margin: { left: margin, right: margin },
    styles: { fontSize: 8 },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 20;

  doc.setFontSize(13);
  doc.text('Target KPI Compliance', margin, y);
  y += 8;
  autoTable(doc, {
    startY: y,
    head: [['Priority', 'Actual %', 'Target %', 'Variance (pp)', 'Status']],
    body: data.priorityCompliance.map((r) => [
      r.priority,
      r.actualPercent.toFixed(1),
      r.targetPercent.toFixed(0),
      `${r.variancePp >= 0 ? '+' : ''}${r.variancePp.toFixed(1)}`,
      r.status,
    ]),
    margin: { left: margin, right: margin },
    styles: { fontSize: 8 },
    didParseCell: (hookData) => {
      if (hookData.section === 'body' && hookData.column.dataKey === 4) {
        const met = hookData.cell.raw === 'Met';
        hookData.cell.styles.textColor = met ? hexToRgb(PALETTE.statusGood) : hexToRgb(PALETTE.statusCritical);
        hookData.cell.styles.fontStyle = 'bold';
      }
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 20;

  const chartImages = await captureChartImages();
  if (chartImages.length > 0) {
    doc.setFontSize(13);
    doc.text('Trends & Breakdown', margin, y);
    y += 8;
    const pageWidth = doc.internal.pageSize.getWidth();
    const imgWidth = pageWidth - margin * 2;
    const imgHeight = imgWidth * (170 / 380);
    for (const uri of chartImages) {
      if (y + imgHeight > doc.internal.pageSize.getHeight() - margin) {
        doc.addPage();
        y = margin;
      }
      doc.addImage(uri, 'PNG', margin, y, imgWidth, imgHeight);
      y += imgHeight + 14;
    }
  }

  function addBreakdownPage(title: string, rows: BreakdownRow[]) {
    doc.addPage();
    let ty = margin;
    doc.setFontSize(13);
    doc.text(title, margin, ty);
    ty += 8;
    autoTable(doc, {
      startY: ty,
      head: [['Task ID', 'Client', 'Requested', 'Actual Start', 'Required', 'Completed', 'Delay Reason', 'Substatus', 'Days Late']],
      body: rows.map((r) => [r.taskId, r.client, r.requestDate || '', r.actualStartDate || '', r.requiredCompletedDate || '', r.completedDate || '', r.delayReason, r.currentSubstatus, String(r.daysLate ?? '')]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 7, cellWidth: 'wrap' },
      columnStyles: { 0: { cellWidth: 54 }, 6: { cellWidth: 84 } },
      didParseCell: (hookData) => {
        if (hookData.section === 'body' && hookData.column.dataKey === 8) {
          const late = Number(hookData.cell.raw) > 0;
          hookData.cell.styles.textColor = late ? hexToRgb(PALETTE.statusCritical) : hexToRgb(PALETTE.statusGood);
          if (late) hookData.cell.styles.fontStyle = 'bold';
        }
      },
    });
  }

  addBreakdownPage('Breakdown Work Orders (P1 - P4)', data.breakdown);
  addBreakdownPage('Preventative Maintenance (P5 / PM)', data.pmBreakdown);

  const blob = doc.output('blob');
  const viewSlug = view.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { blob, filename: `aroflo_report_${viewSlug}_${new Date().toISOString().slice(0, 10)}.pdf` };
}
