import ExcelJS from 'exceljs';
import { KpiResult, fmtPct, LateJob } from './engine';

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

export async function buildKpiMatrixWorkbook(
  results: KpiResult[],
  late: LateJob[],
  meta: { months: string; generated: string },
): Promise<{ blob: Blob; filename: string }> {
  const wb = new ExcelJS.Workbook();

  const ws = wb.addWorksheet('KPI Compliance Matrix');
  ws.addRow(['AroFlo KPI Compliance Matrix']);
  ws.addRow([`Months: ${meta.months}`]);
  ws.addRow([`Generated ${meta.generated}`]);
  ws.addRow([]);
  const header = ws.addRow(['KPI', 'Name', 'Target %', '%', 'On time %', 'No.', 'Late', 'Comments']);
  styleHeader(header);

  for (const r of results) {
    const isSla = r.def.metric === 'commenced' || r.def.metric === 'completed';
    const row = ws.addRow([
      r.def.id,
      r.def.name,
      r.def.target,
      fmtPct(r.completionPct),
      isSla ? fmtPct(r.ontimePct) : '',
      r.count,
      r.late,
      r.comment,
    ]);
    if (r.measurable) {
      const cell = row.getCell(isSla ? 5 : 4);
      cell.font = r.met ? GOOD_FONT : BAD_FONT;
    }
  }
  ws.getColumn(1).width = 6;
  ws.getColumn(2).width = 42;
  ws.getColumn(3).width = 9;
  ws.getColumn(4).width = 8;
  ws.getColumn(5).width = 10;
  ws.getColumn(6).width = 7;
  ws.getColumn(7).width = 7;
  ws.getColumn(8).width = 70;
  ws.views = [{ state: 'frozen', ySplit: 5 }];

  const lateWs = wb.addWorksheet('Late Jobs');
  const lateHeader = lateWs.addRow(['Job', 'Task', 'Tier', 'Requested', 'Completed', 'Days late', 'Category']);
  styleHeader(lateHeader);
  for (const j of late) {
    const row = lateWs.addRow([j.jobNumber, j.task, j.tier, fmtDate(j.requested), fmtDate(j.completed), j.daysLate, j.category]);
    if (j.daysLate > 0) row.getCell(6).font = BAD_FONT;
  }
  lateWs.columns.forEach((c, i) => (c.width = [16, 44, 8, 16, 16, 11, 26][i] ?? 16));
  lateWs.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  return { blob, filename: `aroflo_kpi_matrix_${new Date().toISOString().slice(0, 10)}.xlsx` };
}
