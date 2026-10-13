import React, { useEffect, useMemo, useState } from 'react';
import { Palette, BREAKDOWN_PRIORITIES, PM_PRIORITIES } from './theme';
import { ReportingConfig, ReportingKpisResponse, ComplianceRow, BreakdownRow } from './types';
import { fetchReportingClients } from '../services/reportingClients';
import { fetchReportingKpis } from '../services/reportingKpis';
import { formatCoverage } from '../services/reportingRefresh';
import { KpiCard, rateLevel } from './components/KpiCard';
import { EditableTable, EditableColumn } from './components/EditableTable';
import { LateRuleNote } from './components/LateRuleNote';
import { DatePresets, firstOfThisMonth, localDay } from './components/DatePresets';
import { ClientMultiSelect, ClientOption, decodeClients, encodeClients } from './components/ClientMultiSelect';
import { TrendChart } from './charts/TrendChart';
import { PriorityChart } from './charts/PriorityChart';
import { StatusChart } from './charts/StatusChart';
import { ClientComparisonChart } from './charts/ClientComparisonChart';
import { ComplianceChart } from './charts/ComplianceChart';
import { OverdueAgeingSection } from './overdueAgeing/OverdueAgeingSection';
import { buildExcelReport } from './export/buildExcelReport';
import { buildPdfReport } from './export/buildPdfReport';

