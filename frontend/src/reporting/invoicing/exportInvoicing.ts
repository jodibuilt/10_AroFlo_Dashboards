import ExcelJS from 'exceljs';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { InvoicingReportResponse } from '../types';

function money(n: number | null): string {
  if (n === null || n === undefined) return '';
  return `$${Math.round(n).toLocaleString()}`;
}
function fmtDate(v: string | null): string {
  if (!v) return '';
  const d = new Date(v.replace(/\//g, '-'));
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface Args {
  data: InvoicingReportResponse['data'];
  meta: InvoicingReportResponse['meta'];
  view: string;
  dateFrom: string;
  dateTo: string;
  paymentsNote: string;
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF4F4F0' } };
function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((c) => (c.fill = HEADER_FILL));
}

export async function buildInvoicingExcel({ data, view, dateFrom, dateTo, paymentsNote }: Args) {
  const wb = new ExcelJS.Workbook();

  const sum = wb.addWorksheet('Summary');
  sum.addRow(['AroFlo Invoicing Report']);
  sum.addRow([`${dateFrom} to ${dateTo} · ${view}`]);
  sum.addRow([`Generated ${new Date().toISOString().slice(0, 10)}`]);
  sum.addRow([paymentsNote]);
  sum.addRow([]);
  styleHeader(sum.addRow(['Metric', 'Value']));
  const k = data.kpis;
  [
    ['Submitted invoices', k.submittedCount],
    ['Submitted total (inc GST)', money(k.submittedTotalInc)],
    ['Submitted total (ex GST)', money(k.submittedTotalEx)],
    ['Paid', k.paidCount],
    ['Paid value (inc GST)', money(k.paidTotalInc)],
    ['Unpaid', k.unpaidCount],
    ['Unpaid value (inc GST)', money(k.unpaidTotalInc)],
  ].forEach((r) => sum.addRow(r));
  sum.getColumn(1).width = 28;
  sum.getColumn(2).width = 22;

  const byClient = wb.addWorksheet('By Client');
  styleHeader(
    byClient.addRow(['Client', 'Submitted', 'Total (Inc GST)', 'Total (Ex GST)', 'Paid', 'Paid Value', 'Unpaid', 'Unpaid Value']),
  );
  for (const r of data.byClient) {
    const row = byClient.addRow([
      r.client, r.submittedCount, money(r.totalInc), money(r.totalEx), r.paidCount, money(r.paidValue), r.unpaidCount, money(r.unpaidValue),
    ]);
    if (r.client === 'Total') row.font = { bold: true };
  }
  byClient.columns.forEach((c, i) => (c.width = [18, 11, 16, 16, 8, 14, 8, 14][i] ?? 14));

  const byStatus = wb.addWorksheet('By Status');
  styleHeader(byStatus.addRow(['Status', 'Client', 'Count', 'Total (Inc GST)', 'Total (Ex GST)']));
  for (const r of data.byStatus) {
    const row = byStatus.addRow([r.status, r.client, r.count, money(r.totalInc), money(r.totalEx)]);
    if (r.client === 'Subtotal' || r.status === 'Total') row.font = { bold: true };
  }
  byStatus.columns.forEach((c, i) => (c.width = [18, 16, 9, 16, 16][i] ?? 14));

  const list = wb.addWorksheet('Invoice List');
  styleHeader(
    list.addRow(['Invoice', 'Client', 'Bucket', 'Status', 'Date Invoiced', 'Due Date', 'Total (Inc GST)', 'Total (Ex GST)', 'Paid']),
  );
  for (const r of data.invoiceList) {
    list.addRow([
      r.invoiceNumber, r.client, r.clientBucket, r.status, fmtDate(r.dateInvoiced), fmtDate(r.dueDate), money(r.totalInc), money(r.totalEx), r.paid,
    ]);
  }
  list.columns.forEach((c, i) => (c.width = [14, 26, 14, 16, 14, 14, 16, 16, 7][i] ?? 14));
  list.views = [{ state: 'frozen', ySplit: 1 }];

  const buffer = await wb.xlsx.writeBuffer();
  return {
    blob: new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    filename: `aroflo_invoicing_${new Date().toISOString().slice(0, 10)}.xlsx`,
  };
}

export async function buildInvoicingPdf({ data, view, dateFrom, dateTo, paymentsNote }: Args) {
  const doc = new jsPDF({ format: 'a4', unit: 'pt' });
  const margin = 1.5 * 28.35;
  let y = margin;

  doc.setFontSize(16);
  doc.text('AroFlo Invoicing Report', margin, y);
  y += 18;
  doc.setFontSize(10);
  doc.setTextColor(90);
  doc.text(`${dateFrom} to ${dateTo} · ${view}`, margin, y);
  y += 13;
  doc.text(`Generated ${new Date().toISOString().slice(0, 10)}`, margin, y);
  y += 13;
  doc.text(doc.splitTextToSize(paymentsNote, 500 - margin), margin, y);
  y += 26;
  doc.setTextColor(20);

  const k = data.kpis;
  doc.setFontSize(12);
  doc.text('Summary', margin, y);
  y += 8;
  autoTable(doc, {
    startY: y,
    head: [['Metric', 'Value']],
    body: [
      ['Submitted invoices', String(k.submittedCount)],
      ['Submitted total (inc GST)', money(k.submittedTotalInc)],
      ['Submitted total (ex GST)', money(k.submittedTotalEx)],
      ['Paid', String(k.paidCount)],
      ['Paid value (inc GST)', money(k.paidTotalInc)],
      ['Unpaid', String(k.unpaidCount)],
      ['Unpaid value (inc GST)', money(k.unpaidTotalInc)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [244, 244, 240], textColor: 20 },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;

  doc.text('By Client', margin, y);
  y += 8;
  autoTable(doc, {
    startY: y,
    head: [['Client', 'Submitted', 'Total Inc', 'Total Ex', 'Paid', 'Paid Value', 'Unpaid', 'Unpaid Value']],
    body: data.byClient.map((r) => [
      r.client, String(r.submittedCount), money(r.totalInc), money(r.totalEx), String(r.paidCount), money(r.paidValue), String(r.unpaidCount), money(r.unpaidValue),
    ]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [244, 244, 240], textColor: 20 },
    didParseCell: (h) => {
      if (h.section === 'body' && data.byClient[h.row.index]?.client === 'Total') h.cell.styles.fontStyle = 'bold';
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 20;

  doc.text('By Status', margin, y);
  y += 8;
  autoTable(doc, {
    startY: y,
    head: [['Status', 'Client', 'Count', 'Total Inc', 'Total Ex']],
    body: data.byStatus.map((r) => [r.status, r.client, String(r.count), money(r.totalInc), money(r.totalEx)]),
    styles: { fontSize: 8 },
    headStyles: { fillColor: [244, 244, 240], textColor: 20 },
    didParseCell: (h) => {
      const r = data.byStatus[h.row.index];
      if (h.section === 'body' && r && (r.client === 'Subtotal' || r.status === 'Total')) h.cell.styles.fontStyle = 'bold';
    },
  });

  doc.addPage();
  doc.setFontSize(12);
  doc.text('Invoice List', margin, margin);
  autoTable(doc, {
    startY: margin + 10,
    head: [['Invoice', 'Client', 'Bucket', 'Status', 'Date Inv.', 'Due', 'Total Inc', 'Total Ex', 'Paid']],
    body: data.invoiceList.map((r) => [
      r.invoiceNumber, r.client, r.clientBucket, r.status, fmtDate(r.dateInvoiced), fmtDate(r.dueDate), money(r.totalInc), money(r.totalEx), r.paid,
    ]),
    styles: { fontSize: 7 },
    headStyles: { fillColor: [244, 244, 240], textColor: 20 },
  });

  return {
    blob: doc.output('blob'),
    filename: `aroflo_invoicing_${new Date().toISOString().slice(0, 10)}.pdf`,
  };
}
