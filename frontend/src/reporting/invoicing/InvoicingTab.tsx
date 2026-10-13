import React, { useEffect, useMemo, useState } from 'react';
import { Palette } from '../theme';
import { KpiCard } from '../components/KpiCard';
import { InvoicingReportResponse } from '../types';
import { fetchInvoicingReport } from '../../services/reportingInvoicing';
import { formatCoverage } from '../../services/reportingRefresh';
import { buildInvoicingExcel, buildInvoicingPdf } from './exportInvoicing';
import { ClientMultiSelect, decodeClients, encodeClients } from '../components/ClientMultiSelect';
import { ariaSort, ColumnHeading, ControlColumn, ControlSummary, FilterKind, NoMatches, useTableControls } from '../components/tableControls';
import { DatePresets, firstOfThisMonth, localDay } from '../components/DatePresets';

// The client groups this report sorts every invoice into. Any number can be
// picked; none is all of them ('all').
const VIEW_OPTIONS = [
  { value: 'Ventia', label: 'Ventia' },
  { value: 'SAHA', label: 'SAHA' },
  { value: 'others', label: 'Projects / Other' },
];

const firstOfMonth = firstOfThisMonth;
// Today here, not in UTC — see localDay.
const todayStr = (): string => localDay();
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
  // Changes when the server has re-read AroFlo; the report is fetched again.
  dataVersion?: number;
  // The first day the loaded data covers (YYYY/MM/DD), if known.
  coverageFrom?: string | null;
}

interface Col {
  key: string;
  label: string;
  align?: 'right';
  money?: boolean;
  date?: boolean;
  // In a filterable table: the kind of filter under the heading. Default is
  // "at least" for money and a box to type in for everything else.
  filter?: FilterKind;
}

// A cell as the table shows it.
function cellText(c: Col, r: object): string {
  const v = (r as Record<string, unknown>)[c.key];
  if (c.money) return money(v as number);
  if (c.date) return fmtDate(v as string | null);
  return String(v ?? '');
}

interface ReportTableProps {
  title: string;
  cols: Col[];
  rows: object[];
  boldRow: (r: object) => boolean;
  palette: Palette;
  striped: boolean;
  filterable: boolean;
}

