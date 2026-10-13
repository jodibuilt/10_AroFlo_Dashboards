import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { KpiResult, LateJob, matrixCells } from './engine';
import { today } from '../time';

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4F0' } };
const GOOD_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FF0CA30C' }, bold: true };
const BAD_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFD03B3B' }, bold: true };

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((c) => (c.fill = HEADER_FILL));
}

function fmtDate(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// What the report is of, printed under its title: which month, whose work
// orders, and where the rows came from.
export interface MatrixReportMeta {
  months: string;
  generated: string;
  // "Ventia + SAHA", "All clients", or the name of an uploaded file.
  scope?: string;
  // What the figures cover and how they are worked out — so the file says
  // so wherever it ends up.
  notes?: string[];
}

const MATRIX_HEAD = ['KPI', 'Name', 'Target %', '%', 'On time %', 'No.', 'Late', 'In progress', 'Comments'];
const LATE_HEAD = ['Job', 'Task', 'Tier', 'Requested', 'Completed', 'Days late', 'Late for', 'Category'];
// 1-based, as Excel counts them.
const SCORE_COLUMN = { sla: 5, other: 4 };
const DAYS_LATE_COLUMN = 6;

const isSlaRow = (r: KpiResult) => r.def.metric === 'commenced' || r.def.metric === 'completed';

// The row as it is on screen. A figure is a number where it is one, so it
// can be added up in Excel; a row only an uploaded export can fill is blank.
function matrixRow(r: KpiResult): (string | number)[] {
  const cells = matrixCells(r);
  const number = (text: string) => (text === '' ? '' : Number(text));
  return [r.def.id, r.def.name, r.def.target, cells.pct, cells.ontimePct, number(cells.count), number(cells.late), number(cells.inProgress), r.comment];
}

// Late with no completion date: open past its deadline.
function lateRow(j: LateJob): (string | number)[] {
  return [
    j.jobNumber,
    j.task,
    j.tier,
    fmtDate(j.requested),
    j.completed ? fmtDate(j.completed) : 'still open',
    j.daysLate,
    j.lateFor === 'finishing' ? 'Finishing' : 'Starting',
    j.category,
  ];
}

// The same report as a PDF: the matrix, then the late jobs behind it.
export async function buildKpiMatrixPdf(results: KpiResult[], late: LateJob[], meta: MatrixReportMeta): Promise<{ blob: Blob; filename: string }> {
  const doc = new jsPDF({ format: 'a4', unit: 'pt', orientation: 'landscape' });
  const margin = 1.5 * 28.35; // 1.5cm in pt
  let y = margin;
  doc.setFontSize(16);
  doc.text('AroFlo KPI Compliance Matrix', margin, y);
  y += 18;
  doc.setFontSize(10);
  doc.setTextColor(90, 90, 90);
  doc.text(`Months: ${meta.months}${meta.scope ? `  -  ${meta.scope}` : ''}`, margin, y);
  y += 14;
  doc.text(`Generated ${meta.generated}`, margin, y);
  y += 12;
  doc.setTextColor(20, 20, 20);

  autoTable(doc, {
    startY: y,
    head: [MATRIX_HEAD],
    body: results.map((r) => matrixRow(r).map(String)),
    margin: { left: margin, right: margin },
    styles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 170 },
      2: { cellWidth: 46 },
      3: { cellWidth: 40 },
      4: { cellWidth: 52 },
      5: { cellWidth: 36 },
      6: { cellWidth: 36 },
      7: { cellWidth: 56 },
    },
    didParseCell: (hook) => {
      if (hook.section !== 'body') return;
      const r = results[hook.row.index];
      // The score — on time % for the SLA rows, % for the rest — in green or red.
      if (r.measurable && hook.column.index === (isSlaRow(r) ? SCORE_COLUMN.sla : SCORE_COLUMN.other) - 1) {
        hook.cell.styles.textColor = r.met ? [12, 163, 12] : [208, 59, 59];
        hook.cell.styles.fontStyle = 'bold';
      }
    },
  });

  doc.addPage();
  doc.setFontSize(13);
  doc.text(`Late jobs (${late.length})`, margin, margin);
  autoTable(doc, {
    startY: margin + 8,
    head: [LATE_HEAD],
    body: late.map((j) => lateRow(j).map(String)),
    margin: { left: margin, right: margin },
    styles: { fontSize: 7 },
    columnStyles: { 0: { cellWidth: 50 }, 2: { cellWidth: 34 }, [DAYS_LATE_COLUMN - 1]: { cellWidth: 46, textColor: [208, 59, 59], fontStyle: 'bold' } },
  });

  if (meta.notes?.length) {
    doc.addPage();
    let ny = margin;
    doc.setFontSize(13);
    doc.text('Notes', margin, ny);
    ny += 16;
    doc.setFontSize(9);
    const width = doc.internal.pageSize.getWidth() - margin * 2;
    const bottom = doc.internal.pageSize.getHeight() - margin;
    for (const note of meta.notes) {
      const lines = doc.splitTextToSize(`- ${note}`, width) as string[];
      if (ny + lines.length * 12 > bottom) {
        doc.addPage();
        ny = margin;
      }
      doc.text(lines, margin, ny);
      ny += lines.length * 12 + 4;
    }
  }

  return { blob: doc.output('blob'), filename: `aroflo_kpi_matrix_${today()}.pdf` };
}

export async function buildKpiMatrixWorkbook(
  results: KpiResult[],
  late: LateJob[],
  meta: MatrixReportMeta,
): Promise<{ blob: Blob; filename: string }> {
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet('KPI Compliance Matrix');
  ws.addRow(['AroFlo KPI Compliance Matrix']);
  ws.addRow([`Months: ${meta.months}${meta.scope ? ` - ${meta.scope}` : ''}`]);
  ws.addRow([`Generated ${meta.generated}`]);
  ws.addRow([]);
  const header = ws.addRow(MATRIX_HEAD);
  styleHeader(header);

  for (const r of results) {
    const row = ws.addRow(matrixRow(r));
    if (r.measurable) {
      const cell = row.getCell(isSlaRow(r) ? SCORE_COLUMN.sla : SCORE_COLUMN.other);
      cell.font = r.met ? GOOD_FONT : BAD_FONT;
    }
  }
  [6, 42, 9, 8, 10, 7, 7, 12, 70].forEach((width, i) => (ws.getColumn(i + 1).width = width));
  ws.views = [{ state: 'frozen', ySplit: 5 }];

  const lateWs = wb.addWorksheet('Late Jobs');
  const lateHeader = lateWs.addRow(LATE_HEAD);
  styleHeader(lateHeader);
  for (const j of late) {
    const row = lateWs.addRow(lateRow(j));
    if (j.daysLate > 0) row.getCell(DAYS_LATE_COLUMN).font = BAD_FONT;
  }
  lateWs.columns.forEach((c, i) => (c.width = [16, 44, 8, 16, 16, 11, 12, 26][i] ?? 16));
  lateWs.views = [{ state: 'frozen', ySplit: 1 }];

  if (meta.notes?.length) {
    const notesWs = wb.addWorksheet('Notes');
    styleHeader(notesWs.addRow(['Notes']));
    for (const note of meta.notes) notesWs.addRow([note]);
    notesWs.getColumn(1).width = 140;
  }

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return { blob, filename: `aroflo_kpi_matrix_${today()}.xlsx` };
}
