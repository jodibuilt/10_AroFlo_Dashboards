import React, { useEffect, useMemo, useState } from 'react';
import { Palette, BREAKDOWN_PRIORITIES, PM_PRIORITIES } from './theme';
import { ReportingConfig, ReportingKpisResponse, ComplianceRow, BreakdownRow } from './types';
import { fetchReportingClients } from '../services/reportingClients';
import { fetchReportingKpis } from '../services/reportingKpis';
import { KpiCard, rateLevel } from './components/KpiCard';
import { EditableTable, EditableColumn } from './components/EditableTable';
import { TrendChart } from './charts/TrendChart';
import { PriorityChart } from './charts/PriorityChart';
import { StatusChart } from './charts/StatusChart';
import { ClientComparisonChart } from './charts/ClientComparisonChart';
import { ComplianceChart } from './charts/ComplianceChart';
import { OverdueAgeingSection } from './overdueAgeing/OverdueAgeingSection';
import { buildExcelReport } from './export/buildExcelReport';
import { buildPdfReport } from './export/buildPdfReport';

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}
function formatDisplayDate(v: string | null): string {
  if (!v) return '';
  const d = new Date(v.replace(/\//g, '-'));
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const SECTION_H2 = 'text-[1.05rem] font-semibold pb-1 mb-3';

interface Props {
  palette: Palette;
  striped: boolean;
  config: ReportingConfig | null;
}

export const AnalyticsTab: React.FC<Props> = ({ palette, striped, config }) => {
  const [otherClients, setOtherClients] = useState<string[]>([]);
  const [view, setView] = useState('overall');
  const [dateFrom, setDateFrom] = useState(firstOfMonth());
  const [dateTo, setDateTo] = useState(todayStr());
  const [data, setData] = useState<ReportingKpisResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [excelBlob, setExcelBlob] = useState<{ blob: Blob; filename: string } | null>(null);
  const [pdfBlob, setPdfBlob] = useState<{ blob: Blob; filename: string } | null>(null);
  const [ascending, setAscending] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchReportingClients().then(setOtherClients).catch(() => {});
  }, []);

  const effectiveDateFrom = dateFrom > dateTo ? dateTo : dateFrom;
  const effectiveDateTo = dateTo;

  useEffect(() => {
    fetchReportingKpis(effectiveDateFrom, effectiveDateTo, view)
      .then((res) => {
        setData(res);
        setLoadError(null);
        setExcelBlob(null);
        setPdfBlob(null);
      })
      .catch((e) => setLoadError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveDateFrom, effectiveDateTo, view]);

  const scope = useMemo(
    () => ({ view, dateFrom: effectiveDateFrom, dateTo: effectiveDateTo }),
    [view, effectiveDateFrom, effectiveDateTo],
  );

  const viewOptions = useMemo(() => {
    const opts = [{ value: 'overall', label: 'All clients (grouped)' }];
    if (!config) return opts;
    const targetFullNames = new Set(Object.keys(config.targetClients));
    for (const [fullName, shortLabel] of Object.entries(config.targetClients)) {
      opts.push({ value: fullName, label: shortLabel });
    }
    for (const c of otherClients) {
      if (!targetFullNames.has(c)) opts.push({ value: c, label: c });
    }
    return opts;
  }, [config, otherClients]);

  const isSahaView = config
    ? view === Object.keys(config.targetClients).find((k) => config.targetClients[k] === 'SAHA')
    : false;
  const showClientComparison =
    view === 'overall' && !!config && Object.keys(config.targetClients).length > 0;

  const complianceRows: ComplianceRow[] = data?.priorityCompliance || [];
  const compliant = complianceRows.filter((r) => r.status === 'Met').length;
  const hasWork = (data?.summary.issued ?? 0) > 0;
  const loading = !data && !loadError;

  function sortedRows(rows: BreakdownRow[], priority: string): BreakdownRow[] {
    const asc = ascending[priority] ?? false;
    const sorted = [...rows].sort((a, b) => (a.requestDate || '').localeCompare(b.requestDate || ''));
    return asc ? sorted : sorted.reverse();
  }

  const breakdownColumns: EditableColumn[] = [
    { key: 'taskId', label: 'Task ID' },
    { key: 'client', label: 'Client' },
    { key: 'requestDate', label: 'Requested Date' },
    { key: 'actualStartDate', label: 'Actual Start Date' },
    { key: 'requiredCompletedDate', label: 'Required Completed Date' },
    { key: 'completedDate', label: 'Completed Date' },
    { key: 'delayReason', label: 'Delay Reason' },
    { key: 'currentSubstatus', label: 'Substatus' },
    { key: 'daysLate', label: 'Days Late', align: 'right' },
  ];

  function breakdownCellStyle(colKey: string, row: Record<string, string | number | null>): React.CSSProperties | undefined {
    if (colKey !== 'daysLate') return undefined;
    const v = Number(row.daysLate);
    if (!v || v <= 0) return { color: palette.statusGood };
    return { color: palette.statusCritical, fontWeight: 700, background: 'rgba(220,38,38,0.10)' };
  }
  function breakdownFormatCell(colKey: string, value: string | number | null): React.ReactNode {
    if (['requestDate', 'actualStartDate', 'requiredCompletedDate', 'completedDate'].includes(colKey))
      return formatDisplayDate(value as string);
    return String(value ?? '');
  }

  function renderBreakdownSection(title: string, priorities: string[], rows: BreakdownRow[], sectionKey: string, emptyHint: string) {
    return (
      <div className="space-y-3">
        <h2 className="font-semibold text-[16px]" style={{ color: palette.inkPrimary }}>
          {title}
        </h2>
        {sectionKey === 'breakdown' && isSahaView && (
          <p className="text-[12px]" style={{ color: palette.inkMuted }}>
            SAHA's own priority labels are "AP1"–"AP5" rather than "P1"–"P5" — same urgency levels as Ventia's, just
            different contract terminology.
          </p>
        )}
        {rows.length === 0 ? (
          <div
            className="rounded-md p-6 text-center text-[13px]"
            style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.inkMuted }}
          >
            {emptyHint}
          </div>
        ) : (
          <PriorityTabs
            priorities={priorities}
            isSahaView={sectionKey === 'breakdown' && isSahaView}
            renderTab={(priority) => {
              const rowsForPriority = rows.filter((r) => r.priority === priority);
              if (rowsForPriority.length === 0) {
                return (
                  <p className="text-[13px] p-4" style={{ color: palette.inkMuted }}>
                    No work orders found for priority {priority} in this selection.
                  </p>
                );
              }
              const sorted = sortedRows(rowsForPriority, priority);
              const runningLate = sorted.filter((r) => (r.daysLate || 0) > 0).length;
              const avgVariance = sorted.length ? sorted.reduce((s, r) => s + (r.daysLate || 0), 0) / sorted.length : null;
              return (
                <div className="space-y-2">
                  <EditableTable
                    stateKey={`${sectionKey}_${priority}`}
                    scope={scope}
                    columns={breakdownColumns}
                    defaultRows={sorted as unknown as Record<string, string | number | null>[]}
                    palette={palette}
                    striped={striped}
                    cellStyle={breakdownCellStyle}
                    formatCell={breakdownFormatCell}
                    extraHeaderControls={
                      <button
                        onClick={() => setAscending((prev) => ({ ...prev, [priority]: !(prev[priority] ?? false) }))}
                        title="Toggle sort by Requested Date"
                        className="p-1 rounded-md hover:opacity-70"
                        style={{ color: palette.inkMuted }}
                      >
                        <span className="material-symbols-outlined text-[18px]">
                          {ascending[priority] ? 'arrow_upward' : 'arrow_downward'}
                        </span>
                      </button>
                    }
                  />
                  <div
                    className="rounded-md flex items-center gap-6 px-4 py-2 text-[12px]"
                    style={{ background: palette.pagePlane, border: `1px solid ${palette.border}` }}
                  >
                    <span style={{ color: palette.inkMuted }}>
                      Work Orders <b style={{ color: palette.inkPrimary }}>{sorted.length}</b>
                    </span>
                    <span style={{ color: runningLate > 0 ? palette.statusCritical : palette.statusGood }}>
                      Running Late <b>{runningLate}</b>
                    </span>
                    <span style={{ color: palette.inkMuted }}>
                      Avg. Variance{' '}
                      <b style={{ color: palette.inkPrimary }}>
                        {avgVariance === null ? 'n/a' : `${avgVariance >= 0 ? '+' : ''}${avgVariance.toFixed(1)}d`}
                      </b>
                    </span>
                  </div>
                </div>
              );
            }}
          />
        )}
      </div>
    );
  }

  async function handlePrepareReports() {
    if (!data || !config) return;
    setPreparing(true);
    setExportError(null);
    try {
      const excel = await buildExcelReport({ data, dateFrom: effectiveDateFrom, dateTo: effectiveDateTo, view });
      const pdf = await buildPdfReport({ data, dateFrom: effectiveDateFrom, dateTo: effectiveDateTo, view, palette });
      setExcelBlob(excel);
      setPdfBlob(pdf);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Failed to build reports.');
    } finally {
      setPreparing(false);
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

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="p-3 rounded-md text-[13px]" style={{ background: 'rgba(220,38,38,0.10)', color: palette.statusCritical }}>
          {loadError}
        </div>
      )}

      {/* Filters row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <label className="md:col-span-2 flex flex-col gap-1 text-[12px]" style={{ color: palette.inkSecondary }}>
          Client
          <select
            value={view}
            onChange={(e) => setView(e.target.value)}
            className="px-2 py-1.5 rounded-md text-[13px]"
            style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
          >
            {viewOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px]" style={{ color: palette.inkSecondary }}>
          Start date
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
          End date
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
      {dateFrom > dateTo && (
        <p className="text-[12px]" style={{ color: palette.statusWarningText }}>
          Start date was after the end date — using a single-day range.
        </p>
      )}

      {loading && (
        <div className="rounded-md p-6 text-center text-[13px]" style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.inkMuted }}>
          Loading…
        </div>
      )}

      {data && !hasWork && (
        <div
          className="rounded-md p-6 text-[13px]"
          style={{ background: 'rgba(2,132,199,0.08)', border: `1px solid ${palette.border}`, color: palette.inkSecondary }}
        >
          No work orders were requested between {formatDisplayDate(effectiveDateFrom)} and {formatDisplayDate(effectiveDateTo)}
          {view !== 'overall' ? ` for ${viewOptions.find((o) => o.value === view)?.label}` : ''}. Widen the date range or
          change the client filter.
        </div>
      )}

      {/* Overdue & Ageing Work — independent of the date range (it's "what's open
          right now"), so it renders even when nothing was requested in-range. */}
      <OverdueAgeingSection palette={palette} striped={striped} view={view} />

      {data && hasWork && (
        <>
          {/* General Statistics */}
          <div>
            <h2 className={SECTION_H2} style={{ borderBottom: `1px solid ${palette.border}`, color: palette.inkPrimary }}>
              General Statistics
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <KpiCard label="Issued" value={data.summary.issued.toLocaleString()} level="neutral" palette={palette} />
              <KpiCard label="Completed" value={data.summary.completed.toLocaleString()} level="good" palette={palette} />
              <KpiCard label="Outstanding" value={data.summary.outstanding.toLocaleString()} level="neutral" palette={palette} />
              <KpiCard
                label="Overdue"
                value={data.summary.overdue.toLocaleString()}
                pillText={data.summary.overdue > 0 ? 'needs attention' : 'on track'}
                level={data.summary.overdue > 0 ? 'critical' : 'good'}
                palette={palette}
              />
              <KpiCard
                label="Completion Rate"
                value={`${data.summary.completionRate.toFixed(1)}%`}
                pillText="of issued"
                level={rateLevel(data.summary.completionRate, 90, 75, true)}
                palette={palette}
              />
              <KpiCard
                label="Overdue Rate"
                value={`${data.summary.overdueRate.toFixed(1)}%`}
                pillText="of completed"
                level={rateLevel(data.summary.overdueRate, 10, 25, false)}
                palette={palette}
              />
            </div>
          </div>

          {/* Target KPI Compliance */}
          <div>
            <h2 className="text-[1.05rem] font-semibold pb-1 mb-1" style={{ borderBottom: `1px solid ${palette.border}`, color: palette.inkPrimary }}>
              Target KPI Compliance
            </h2>
            <p className="text-[12px] mb-3" style={{ color: palette.inkMuted }}>
              Actual on-time rate (share of work orders not overdue) vs. the agreed SLA target, by priority. Click the
              pencil to edit.
            </p>
            {complianceRows.length === 0 ? (
              <div
                className="rounded-md p-4 text-[13px]"
                style={{ background: 'rgba(2,132,199,0.08)', color: palette.inkSecondary, border: `1px solid ${palette.border}` }}
              >
                No work orders in a priority with a defined KPI target for this selection.
                {data && !data.meta.priorityCodeMapConfigured && (
                  <> This account's priority-to-P-code mapping (KPI_PRIORITY_CODE_MAP_JSON) isn't configured yet.</>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
                <div className="lg:col-span-2 space-y-2">
                  <EditableTable
                    stateKey="compliance"
                    scope={scope}
                    palette={palette}
                    striped={striped}
                    columns={[
                      { key: 'priority', label: 'Priority' },
                      { key: 'actual', label: 'Actual %', align: 'right' },
                      { key: 'target', label: 'Target %', align: 'right' },
                      { key: 'variance', label: 'Variance (pp)', align: 'right' },
                      { key: 'status', label: 'Status' },
                    ]}
                    defaultRows={complianceRows.map((r) => ({
                      priority: r.priority,
                      actual: r.actualPercent.toFixed(1),
                      target: r.targetPercent.toFixed(0),
                      variance: `${r.variancePp >= 0 ? '+' : ''}${r.variancePp.toFixed(1)}`,
                      status: r.status,
                    }))}
                    cellStyle={(colKey, row) => {
                      if (colKey === 'variance') {
                        const v = parseFloat(String(row.variance));
                        return v >= 0
                          ? { color: palette.statusGood, background: 'rgba(5,150,105,0.08)' }
                          : { color: palette.statusCritical, background: 'rgba(220,38,38,0.10)' };
                      }
                      if (colKey === 'status') {
                        return row.status === 'Met'
                          ? { color: palette.statusGood, fontWeight: 700 }
                          : { color: palette.statusCritical, fontWeight: 700 };
                      }
                      return undefined;
                    }}
                  />
                  <div
                    className="rounded-md flex items-center justify-between px-4 py-2 text-[12px]"
                    style={{ background: palette.pagePlane, border: `1px solid ${palette.border}` }}
                  >
                    <div className="flex gap-6">
                      <span style={{ color: palette.inkMuted }}>
                        Total Tiers <b style={{ color: palette.inkPrimary }}>{complianceRows.length}</b>
                      </span>
                      <span style={{ color: palette.statusGood }}>
                        Met Target <b>{compliant}</b>
                      </span>
                      <span style={{ color: complianceRows.length - compliant > 0 ? palette.statusCritical : palette.statusGood }}>
                        Below Target <b>{complianceRows.length - compliant}</b>
                      </span>
                    </div>
                  </div>
                </div>
                <div className="lg:col-span-3">
                  <ComplianceChart rows={complianceRows} palette={palette} stateKey="compliance_chart" scope={scope} />
                </div>
              </div>
            )}
          </div>

          {/* Visual Overview */}
          <div>
            <h2 className={SECTION_H2} style={{ borderBottom: `1px solid ${palette.border}`, color: palette.inkPrimary }}>
              Visual Overview
            </h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              <TrendChart tasks={data.tasks} palette={palette} stateKey="chart_trend" scope={scope} />
              <PriorityChart tasks={data.tasks} palette={palette} stateKey="chart_priority" scope={scope} />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <StatusChart tasks={data.tasks} palette={palette} stateKey="chart_status" scope={scope} />
              {showClientComparison && config && (
                <ClientComparisonChart
                  tasks={data.tasks}
                  targetClients={config.targetClients}
                  palette={palette}
                  stateKey="chart_client_comparison"
                  scope={scope}
                />
              )}
            </div>
          </div>

          {renderBreakdownSection(
            'Breakdown Work Orders (P1 – P4)',
            BREAKDOWN_PRIORITIES,
            data.breakdown,
            'breakdown',
            'No P1–P4 work orders in this selection.',
          )}
          {renderBreakdownSection(
            'Preventative Maintenance (P5 / PM)',
            PM_PRIORITIES,
            data.pmBreakdown,
            'pm',
            'No PM work orders in this selection. This account has no PM priority configured, so this section is normally empty.',
          )}

          {/* Export */}
          <div>
            <h2 className={SECTION_H2} style={{ borderBottom: `1px solid ${palette.border}`, color: palette.inkPrimary }}>
              Export Full Report
            </h2>
            <p className="text-[12px] mb-3" style={{ color: palette.inkMuted }}>
              Reports reflect the current selection ({formatDisplayDate(effectiveDateFrom)} – {formatDisplayDate(effectiveDateTo)} ·{' '}
              {viewOptions.find((o) => o.value === view)?.label}) exactly as shown on screen, including any manual edits —
              print/save as-is. The General Statistics KPI row is always computed from the real underlying data, since it
              isn't itself an editable table.
            </p>
            {exportError && (
              <p className="text-[12px] mb-2" style={{ color: palette.statusCritical }}>
                {exportError}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={handlePrepareReports}
                disabled={preparing || !data}
                className="px-4 py-2 rounded-md text-[13px] font-semibold disabled:opacity-50"
                style={{ background: palette.accentBlue, color: '#fff' }}
              >
                {preparing ? 'Building Excel and PDF reports…' : 'Prepare reports'}
              </button>
              {excelBlob && (
                <button onClick={() => download(excelBlob)} className="px-4 py-2 rounded-md text-[13px] font-semibold" style={{ border: `1px solid ${palette.border}`, color: palette.inkPrimary }}>
                  Download Excel
                </button>
              )}
              {pdfBlob && (
                <button onClick={() => download(pdfBlob)} className="px-4 py-2 rounded-md text-[13px] font-semibold" style={{ border: `1px solid ${palette.border}`, color: palette.inkPrimary }}>
                  Download PDF
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <p className="text-[11px] pt-2" style={{ color: palette.inkMuted, borderTop: `1px solid ${palette.border}` }}>
        Source: AroFlo live API
        {data?.meta.lastFetchedAt ? ` · data as of ${formatDisplayDate(data.meta.lastFetchedAt.slice(0, 10))}` : ''} ·{' '}
        {formatDisplayDate(effectiveDateFrom)} – {formatDisplayDate(effectiveDateTo)} · Generated {todayStr()}
      </p>
    </div>
  );
};

const PriorityTabs: React.FC<{ priorities: string[]; isSahaView: boolean; renderTab: (p: string) => React.ReactNode }> = ({
  priorities,
  isSahaView,
  renderTab,
}) => {
  const [active, setActive] = useState(priorities[0]);
  const label = (p: string) => (isSahaView && p !== 'PM' ? `A${p}` : p);
  return (
    <div>
      <div className="flex gap-1 mb-2">
        {priorities.map((p) => (
          <button
            key={p}
            onClick={() => setActive(p)}
            className={`px-3 py-1.5 text-[12px] font-semibold rounded-t ${active === p ? 'tab-active' : ''}`}
          >
            {label(p)}
          </button>
        ))}
      </div>
      {priorities.map((p) => (active === p ? <div key={p}>{renderTab(p)}</div> : null))}
    </div>
  );
};
