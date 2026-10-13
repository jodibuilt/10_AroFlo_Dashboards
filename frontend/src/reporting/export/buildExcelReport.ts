import ExcelJS from 'exceljs';
import { ReportingKpisResponse, BreakdownRow, OverdueAgeingResponse } from '../types';
import { today } from '../time';

const KPI_LABELS: Record<string, string> = {
  issued: 'Issued',
  completed: 'Completed',
  outstanding: 'Outstanding',
  overdue: 'Overdue',
  completionRate: 'Completion Rate',
  overdueRateOfIssued: 'Overdue Rate (of issued)',
  overdueRate: 'Overdue Rate (of completed)',
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

// `extraColumns` are the columns a person has added on screen with the
// pencil; they go on the end, under the names they were given.
function addBreakdownSheet(wb: ExcelJS.Workbook, name: string, rows: BreakdownRow[], extraColumns: string[]) {
  const ws = wb.addWorksheet(name);
  // Priority is the job's own, as AroFlo names it: one sheet holds every
  // level, and a level can hold more than one priority (P4, AP4, AP5).
  const headers = ['Task ID', 'Client', 'Priority', 'Requested Date', 'Actual Start Date', 'Required Completed Date', 'Completed Date', 'Delay Reason', 'Substatus', 'Days Late', ...extraColumns];
  const keys: string[] = ['taskId', 'client', 'priorityName', 'requestDate', 'actualStartDate', 'requiredCompletedDate', 'completedDate', 'delayReason', 'currentSubstatus', 'daysLate', ...extraColumns];
  const daysLateColumn = keys.indexOf('daysLate') + 1;
  ws.addRow(headers);
  styleHeader(ws.getRow(1));
  for (const r of rows) {
    const cells = r as unknown as Record<string, string | number | null>;
    const row = ws.addRow(keys.map((k) => cells[k] ?? (k === 'priorityName' ? r.priority : '')));
    const daysLateCell = row.getCell(daysLateColumn);
    if ((Number(r.daysLate) || 0) > 0) {
      daysLateCell.fill = LATE_FILL;
      daysLateCell.font = LATE_FONT;
    } else {
      daysLateCell.font = GOOD_FONT;
    }
  }
  autoWidth(ws, headers, rows as unknown as Record<string, unknown>[], keys);
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

// The Overdue & Ageing section of the page: the age bands and the split by
// priority on one sheet, the jobs themselves on another (so they can be
// filtered and sorted in Excel).
function addOverdueSheets(wb: ExcelJS.Workbook, overdue: OverdueAgeingResponse) {
  const d = overdue.data;
  const summary = wb.addWorksheet('Overdue & Ageing');
  summary.addRow(['Overdue & Ageing Work']);
  summary.addRow([`Open work orders past their due date, as at ${overdue.meta.today} — whatever the date range of the report`]);
  summary.addRow([]);
  styleHeader(summary.addRow(['Overdue work orders', 'Oldest (days)']));
  summary.addRow([d.total, d.oldestDays ?? '']);
  summary.addRow([]);
  styleHeader(summary.addRow(['Age', 'Work orders']));
  for (const b of d.buckets) summary.addRow([b.label, b.count]);
  summary.addRow([]);
  styleHeader(summary.addRow(['Priority', 'Total', ...d.buckets.map((b) => b.label)]));
  for (const p of d.byPriority) summary.addRow([p.priority, p.total, ...d.buckets.map((b) => Number(p[b.key] ?? 0))]);
  summary.getColumn(1).width = 26;
  for (let i = 2; i <= 2 + d.buckets.length; i++) summary.getColumn(i).width = 14;

  const list = wb.addWorksheet('Overdue Work Orders');
  const headers = ['Job', 'Task', 'Priority', 'Client', 'Site', 'Due', 'Days overdue', 'Status'];
  styleHeader(list.addRow(headers));
  for (const r of d.rows) {
    const row = list.addRow([r.jobNumber, r.taskName, r.priorityName ?? r.priority, r.client, r.site, r.dueDate ?? '', r.daysOverdue ?? '', r.status]);
    row.getCell(7).font = LATE_FONT;
  }
  [12, 44, 12, 30, 30, 14, 14, 16].forEach((width, i) => (list.getColumn(i + 1).width = width));
  list.views = [{ state: 'frozen', ySplit: 1 }];
}

export async function buildExcelReport({
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
  // Columns added on screen to the breakdown tables.
  extraColumns?: string[];
  // The Overdue & Ageing section, when it could be loaded.
  overdue?: OverdueAgeingResponse | null;
  // What the figures cover and how they are worked out — printed under the
  // summary, so the file says so wherever it ends up.
  notes?: string[];
}): Promise<{ blob: Blob; filename: string }> {
  const wb = new ExcelJS.Workbook();

  const summarySheet = wb.addWorksheet('Summary');
  summarySheet.addRow(['AroFlo Reporting Dashboard']);
  summarySheet.addRow([`${dateFrom} - ${dateTo} - ${view}`]);
  summarySheet.addRow([`Generated ${today()}`]);
  summarySheet.addRow([]);
  const summaryHeader = summarySheet.addRow(['Metric', 'Value']);
  styleHeader(summaryHeader);
  for (const [key, label] of Object.entries(KPI_LABELS)) {
    const raw = (data.summary as unknown as Record<string, number | undefined>)[key];
    if (raw === undefined) continue;
    const value = key.includes('Rate') ? `${raw.toFixed(1)}%` : raw;
    summarySheet.addRow([label, value]);
  }
  if (data.summary.openInSystem !== undefined) summarySheet.addRow(['Open in system (any request date)', data.summary.openInSystem]);
  if (notes.length) {
    summarySheet.addRow([]);
    styleHeader(summarySheet.addRow(['Notes']));
    for (const note of notes) summarySheet.addRow([note]);
  }
  summarySheet.getColumn(1).width = 34;
  summarySheet.getColumn(2).width = 18;

  const complianceSheet = wb.addWorksheet('KPI Compliance');
  // On time, late and still in progress add up to the level's work orders;
  // Actual % is on time ÷ (on time + late), and is blank until something in
  // the level is finished or overdue.
  const complianceHeaders = ['Priority', 'On time', 'Late', 'In progress', 'Actual %', 'Target %', 'Variance (pp)', 'Status'];
  complianceSheet.addRow(complianceHeaders);
  styleHeader(complianceSheet.getRow(1));
  for (const r of data.priorityCompliance) {
    const row = complianceSheet.addRow([
      r.priority,
      r.onTime ?? '',
      r.late ?? '',
      r.inProgress ?? '',
      r.actualPercent === null ? '' : Number(r.actualPercent.toFixed(1)),
      Number(r.targetPercent.toFixed(0)),
      r.variancePp === null ? '' : Number(r.variancePp.toFixed(1)),
      r.status,
    ]);
    const statusCell = row.getCell(8);
    if (r.status === 'Met') {
      statusCell.font = GOOD_FONT;
    } else if (r.status === 'Below Target') {
      statusCell.fill = LATE_FILL;
      statusCell.font = LATE_FONT;
    }
  }
  complianceSheet.columns.forEach((c) => (c.width = 16));
  complianceSheet.views = [{ state: 'frozen', ySplit: 1 }];

  addBreakdownSheet(wb, 'Breakdown Work Orders', data.breakdown, extraColumns);
  addBreakdownSheet(wb, 'Preventative Maintenance', data.pmBreakdown, extraColumns);
  if (overdue) addOverdueSheets(wb, overdue);

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const viewSlug = view.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { blob, filename: `aroflo_report_${viewSlug}_${today()}.xlsx` };
}
