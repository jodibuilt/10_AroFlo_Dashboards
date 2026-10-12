import ExcelJS from 'exceljs';
import { ReportingKpisResponse, BreakdownRow } from '../types';

const KPI_LABELS: Record<string, string> = {
  issued: 'Issued',
  completed: 'Completed',
  outstanding: 'Outstanding',
  overdue: 'Overdue',
  completionRate: 'Completion Rate',
  overdueRate: 'Overdue Rate',
};

const GOOD_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE4F7E4' } };
const LATE_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE4E4' } };
const GOOD_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FF0CA30C' }, bold: true };
const LATE_FONT: Partial<ExcelJS.Font> = { color: { argb: 'FFD03B3B' }, bold: true };

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4F0' } };
  });
}

function autoWidth(ws: ExcelJS.Worksheet, headers: string[], rows: Record<string, unknown>[], keys: string[]) {
  headers.forEach((h, i) => {
    const longest = Math.max(h.length, ...rows.map((r) => String(r[keys[i]] ?? '').length));
    ws.getColumn(i + 1).width = Math.max(14, Math.min(28, longest + 2));
  });
}

function addBreakdownSheet(wb: ExcelJS.Workbook, name: string, rows: BreakdownRow[]) {
  const ws = wb.addWorksheet(name);
  const headers = ['Task ID', 'Client', 'Requested Date', 'Actual Start Date', 'Required Completed Date', 'Completed Date', 'Delay Reason', 'Substatus', 'Days Late'];
  const keys: (keyof BreakdownRow)[] = ['taskId', 'client', 'requestDate', 'actualStartDate', 'requiredCompletedDate', 'completedDate', 'delayReason', 'currentSubstatus', 'daysLate'];
  ws.addRow(headers);
  styleHeader(ws.getRow(1));
  for (const r of rows) {
    const row = ws.addRow(keys.map((k) => r[k] ?? ''));
    const daysLateCell = row.getCell(keys.length);
    if ((r.daysLate || 0) > 0) {
      daysLateCell.fill = LATE_FILL;
      daysLateCell.font = LATE_FONT;
    } else {
      daysLateCell.font = GOOD_FONT;
    }
  }
  autoWidth(ws, headers, rows as unknown as Record<string, unknown>[], keys as string[]);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

export async function buildExcelReport({
  data,
  dateFrom,
  dateTo,
  view,
}: {
  data: ReportingKpisResponse;
  dateFrom: string;
  dateTo: string;
  view: string;
}): Promise<{ blob: Blob; filename: string }> {
  const wb = new ExcelJS.Workbook();

  const summarySheet = wb.addWorksheet('Summary');
  summarySheet.addRow(['AroFlo Reporting Dashboard']);
  summarySheet.addRow([`${dateFrom} - ${dateTo} - ${view}`]);
  summarySheet.addRow([`Generated ${new Date().toISOString().slice(0, 10)}`]);
  summarySheet.addRow([]);
  const summaryHeader = summarySheet.addRow(['Metric', 'Value']);
  styleHeader(summaryHeader);
  for (const [key, label] of Object.entries(KPI_LABELS)) {
    const raw = (data.summary as unknown as Record<string, number>)[key];
    const value = key.includes('Rate') ? `${raw.toFixed(1)}%` : raw;
    summarySheet.addRow([label, value]);
  }
  summarySheet.getColumn(1).width = 22;
  summarySheet.getColumn(2).width = 18;

  const complianceSheet = wb.addWorksheet('KPI Compliance');
  const complianceHeaders = ['Priority', 'Actual %', 'Target %', 'Variance (pp)', 'Status'];
  complianceSheet.addRow(complianceHeaders);
  styleHeader(complianceSheet.getRow(1));
  for (const r of data.priorityCompliance) {
    const row = complianceSheet.addRow([r.priority, Number(r.actualPercent.toFixed(1)), Number(r.targetPercent.toFixed(0)), Number(r.variancePp.toFixed(1)), r.status]);
    const statusCell = row.getCell(5);
    if (r.status === 'Met') {
      statusCell.font = GOOD_FONT;
    } else {
      statusCell.fill = LATE_FILL;
      statusCell.font = LATE_FONT;
    }
  }
  complianceSheet.columns.forEach((c) => (c.width = 16));
  complianceSheet.views = [{ state: 'frozen', ySplit: 1 }];

  addBreakdownSheet(wb, 'Breakdown Work Orders', data.breakdown);
  addBreakdownSheet(wb, 'Preventative Maintenance', data.pmBreakdown);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const viewSlug = view.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { blob, filename: `aroflo_report_${viewSlug}_${new Date().toISOString().slice(0, 10)}.xlsx` };
}
