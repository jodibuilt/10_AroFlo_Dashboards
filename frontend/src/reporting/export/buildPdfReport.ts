import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { today } from '../time';
// No type declarations shipped for plotly.js-dist-min; used only for its
// toImage() static method, called dynamically below.
import Plotly from 'plotly.js-dist-min';
import { ReportingKpisResponse, BreakdownRow, OverdueAgeingResponse } from '../types';
import { LIGHT, Palette } from '../theme';

const KPI_LABELS: [string, string][] = [
  ['issued', 'Issued'],
  ['completed', 'Completed'],
  ['outstanding', 'Outstanding'],
  ['overdue', 'Overdue'],
  ['completionRate', 'Completion Rate'],
  ['overdueRateOfIssued', 'Overdue Rate (of issued)'],
  ['overdueRate', 'Overdue Rate (of completed)'],
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
  overdue,
  notes = [],
  extraColumns = [],
}: {
  // The page's figures — with on-screen edits already put in, where a table
  // has been edited (AnalyticsTab.withEdits).
  data: ReportingKpisResponse;
  dateFrom: string;
  dateTo: string;
  view: string;
  palette: Palette;
  // Columns added on screen to the breakdown tables.
  extraColumns?: string[];
  // The Overdue & Ageing section, when it could be loaded.
  overdue?: OverdueAgeingResponse | null;
  notes?: string[];
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
  doc.text(`Generated ${today()}`, margin, y);
  y += 20;
  doc.setTextColor(...hexToRgb(PALETTE.inkPrimary));

  doc.setFontSize(13);
  doc.text('General Statistics', margin, y);
  y += 8;
  const summary = data.summary as unknown as Record<string, number | undefined>;
  const stats = KPI_LABELS.filter(([key]) => summary[key] !== undefined);
  autoTable(doc, {
    startY: y,
    head: [stats.map(([, label]) => label)],
    body: [
      stats.map(([key]) => {
        const raw = summary[key] as number;
        return key.includes('Rate') ? `${raw.toFixed(1)}%` : String(raw);
      }),
    ],
    margin: { left: margin, right: margin },
    styles: { fontSize: 8 },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  y = (doc as any).lastAutoTable.finalY + 20;
  if (data.summary.openInSystem !== undefined) {
    doc.setFontSize(9);
    doc.text(`Open in system, whatever the request date: ${data.summary.openInSystem}`, margin, y - 6);
    y += 10;
  }

  doc.setFontSize(13);
  doc.text('Target KPI Compliance', margin, y);
  y += 8;
  autoTable(doc, {
    startY: y,
    // On time, late and still in progress add up to the level's work
    // orders; Actual % is on time / (on time + late), blank until something
    // in the level is finished or overdue.
    head: [['Priority', 'On time', 'Late', 'In progress', 'Actual %', 'Target %', 'Variance (pp)', 'Status']],
    body: data.priorityCompliance.map((r) => [
      r.priority,
      String(r.onTime ?? ''),
      String(r.late ?? ''),
      String(r.inProgress ?? ''),
      r.actualPercent === null ? '-' : r.actualPercent.toFixed(1),
      r.targetPercent.toFixed(0),
      r.variancePp === null ? '-' : `${r.variancePp >= 0 ? '+' : ''}${r.variancePp.toFixed(1)}`,
      r.status,
    ]),
    margin: { left: margin, right: margin },
    styles: { fontSize: 8 },
    didParseCell: (hookData) => {
      if (hookData.section === 'body' && hookData.column.index === 7 && hookData.cell.raw !== 'In progress') {
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
      // 'FAST': store the chart compressed. Left at the default each one
      // goes in as a raw bitmap — about 3 MB a chart, a 28 MB report.
      doc.addImage(uri, 'PNG', margin, y, imgWidth, imgHeight, undefined, 'FAST');
      y += imgHeight + 14;
    }
  }

  function addBreakdownPage(title: string, rows: BreakdownRow[]) {
    doc.addPage();
    let ty = margin;
    doc.setFontSize(13);
    doc.text(title, margin, ty);
    ty += 8;
    // Priority is the job's own, as AroFlo names it; the columns a person
    // has added on screen go on the end.
    const cell = (r: BreakdownRow, key: string) => String((r as unknown as Record<string, string | number | null>)[key] ?? '');
    autoTable(doc, {
      startY: ty,
      head: [['Task ID', 'Client', 'Priority', 'Requested', 'Actual Start', 'Required', 'Completed', 'Delay Reason', 'Substatus', 'Days Late', ...extraColumns]],
      body: rows.map((r) => [
        String(r.taskId ?? ''),
        r.client ?? '',
        r.priorityName || r.priority || '',
        r.requestDate || '',
        r.actualStartDate || '',
        r.requiredCompletedDate || '',
        r.completedDate || '',
        r.delayReason ?? '',
        r.currentSubstatus ?? '',
        String(r.daysLate ?? ''),
        ...extraColumns.map((column) => cell(r, column)),
      ]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 7 },
      columnStyles: { 0: { cellWidth: 40 }, 2: { cellWidth: 34 }, 9: { cellWidth: 32 } },
      didParseCell: (hookData) => {
        if (hookData.section === 'body' && hookData.column.index === 9) {
          const late = Number(hookData.cell.raw) > 0;
          hookData.cell.styles.textColor = late ? hexToRgb(PALETTE.statusCritical) : hexToRgb(PALETTE.statusGood);
          if (late) hookData.cell.styles.fontStyle = 'bold';
        }
      },
    });
  }

  addBreakdownPage('Breakdown Work Orders (P1 - P4)', data.breakdown);
  addBreakdownPage('Preventative Maintenance (PM)', data.pmBreakdown);

  // The Overdue & Ageing section of the page: the age bands, the split by
  // priority, then the jobs themselves.
  if (overdue) {
    const d = overdue.data;
    doc.addPage();
    let oy = margin;
    doc.setFontSize(13);
    doc.text('Overdue & Ageing Work', margin, oy);
    oy += 14;
    doc.setFontSize(9);
    doc.setTextColor(...hexToRgb(PALETTE.inkSecondary));
    doc.text(`Open work orders past their due date, as at ${overdue.meta.today} - whatever the date range of the report.`, margin, oy);
    doc.setTextColor(...hexToRgb(PALETTE.inkPrimary));
    oy += 8;
    autoTable(doc, {
      startY: oy,
      head: [['Overdue work orders', 'Oldest (days)', ...d.buckets.map((b) => b.label)]],
      body: [[String(d.total), d.oldestDays === null ? '' : String(d.oldestDays), ...d.buckets.map((b) => String(b.count))]],
      margin: { left: margin, right: margin },
      styles: { fontSize: 8 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    oy = (doc as any).lastAutoTable.finalY + 14;
    autoTable(doc, {
      startY: oy,
      head: [['Priority', 'Total', ...d.buckets.map((b) => b.label)]],
      body: d.byPriority.map((p) => [p.priority, String(p.total), ...d.buckets.map((b) => String(p[b.key] ?? 0))]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 8 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    oy = (doc as any).lastAutoTable.finalY + 14;
    autoTable(doc, {
      startY: oy,
      head: [['Job', 'Task', 'Priority', 'Client', 'Site', 'Due', 'Days overdue', 'Status']],
      body: d.rows.map((r) => [
        String(r.jobNumber ?? ''),
        r.taskName ?? '',
        String(r.priorityName ?? r.priority ?? ''),
        r.client ?? '',
        r.site ?? '',
        r.dueDate ?? '',
        String(r.daysOverdue ?? ''),
        r.status ?? '',
      ]),
      margin: { left: margin, right: margin },
      styles: { fontSize: 7 },
      columnStyles: { 0: { cellWidth: 40 }, 6: { cellWidth: 44, textColor: hexToRgb(PALETTE.statusCritical), fontStyle: 'bold' } },
    });
  }

  // What the figures cover and how they are worked out — so the file says
  // so wherever it ends up.
  if (notes.length) {
    doc.addPage();
    let ny = margin;
    doc.setFontSize(13);
    doc.text('Notes', margin, ny);
    ny += 16;
    doc.setFontSize(9);
    const width = doc.internal.pageSize.getWidth() - margin * 2;
    for (const note of notes) {
      const lines = doc.splitTextToSize(`- ${note}`, width) as string[];
      doc.text(lines, margin, ny);
      ny += lines.length * 12 + 4;
    }
  }

  const blob = doc.output('blob');
  const viewSlug = view.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { blob, filename: `aroflo_report_${viewSlug}_${today()}.pdf` };
}
