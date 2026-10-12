import React, { useEffect, useMemo, useState } from 'react';
import { Palette } from '../theme';
import { KpiCard } from '../components/KpiCard';
import { InvoicingReportResponse } from '../types';
import { fetchInvoicingReport } from '../../services/reportingInvoicing';
import { buildInvoicingExcel, buildInvoicingPdf } from './exportInvoicing';

const VIEW_OPTIONS = [
  { value: 'all', label: 'All clients' },
  { value: 'Ventia', label: 'Ventia' },
  { value: 'SAHA', label: 'SAHA' },
  { value: 'others', label: 'Projects / Other' },
];

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function loadLocal(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `$${Math.round(n).toLocaleString()}`;
}
function fmtDate(v: string | null): string {
  if (!v) return '';
  const d = new Date(v.replace(/\//g, '-'));
  return isNaN(d.getTime()) ? v : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface Props {
  palette: Palette;
  striped: boolean;
}

interface Col {
  key: string;
  label: string;
  align?: 'right';
  money?: boolean;
  date?: boolean;
}

export const InvoicingTab: React.FC<Props> = ({ palette, striped }) => {
  const [view, setView] = useState(() => loadLocal('reporting-invoicing-view', 'all'));
  const [dateFrom, setDateFrom] = useState(() => loadLocal('reporting-invoicing-from', firstOfMonth()));
  const [dateTo, setDateTo] = useState(() => loadLocal('reporting-invoicing-to', todayStr()));
  const [data, setData] = useState<InvoicingReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [excelBlob, setExcelBlob] = useState<{ blob: Blob; filename: string } | null>(null);
  const [pdfBlob, setPdfBlob] = useState<{ blob: Blob; filename: string } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('reporting-invoicing-view', view);
      localStorage.setItem('reporting-invoicing-from', dateFrom);
      localStorage.setItem('reporting-invoicing-to', dateTo);
    } catch {
      /* noop */
    }
  }, [view, dateFrom, dateTo]);

  const from = dateFrom > dateTo ? dateTo : dateFrom;

  useEffect(() => {
    let cancelled = false;
    setExcelBlob(null);
    setPdfBlob(null);
    fetchInvoicingReport(view, from, dateTo)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load'));
    return () => {
      cancelled = true;
    };
  }, [view, from, dateTo]);

  const paymentsNote = useMemo(() => {
    if (!data) return '';
    if (data.meta.paymentsCoverFullRange) return 'Payment records loaded for the selected range.';
    return (
      `AroFlo's Payments zone only reliably returns roughly the last 30 days ` +
      `(${data.meta.paymentsRecordCount} payment record${data.meta.paymentsRecordCount === 1 ? '' : 's'} loaded). ` +
      `Invoices paid before that window show as unpaid here.`
    );
  }, [data]);

  async function prepare() {
    if (!data) return;
    setBusy(true);
    setExportError(null);
    try {
      const args = { data: data.data, meta: data.meta, view, dateFrom: from, dateTo, paymentsNote };
      setExcelBlob(await buildInvoicingExcel(args));
      setPdfBlob(await buildInvoicingPdf(args));
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Failed to build reports.');
    } finally {
      setBusy(false);
    }
  }
  function download(entry: { blob: Blob; filename: string } | null) {
    if (!entry) return;
    const url = URL.createObjectURL(entry.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = entry.filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  const cardStyle: React.CSSProperties = { background: palette.surface, border: `1px solid ${palette.border}` };
  const h2 = 'text-[1.05rem] font-semibold pb-1 mb-3';

  function table<T extends object>(title: string, cols: Col[], rows: T[], boldRow: (r: T) => boolean) {
    return (
      <div>
        <h3 className="text-[14px] font-semibold mb-2" style={{ color: palette.inkPrimary }}>
          {title}
        </h3>
        <div className="overflow-auto rounded-md" style={{ border: `1px solid ${palette.border}`, maxHeight: 460 }}>
          <table className="w-full text-[12px]" style={{ color: palette.inkPrimary }}>
            <thead>
              <tr>
                {cols.map((c) => (
                  <th
                    key={c.key}
                    className={`px-3 py-2 font-semibold sticky top-0 z-10 ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                    style={{ color: palette.inkSecondary, background: palette.pagePlane }}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={cols.length} className="px-3 py-3" style={{ color: palette.inkMuted }}>
                    Nothing in this selection.
                  </td>
                </tr>
              )}
              {rows.map((r, i) => (
                <tr
                  key={i}
                  style={{
                    background: striped && i % 2 ? palette.pagePlane : 'transparent',
                    fontWeight: boldRow(r) ? 700 : undefined,
                  }}
                >
                  {cols.map((c) => {
                    const v = (r as Record<string, unknown>)[c.key];
                    let text: React.ReactNode = String(v ?? '');
                    if (c.money) text = money(v as number);
                    else if (c.date) text = fmtDate(v as string | null);
                    return (
                      <td key={c.key} className={`px-3 py-1.5 ${c.align === 'right' ? 'text-right' : ''}`}>
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const k = data?.data.kpis;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <label className="md:col-span-2 flex flex-col gap-1 text-[12px]" style={{ color: palette.inkSecondary }}>
          Client
          <select
            value={view}
            onChange={(e) => setView(e.target.value)}
            className="px-2 py-1.5 rounded-md text-[13px]"
            style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
          >
            {VIEW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: palette.inkSecondary }}>
          Invoiced from
          <input
            type="date"
            value={dateFrom}
            max={todayStr()}
            onChange={(e) => setDateFrom(e.target.value)}
            className="px-2 py-1.5 rounded-md text-[13px]"
            style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
          />
        </label>
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: palette.inkSecondary }}>
          Invoiced to
          <input
            type="date"
            value={dateTo}
            max={todayStr()}
            onChange={(e) => setDateTo(e.target.value)}
            className="px-2 py-1.5 rounded-md text-[13px]"
            style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
          />
        </label>
      </div>
      <p className="text-[12px]" style={{ color: palette.inkMuted }}>
        Date range filters on <b>Date Invoiced</b>. AroFlo returns payment records only for roughly the last 30 days
        (rolling, anchored to today) — not the last 30 days of the selected period — so “Paid” can understate older invoices.
      </p>

      {error && (
        <div className="p-3 rounded-md text-[13px]" style={{ background: 'rgba(220,38,38,0.10)', color: palette.statusCritical }}>
          {error}
        </div>
      )}

      {data && (
        <>
          <div
            className="rounded-md p-3 text-[12px]"
            style={{
              background: data.meta.paymentsCoverFullRange ? 'rgba(5,150,105,0.10)' : 'rgba(217,119,6,0.14)',
              color: data.meta.paymentsCoverFullRange ? palette.statusGood : palette.statusWarningText,
            }}
          >
            {paymentsNote}
          </div>

          {k && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Submitted" value={k.submittedCount.toLocaleString()} pillText="invoices" level="neutral" palette={palette} />
              <KpiCard
                label="Submitted value"
                value={money(k.submittedTotalInc)}
                pillText={`inc GST · ${money(k.submittedTotalEx)} ex`}
                level="neutral"
                palette={palette}
              />
              <KpiCard
                label="Paid"
                value={money(k.paidTotalInc)}
                pillText={`${k.paidCount} invoice${k.paidCount === 1 ? '' : 's'}`}
                level="good"
                palette={palette}
              />
              <KpiCard
                label="Unpaid"
                value={money(k.unpaidTotalInc)}
                pillText={`${k.unpaidCount} invoice${k.unpaidCount === 1 ? '' : 's'}`}
                level={k.unpaidCount > 0 ? 'critical' : 'good'}
                palette={palette}
              />
            </div>
          )}

          {table(
            'By client',
            [
              { key: 'client', label: 'Client' },
              { key: 'submittedCount', label: 'Submitted', align: 'right' },
              { key: 'totalInc', label: 'Total (Inc GST)', align: 'right', money: true },
              { key: 'totalEx', label: 'Total (Ex GST)', align: 'right', money: true },
              { key: 'paidCount', label: 'Paid', align: 'right' },
              { key: 'paidValue', label: 'Paid Value', align: 'right', money: true },
              { key: 'unpaidCount', label: 'Unpaid', align: 'right' },
              { key: 'unpaidValue', label: 'Unpaid Value', align: 'right', money: true },
            ],
            data.data.byClient,
            (r) => r.client === 'Total',
          )}

          {table(
            'By status',
            [
              { key: 'status', label: 'Status' },
              { key: 'client', label: 'Client' },
              { key: 'count', label: 'Count', align: 'right' },
              { key: 'totalInc', label: 'Total (Inc GST)', align: 'right', money: true },
              { key: 'totalEx', label: 'Total (Ex GST)', align: 'right', money: true },
            ],
            data.data.byStatus,
            (r) => r.client === 'Subtotal' || r.status === 'Total',
          )}

          {table(
            `Invoice list (${data.data.invoiceList.length})`,
            [
              { key: 'invoiceNumber', label: 'Invoice' },
              { key: 'client', label: 'Client' },
              { key: 'clientBucket', label: 'Bucket' },
              { key: 'status', label: 'Status' },
              { key: 'dateInvoiced', label: 'Date Invoiced', date: true },
              { key: 'dueDate', label: 'Due Date', date: true },
              { key: 'totalInc', label: 'Total (Inc GST)', align: 'right', money: true },
              { key: 'totalEx', label: 'Total (Ex GST)', align: 'right', money: true },
              { key: 'paid', label: 'Paid' },
            ],
            data.data.invoiceList,
            () => false,
          )}

          {/* Export */}
          <div>
            <h2 className={h2} style={{ borderBottom: `1px solid ${palette.border}`, color: palette.inkPrimary }}>
              Export
            </h2>
            {exportError && (
              <p className="text-[12px] mb-2" style={{ color: palette.statusCritical }}>
                {exportError}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={prepare}
                disabled={busy}
                className="px-4 py-2 rounded-md text-[13px] font-semibold disabled:opacity-50"
                style={{ background: palette.accentBlue, color: '#fff' }}
              >
                {busy ? 'Building…' : 'Prepare reports'}
              </button>
              {excelBlob && (
                <button
                  onClick={() => download(excelBlob)}
                  className="px-4 py-2 rounded-md text-[13px] font-semibold"
                  style={{ border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
                >
                  Download Excel
                </button>
              )}
              {pdfBlob && (
                <button
                  onClick={() => download(pdfBlob)}
                  className="px-4 py-2 rounded-md text-[13px] font-semibold"
                  style={{ border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
                >
                  Download PDF
                </button>
              )}
            </div>
          </div>

          <p className="text-[11px] pt-2" style={{ color: palette.inkMuted, borderTop: `1px solid ${palette.border}` }}>
            Source: AroFlo live API
            {data.meta.lastFetchedAt ? ` · data as of ${fmtDate(data.meta.lastFetchedAt.slice(0, 10))}` : ''} ·{' '}
            {fmtDate(from)} – {fmtDate(dateTo)} · Generated {todayStr()}
          </p>
        </>
      )}
    </div>
  );
};