const ReportTable: React.FC<ReportTableProps> = ({ title, cols, rows, boldRow, palette, striped, filterable }) => {
  const columns: ControlColumn<object>[] = cols.map((c) => ({
    key: c.key,
    label: c.label,
    align: c.align,
    filter: c.filter ?? (c.money ? 'number' : 'text'),
    text: (r) => cellText(c, r),
    // Dates arrive as YYYY/MM/DD and amounts as numbers, which sort as they should.
    sortValue: (r) => (r as Record<string, string | number | null>)[c.key],
  }));
  const controls = useTableControls(rows, columns);
  const shown = filterable ? controls.rows : rows;
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <h3 className="text-[14px] font-semibold" style={{ color: palette.inkPrimary }}>
          {title}
        </h3>
        {filterable && rows.length > 0 && <ControlSummary controls={controls} palette={palette} noun="invoices" />}
      </div>
      {/* The surface background is what makes the stripes show: striped
          rows are the page colour, so on a bare page they vanish. */}
      <div className="overflow-auto rounded-md" style={{ background: palette.surface, border: `1px solid ${palette.border}`, maxHeight: 460 }}>
        <table className="w-full text-[12px]" style={{ color: palette.inkPrimary }}>
          <thead>
            <tr>
              {cols.map((c, i) => (
                <th
                  key={c.key}
                  aria-sort={filterable ? ariaSort(controls, c.key) : undefined}
                  className={`px-3 py-2 font-semibold sticky top-0 z-10 align-bottom ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                  style={{ color: palette.inkSecondary, background: palette.pagePlane }}
                >
                  {filterable ? <ColumnHeading column={columns[i]} controls={controls} palette={palette} /> : c.label}
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
            {filterable && <NoMatches controls={controls} palette={palette} span={cols.length} />}
            {shown.map((r, i) => (
              <tr
                key={i}
                style={{
                  background: striped && i % 2 ? palette.pagePlane : 'transparent',
                  fontWeight: boldRow(r) ? 700 : undefined,
                }}
              >
                {cols.map((c) => (
                  <td key={c.key} className={`px-3 py-1.5 ${c.align === 'right' ? 'text-right' : ''}`}>
                    {cellText(c, r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export const InvoicingTab: React.FC<Props> = ({ palette, striped, dataVersion = 0, coverageFrom = null }) => {
  const [view, setView] = useState(() => loadLocal('reporting-invoicing-view', 'all'));
  // Opens on this month to today, like Work Orders. The dates used to be
  // remembered between visits, which left the page ending on whatever day
  // it was last opened — every invoice since then missing, with nothing on
  // the page to say so. The client pick is still remembered.
  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo] = useState(todayStr);
  const [data, setData] = useState<InvoicingReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [excelBlob, setExcelBlob] = useState<{ blob: Blob; filename: string } | null>(null);
  const [pdfBlob, setPdfBlob] = useState<{ blob: Blob; filename: string } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('reporting-invoicing-view', view);
      localStorage.removeItem('reporting-invoicing-from');
      localStorage.removeItem('reporting-invoicing-to');
    } catch {
      /* noop */
    }
  }, [view]);

  const from = dateFrom > dateTo ? dateTo : dateFrom;

  // `view` stays one string — 'all', or the picked groups joined — which is
  // what the report endpoint takes and what is remembered between visits.
  const selectedGroups = useMemo(() => decodeClients(view, 'all').filter((v) => VIEW_OPTIONS.some((o) => o.value === v)), [view]);
  // What the reports print for the selection.
  const viewLabel =
    selectedGroups.length > 1 ? selectedGroups.map((v) => VIEW_OPTIONS.find((o) => o.value === v)?.label ?? v).join(' + ') : view;

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
  }, [view, from, dateTo, dataVersion]);

  // What "Paid" can be trusted for. An invoice only counts as paid when a
  // payment record for it was loaded, so anything short in the payments
  // shows up here as invoices wrongly reading unpaid — say which it is.
  const paymentsNote = useMemo(() => {
    if (!data) return '';
    const { paymentsCoverFullRange, paymentsError, paymentsWarning, paymentsRecordCount } = data.meta;
    if (paymentsCoverFullRange) return 'Payment records are loaded for the same period as the invoices.';
    if (paymentsError) return `Payments could not be loaded (${paymentsError}), so paid invoices show as unpaid here.`;
    if (paymentsWarning) return `Payments: ${paymentsWarning}.`;
    if (paymentsRecordCount === 0) return 'AroFlo returned no payment records, so every invoice shows as unpaid here.';
    return '';
  }, [data]);

  async function prepare() {
    if (!data) return;
    setBusy(true);
    setExportError(null);
    try {
      const args = { data: data.data, meta: data.meta, view: viewLabel, dateFrom: from, dateTo, paymentsNote };
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

  // `filterable` gives the table sortable headings with a filter under each.
  // For the list of invoices; the two summaries above it have total rows
  // that only make sense where they are.
  function table<T extends object>(title: string, cols: Col[], rows: T[], boldRow: (r: T) => boolean, filterable = false) {
    return (
      <ReportTable
        title={title}
        cols={cols}
        rows={rows}
        boldRow={boldRow as (r: object) => boolean}
        palette={palette}
        striped={striped}
        filterable={filterable}
      />
    );
  }

  const k = data?.data.kpis;
  // The server has not read invoices from AroFlo since it started — so there
  // are no totals to show yet, as opposed to totals of nil.
  const notLoaded = Boolean(data) && !data?.meta.lastFetchedAt;

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="md:col-span-2 flex flex-col gap-1 text-[12px]" style={{ color: palette.inkSecondary }}>
          Client
          <ClientMultiSelect
            palette={palette}
            options={VIEW_OPTIONS}
            selected={selectedGroups}
            onChange={(next) => setView(encodeClients(next, 'all'))}
          />
        </div>
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
      <DatePresets
        palette={palette}
        from={dateFrom}
        to={dateTo}
        coverageFrom={coverageFrom}
        onPick={(nextFrom, nextTo) => {
          setDateFrom(nextFrom);
          setDateTo(nextTo);
        }}
      />
      <p className="text-[12px]" style={{ color: palette.inkMuted }}>
        Date range filters on <b>Date Invoiced</b>. An invoice counts as paid when payments recorded against it in AroFlo
        add up to its total.
      </p>
      {coverageFrom && from.replace(/-/g, '/') < coverageFrom && (
        <p className="text-[12px]" style={{ color: palette.statusWarningText }}>
          AroFlo data is only loaded from {formatCoverage(coverageFrom)}, so invoices raised before then are missing from
          these figures.
        </p>
      )}

      {/* What each figure means and what it leaves out, in one place. */}
      <details className="text-[12px]" style={{ color: palette.inkSecondary }}>
        <summary className="cursor-pointer font-semibold">How these figures are worked out, and what they leave out</summary>
        <ul className="list-disc ml-5 mt-2 space-y-1">
          <li>
            <b>Period covered.</b>{' '}
            {coverageFrom
              ? `Only invoices dated since ${formatCoverage(coverageFrom)} are loaded.`
              : 'Only recent invoices are loaded — the bar at the top says from when.'}{' '}
            Anything older is not in any figure on this page.
          </li>
          <li>
            <b>Which month an invoice belongs to.</b> Its Date Invoiced. An invoice with no date yet is in no date range.
          </li>
          <li>
            <b>Submitted</b> — invoices whose status is Approved or Processed. Drafts (Not Started, Pending Approval) are
            not counted as submitted; they appear in “By status”.
          </li>
          <li>
            <b>Submitted value</b> — the total including GST, with the ex-GST total beside it.
          </li>
          <li>
            <b>Client groups.</b> Ventia, SAHA (South Australian Housing Trust), and everything else as Projects / Other —
            by the client name on the invoice.
          </li>
          <li>
            <b>Paid</b> — payments recorded against the invoice in AroFlo add up to its total. A part-paid invoice counts
            as unpaid. The note below says whether all the payments for the period were loaded.
          </li>
          <li>
            <b>How fresh.</b> As of the time in the bar at the top. Nothing updates until someone presses Refresh.
          </li>
        </ul>
      </details>

      {error && (
        <div className="p-3 rounded-md text-[13px]" style={{ background: 'rgba(220,38,38,0.10)', color: palette.statusCritical }}>
          {error}
        </div>
      )}

      {notLoaded && (
        <div
          className="rounded-md p-6 text-[13px]"
          style={{ background: 'rgba(2,132,199,0.08)', border: `1px solid ${palette.border}`, color: palette.inkSecondary }}
        >
          No invoices are loaded yet. Press <b>Refresh from AroFlo</b> at the top of the page.
        </div>
      )}

      {data && !notLoaded && (
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
              { key: 'clientBucket', label: 'Bucket', filter: 'choice' },
              { key: 'status', label: 'Status', filter: 'choice' },
              { key: 'dateInvoiced', label: 'Date Invoiced', date: true },
              { key: 'dueDate', label: 'Due Date', date: true },
              { key: 'totalInc', label: 'Total (Inc GST)', align: 'right', money: true },
              { key: 'totalEx', label: 'Total (Ex GST)', align: 'right', money: true },
              { key: 'paid', label: 'Paid', filter: 'choice' },
            ],
            data.data.invoiceList,
            () => false,
            true,
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
            Source: AroFlo API
            {data.meta.lastFetchedAt ? ` · data as of ${fmtDate(data.meta.lastFetchedAt.slice(0, 10))}` : ''} ·{' '}
            {fmtDate(from)} – {fmtDate(dateTo)} · Generated {todayStr()}
          </p>
        </>
      )}
    </div>
  );
};