const firstOfMonth = firstOfThisMonth;
// Today here, not in UTC — see localDay.
const todayStr = (): string => localDay();
function formatDisplayDate(v: string | null): string {
  if (!v) return '';
  const d = new Date(v.replace(/\//g, '-'));
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const SECTION_H2 = 'text-[1.05rem] font-semibold pb-1 mb-3';
const ALL_CLIENTS = 'All clients';

interface Props {
  palette: Palette;
  striped: boolean;
  config: ReportingConfig | null;
  // Changes when the server has re-read AroFlo (the page's Refresh button);
  // everything here is fetched again.
  dataVersion?: number;
  // The first day the loaded data covers (YYYY/MM/DD), if known.
  coverageFrom?: string | null;
}

export const AnalyticsTab: React.FC<Props> = ({ palette, striped, config, dataVersion = 0, coverageFrom = null }) => {
  const [otherClients, setOtherClients] = useState<string[]>([]);
  // Opens on the contract's clients together — the "grouped total" the
  // report is for — rather than on every client in AroFlo. The shell holds
  // this tab back until the config has loaded, so it is here to read.
  const [view, setView] = useState(() => encodeClients(config ? Object.keys(config.targetClients) : [], 'overall'));
  const [dateFrom, setDateFrom] = useState(firstOfMonth());
  const [dateTo, setDateTo] = useState(todayStr());
  const [data, setData] = useState<ReportingKpisResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [excelBlob, setExcelBlob] = useState<{ blob: Blob; filename: string } | null>(null);
  const [pdfBlob, setPdfBlob] = useState<{ blob: Blob; filename: string } | null>(null);

  useEffect(() => {
    fetchReportingClients().then(setOtherClients).catch(() => {});
  }, [dataVersion]);

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
  }, [effectiveDateFrom, effectiveDateTo, view, dataVersion]);

  const scope = useMemo(
    () => ({ view, dateFrom: effectiveDateFrom, dateTo: effectiveDateTo }),
    [view, effectiveDateFrom, effectiveDateTo],
  );

  // `view` stays one string — 'overall', or the picked clients joined — so
  // the fetches, the saved edits and the Overdue section all key off the
  // same value. These are the clients inside it.
  const selectedClients = useMemo(() => decodeClients(view, 'overall'), [view]);

  const clientOptions = useMemo(() => {
    const targets = config ? config.targetClients : {};
    const opts: ClientOption[] = Object.entries(targets).map(([fullName, shortLabel]) => ({ value: fullName, label: shortLabel }));
    for (const c of otherClients) {
      if (!(c in targets)) opts.push({ value: c, label: c });
    }
    return opts;
  }, [config, otherClients]);

  // What the current client filter is called, in messages and exports.
  const viewLabel =
    selectedClients.length === 0
      ? ALL_CLIENTS
      : selectedClients.map((c) => clientOptions.find((o) => o.value === c)?.label ?? c).join(' + ');

  const isSahaView = config
    ? view === Object.keys(config.targetClients).find((k) => config.targetClients[k] === 'SAHA')
    : false;
  // The comparison needs both sides: everyone, or a pick that includes every
  // target client.
  const targetNames = config ? Object.keys(config.targetClients) : [];
  const showClientComparison =
    targetNames.length > 0 && (selectedClients.length === 0 || targetNames.every((n) => selectedClients.includes(n)));

  const complianceRows: ComplianceRow[] = data?.priorityCompliance || [];
  const compliant = complianceRows.filter((r) => r.status === 'Met').length;
  const hasWork = (data?.summary.issued ?? 0) > 0;
  const loading = !data && !loadError;
  // The server has not read work orders from AroFlo since it started. Not
  // the same as "none in this range": there is nothing to count yet.
  const notLoaded = Boolean(data) && !data?.meta.lastFetchedAt;

  // The order the tables open in: most recently requested first. Clicking a
  // column heading re-sorts from there.
  function sortedRows(rows: BreakdownRow[]): BreakdownRow[] {
    return [...rows].sort((a, b) => (b.requestDate || '').localeCompare(a.requestDate || ''));
  }

  // `filter` is the kind of filter under each heading: a list to pick from
  // where the column holds a handful of values, "at least" for the count,
  // and a box to type in for the rest (dates included — "sep" finds them).
  const breakdownColumns: EditableColumn[] = [
    { key: 'taskId', label: 'Task ID' },
    { key: 'client', label: 'Client', filter: 'choice' },
    { key: 'requestDate', label: 'Requested Date' },
    { key: 'actualStartDate', label: 'Actual Start Date' },
    { key: 'requiredCompletedDate', label: 'Required Completed Date' },
    { key: 'completedDate', label: 'Completed Date' },
    { key: 'delayReason', label: 'Delay Reason', filter: 'choice' },
    { key: 'currentSubstatus', label: 'Substatus', filter: 'choice' },
    { key: 'daysLate', label: 'Days Late', align: 'right', filter: 'number' },
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
              const sorted = sortedRows(rowsForPriority);
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
                    filterable
                    quickFilters={[{ label: 'Late only', column: 'daysLate', value: '1' }]}
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
      // The reports print this in their title and file name. One client or
      // everyone reads as it always has; several get their names.
      const reportView = selectedClients.length > 1 ? viewLabel : view;
      const excel = await buildExcelReport({ data, dateFrom: effectiveDateFrom, dateTo: effectiveDateTo, view: reportView });
      const pdf = await buildPdfReport({ data, dateFrom: effectiveDateFrom, dateTo: effectiveDateTo, view: reportView, palette });
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
        <div className="md:col-span-2 flex flex-col gap-1 text-[12px]" style={{ color: palette.inkSecondary }}>
          Client
          <ClientMultiSelect
            palette={palette}
            options={clientOptions}
            selected={selectedClients}
            onChange={(next) => setView(encodeClients(next, 'overall'))}
            allLabel={ALL_CLIENTS}
          />
        </div>
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
      <DatePresets
        palette={palette}
        from={dateFrom}
        to={dateTo}
        coverageFrom={coverageFrom}
        onPick={(from, to) => {
          setDateFrom(from);
          setDateTo(to);
        }}
      />
      {dateFrom > dateTo && (
        <p className="text-[12px]" style={{ color: palette.statusWarningText }}>
          Start date was after the end date — using a single-day range.
        </p>
      )}
      {coverageFrom && effectiveDateFrom.replace(/-/g, '/') < coverageFrom && (
        <p className="text-[12px]" style={{ color: palette.statusWarningText }}>
          AroFlo data is only loaded from {formatCoverage(coverageFrom)}, so work orders requested before then are missing
          from these figures.
        </p>
      )}

      {/* What each figure means and what it leaves out, in one place, so a
          number on this page is never read as something it isn't. */}
      <details className="text-[12px]" style={{ color: palette.inkSecondary }}>
        <summary className="cursor-pointer font-semibold">How these figures are worked out, and what they leave out</summary>
        <ul className="list-disc ml-5 mt-2 space-y-1">
          <li>
            <b>Period covered.</b>{' '}
            {coverageFrom
              ? `Only work orders requested since ${formatCoverage(coverageFrom)} are loaded.`
              : 'Only recent work orders are loaded — the bar at the top says from when.'}{' '}
            Anything older, including a job that is still open, is not in any figure on this page.
          </li>
          <li>
            <b>Which month a work order belongs to.</b> The one it was requested in. Every figure below is for work orders
            requested inside the date range.
          </li>
          <li>
            <b>Issued</b> — work orders requested in the range. <b>Completed</b> — of those, the ones whose status is now
            Completed or Archived (not “work finished during the range”). <b>Outstanding</b> — issued minus completed.
          </li>
          <li>
            <b>Open in system</b> (under Outstanding) — every loaded work order for the chosen clients that isn’t finished,
            whatever the date range.
          </li>
          <li>
            <b>Overdue</b> — still open past its Required Completed Date, or completed after it. The Overdue &amp; Ageing
            section is open jobs only.
          </li>
          <li>
            <b>Completion rate</b> — completed ÷ issued. <b>Overdue rate</b> — overdue ÷ completed, so it can pass 100% while
            few of the range’s jobs are finished.
          </li>
          <li>
            <b>Target KPI Compliance</b> — the share of each priority’s work orders that are not overdue, against the target
            {config
              ? ` (${Object.entries(config.priorityTargets)
                  .map(([level, target]) => `${level} ${target}%`)
                  .join(', ')})`
              : ''}
            . A job that is open and not yet due counts as on time.
          </li>
          <li>
            <b>Against the KPI Matrix.</b> A job that is overdue here is late on its priority’s Completed row there, for
            the same clients and month — the counts agree. The percentages are worked differently: there a job that is
            open and not yet due is left out until it is finished or overdue, so the Matrix can read lower while work is
            in progress. The Matrix also scores when a job was started, which this page does not, and puts level 5 in
            its P4 row.
          </li>
          <li>
            <b>Priorities.</b> Named as AroFlo names them. AP1–AP5 are counted with P1–P5, and SM with PM. P5 has no target,
            so it is in no compliance row. A work order with another priority, or none, is in General Statistics but not in
            the priority sections.
          </li>
          <li>
            <b>Actual Start Date</b> — the first labour entry logged on the job. <b>Required Completed Date</b> — the job’s
            due date in AroFlo.
          </li>
          <li>
            <b>Delay Reason</b> — for late jobs only, and only as far as AroFlo records one. It is the job’s current
            substatus when that is Non Access, Materials Ordered, On Hold/Materials Required or Sent to Procurement — a
            job in one of those that is not past due shows no reason. Otherwise the job’s notes
            are searched for wording about access or materials, and a match is marked “(from notes)” — a keyword match, so
            treat it as a prompt to read the job, not a finding. “-” means neither gave a reason. AroFlo keeps no history of
            substatuses, so a job that was held up and has since moved on shows a reason only if a note says so. Delay
            reasons do not change any figure: a late job counts as late whatever the cause.
          </li>
          <li>
            <b>Clients.</b> Opens on {config ? Object.values(config.targetClients).join(' + ') : 'the contract clients'}{' '}
            together; pick one for its own figures, or All clients for everyone in AroFlo.
          </li>
          <li>
            <b>How fresh.</b> As of the time in the bar at the top. Nothing updates until someone presses Refresh.
          </li>
        </ul>
      </details>

      {!notLoaded && <LateRuleNote palette={palette} />}

      {loading && (
        <div className="rounded-md p-6 text-center text-[13px]" style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.inkMuted }}>
          Loading…
        </div>
      )}

      {notLoaded && (
        <div
          className="rounded-md p-6 text-[13px]"
          style={{ background: 'rgba(2,132,199,0.08)', border: `1px solid ${palette.border}`, color: palette.inkSecondary }}
        >
          No work orders are loaded yet. Press <b>Refresh from AroFlo</b> at the top of the page.
        </div>
      )}

      {data && !hasWork && !notLoaded && (
        <div
          className="rounded-md p-6 text-[13px]"
          style={{ background: 'rgba(2,132,199,0.08)', border: `1px solid ${palette.border}`, color: palette.inkSecondary }}
        >
          No work orders were requested between {formatDisplayDate(effectiveDateFrom)} and {formatDisplayDate(effectiveDateTo)}
          {view !== 'overall' ? ` for ${viewLabel}` : ''}. Widen the date range or
          change the client filter.
        </div>
      )}

      {/* Overdue & Ageing Work — independent of the date range (it's "what's open
          right now"), so it renders even when nothing was requested in-range.
          Not before anything is loaded, though: "0 overdue" would be a claim. */}
      {!notLoaded && (
        <OverdueAgeingSection palette={palette} striped={striped} view={view} dataVersion={dataVersion} coverageFrom={coverageFrom} />
      )}

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
              {/* The tile is for the period; the pill is the brief's
                  "outstanding in the system" — every open job that is loaded. */}
              <KpiCard
                label="Outstanding"
                value={data.summary.outstanding.toLocaleString()}
                pillText={data.summary.openInSystem === undefined ? null : `${data.summary.openInSystem.toLocaleString()} open in system`}
                level="neutral"
                palette={palette}
              />
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
            {/* The comparison chart only exists for "All clients"; with one
                company picked the status chart takes the whole row rather
                than leaving half of it empty. */}
            <div className={`grid grid-cols-1 gap-4 ${showClientComparison ? 'lg:grid-cols-2' : ''}`}>
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
            'No P5 / PM work orders in this selection.',
          )}

          {/* Export */}
          <div>
            <h2 className={SECTION_H2} style={{ borderBottom: `1px solid ${palette.border}`, color: palette.inkPrimary }}>
              Export Full Report
            </h2>
            <p className="text-[12px] mb-3" style={{ color: palette.inkMuted }}>
              Reports reflect the current selection ({formatDisplayDate(effectiveDateFrom)} – {formatDisplayDate(effectiveDateTo)} ·{' '}
              {viewLabel}) exactly as shown on screen, including any manual edits —
              print/save as-is. The General Statistics KPI row is always computed from the real underlying data, since it
              isn't itself an editable table. Sorting or filtering a table is for looking at it here: the reports list
              every row, in their usual order.
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
        Source: AroFlo API
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
