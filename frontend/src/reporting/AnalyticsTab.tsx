import React, { useEffect, useMemo, useState } from 'react';
import { Palette, BREAKDOWN_PRIORITIES, PM_PRIORITIES } from './theme';
import { ReportingConfig, ReportingKpisResponse, ComplianceRow, BreakdownRow } from './types';
import { fetchReportingKpis } from '../services/reportingKpis';
import { formatCoverage } from '../services/reportingRefresh';
import { KpiCard, rateLevel } from './components/KpiCard';
import { EditableTable, EditableColumn } from './components/EditableTable';
import { LateRuleNote } from './components/LateRuleNote';
import { DatePresets, firstOfThisMonth } from './components/DatePresets';
import { ReportDownloads } from './components/ReportDownloads';
import { fetchOverdueAgeing } from '../services/reportingOverdue';
import { dayOfInstant, formatDay, today, zoneName } from './time';
import { ClientMultiSelect, clientGroupOptions, decodeClients, encodeClients } from './components/ClientMultiSelect';
import { loadDashboardEdit } from '../services/reportingEdits';
import { levelLabel } from './theme';
import { TrendChart } from './charts/TrendChart';
import { PriorityChart } from './charts/PriorityChart';
import { StatusChart } from './charts/StatusChart';
import { ClientComparisonChart } from './charts/ClientComparisonChart';
import { ComplianceChart } from './charts/ComplianceChart';
import { OverdueAgeingSection } from './overdueAgeing/OverdueAgeingSection';
import { buildExcelReport } from './export/buildExcelReport';
import { buildPdfReport } from './export/buildPdfReport';

// Both in Adelaide time, wherever the browser is — see ./time.
const firstOfMonth = firstOfThisMonth;
const todayStr = today;
const formatDisplayDate = (v: string | null): string => formatDay(v);

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
  // Opens on the contract's clients together — the "grouped total" the
  // report is for — rather than on every client in AroFlo. The shell holds
  // this tab back until the config has loaded, so it is here to read.
  const [view, setView] = useState(() => encodeClients(config ? Object.keys(config.targetClients) : [], 'overall'));
  const [dateFrom, setDateFrom] = useState(firstOfMonth());
  const [dateTo, setDateTo] = useState(todayStr());
  const [data, setData] = useState<ReportingKpisResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const effectiveDateFrom = dateFrom > dateTo ? dateTo : dateFrom;
  const effectiveDateTo = dateTo;

  useEffect(() => {
    fetchReportingKpis(effectiveDateFrom, effectiveDateTo, view)
      .then((res) => {
        setData(res);
        setLoadError(null);
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

  // The same three groups as every other dashboard: each contract client,
  // and every other company taken together.
  const clientOptions = useMemo(() => clientGroupOptions(config ? config.targetClients : {}), [config]);

  // What the current client filter is called, in messages and exports.
  const viewLabel =
    selectedClients.length === 0
      ? ALL_CLIENTS
      : selectedClients.map((c) => clientOptions.find((o) => o.value === c)?.label ?? c).join(' + ');

  const isSahaView = config
    ? view === Object.keys(config.targetClients).find((k) => config.targetClients[k] === 'SAHA')
    : false;
  // How a level is headed on its tab, row or bar. "P4/P5" when the P4 group
  // here holds AP5 jobs (the server says); and in SAHA's own wording when
  // SAHA alone is picked — "AP4/AP5".
  const levelLabels = data?.meta.levelLabels;
  const headed = (level: string): string => {
    const base = levelLabel(level, levelLabels);
    return isSahaView && level !== 'PM'
      ? base
          .split('/')
          .map((part) => `A${part}`)
          .join('/')
      : base;
  };
  // The comparison needs both sides: everyone, or a pick that includes every
  // target client.
  const targetNames = config ? Object.keys(config.targetClients) : [];
  const showClientComparison =
    targetNames.length > 0 && (selectedClients.length === 0 || targetNames.every((n) => selectedClients.includes(n)));

  const complianceRows: ComplianceRow[] = data?.priorityCompliance || [];
  const compliant = complianceRows.filter((r) => r.status === 'Met').length;
  const belowTarget = complianceRows.filter((r) => r.status === 'Below Target').length;
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
    // As AroFlo names it: one level's table can hold more than one (P4, AP4, AP5).
    { key: 'priorityName', label: 'Priority', filter: 'choice' },
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
            SAHA’s contract calls its priorities AP1–AP5: the same urgency levels as Ventia’s P1–P4, with AP5 counted
            alongside AP4.
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
            label={headed}
            renderTab={(priority) => {
              const rowsForPriority = rows.filter((r) => r.priority === priority);
              if (rowsForPriority.length === 0) {
                return (
                  <p className="text-[13px] p-4" style={{ color: palette.inkMuted }}>
                    No work orders found for priority {headed(priority)} in this selection.
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
                    downloadName={`${sectionKey === 'breakdown' ? 'work orders' : 'preventative maintenance'} ${priority}`}
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

  // Everything a downloaded report is built from: this page's figures, the
  // Overdue & Ageing section (which loads separately, so it is fetched again
  // here — a report without it is still a report), and the notes that say
  // what the figures cover.
  // The report's tables with the person's on-screen edits (the pencil) put
  // in: a table they have edited goes into the Excel and PDF as edited —
  // rows added, cells changed, columns added — and the rest as loaded. The
  // General Statistics figures are never editable, so never changed.
  async function withEdits(loaded: ReportingKpisResponse) {
    type Saved = { rows: Record<string, string | number | null>[]; extraCols?: string[]; edited?: boolean };
    // Only a real edit counts — see EditableTable on older saved snapshots.
    const saved = (key: string) =>
      loadDashboardEdit<Saved>(key, scope)
        .then((s) => (s && s.edited ? s : null))
        .catch(() => null);
    const edited: string[] = [];
    const extraColumns: string[] = [];

    const section = async (rows: BreakdownRow[], levels: string[], sectionKey: string): Promise<BreakdownRow[]> => {
      const out: BreakdownRow[] = [];
      for (const level of levels) {
        const edit = await saved(`${sectionKey}_${level}`);
        if (!edit) {
          out.push(...sortedRows(rows.filter((r) => r.priority === level)));
          continue;
        }
        edited.push(`${headed(level)} work orders`);
        for (const column of edit.extraCols ?? []) if (!extraColumns.includes(column)) extraColumns.push(column);
        out.push(...edit.rows.map((r) => ({ ...(r as unknown as BreakdownRow), priority: level })));
      }
      return out;
    };

    const complianceEdit = await saved('compliance');
    if (complianceEdit) edited.push('Target KPI Compliance');
    // An edited cell is text; where it isn't a number the loaded figure stands.
    const number = (value: unknown, fallback: number) => {
      const n = parseFloat(String(value));
      return Number.isFinite(n) ? n : fallback;
    };
    // A percentage cell left as "—" (nothing decided yet) stays empty.
    const percent = (value: unknown, fallback: number | null) => {
      const n = parseFloat(String(value));
      return Number.isFinite(n) ? n : fallback;
    };
    const priorityCompliance: ComplianceRow[] = complianceEdit
      ? complianceEdit.rows.map((r, i) => {
          const was = loaded.priorityCompliance[i];
          return {
            priority: String(r.priority ?? was?.priority ?? ''),
            total: was?.total ?? 0,
            onTime: number(r.onTime, was?.onTime ?? 0),
            late: number(r.late, was?.late ?? 0),
            inProgress: number(r.inProgress, was?.inProgress ?? 0),
            actualPercent: percent(r.actual, was?.actualPercent ?? null),
            targetPercent: number(r.target, was?.targetPercent ?? 0),
            variancePp: percent(r.variance, was?.variancePp ?? null),
            status: String(r.status ?? was?.status ?? '') as ComplianceRow['status'],
          };
        })
      : loaded.priorityCompliance.map((r) => ({ ...r, priority: levelLabel(r.priority, levelLabels) }));

    return {
      data: {
        ...loaded,
        priorityCompliance,
        breakdown: await section(loaded.breakdown, BREAKDOWN_PRIORITIES, 'breakdown'),
        pmBreakdown: await section(loaded.pmBreakdown, PM_PRIORITIES, 'pm'),
      },
      edited,
      extraColumns,
    };
  }

  async function reportParts() {
    if (!data) throw new Error('nothing is loaded yet');
    // The reports print this in their title and file name. One client or
    // everyone reads as it always has; several get their names.
    const reportView = selectedClients.length > 1 ? viewLabel : view;
    const overdue = await fetchOverdueAgeing(view).catch(() => null);
    const report = await withEdits(data);
    const notes = [
      coverageFrom
        ? `Period covered: only work orders requested since ${formatCoverage(coverageFrom)} are loaded; anything older is in no figure here.`
        : 'Period covered: only recently requested work orders are loaded.',
      'Issued, Completed, Outstanding and Overdue count work orders requested in the date range. Completed means the status is now Completed or Archived.',
      'Late / overdue: finished after its due date, or still open past it, judged by day (finished at any time on the due date is on time).',
      'Overdue rate is given both ways: of the work orders issued, and of the work orders completed.',
      'Target KPI Compliance: on time / (on time + late) for each priority. A work order that is open and not yet due is "in progress" - counted on its own, and in neither side of the percentage.',
      'Priorities: AP1-AP4 are counted with P1-P4, and AP5 with P4.',
      'Delay Reason: late jobs only - the current substatus, or else a keyword match in the job notes, marked (from notes). A delay reason does not make a job on time.',
      `Dates and "today" are ${zoneName()} time.`,
      report.edited.length
        ? `Includes the edits made on screen to: ${report.edited.join(', ')}. General Statistics are always the figures as loaded.`
        : 'No table had been edited on screen when this was built.',
      'Sorting or filtering a table on screen changes nothing here: every row is listed.',
    ];
    return {
      data: report.data,
      extraColumns: report.extraColumns,
      dateFrom: effectiveDateFrom,
      dateTo: effectiveDateTo,
      view: reportView,
      overdue,
      notes,
    };
  }
  const downloads = (
    <ReportDownloads
      palette={palette}
      disabled={!data || notLoaded}
      excel={async () => buildExcelReport(await reportParts())}
      pdf={async () => buildPdfReport({ ...(await reportParts()), palette })}
      what="Statistics, compliance, the breakdown tables and the overdue list, for the clients and dates chosen."
    />
  );

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
      {downloads}
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
            <b>Completion rate</b> — completed ÷ issued. <b>Overdue rate</b> is given both ways: overdue ÷ issued, and
            overdue ÷ completed. The second can pass 100% while few of the range’s jobs are finished.
          </li>
          <li>
            <b>Target KPI Compliance</b> — for each priority, on time ÷ (on time + late), against the target
            {config
              ? ` (${Object.entries(config.priorityTargets)
                  .map(([level, target]) => `${level} ${target}%`)
                  .join(', ')})`
              : ''}
            . A work order that is open and not yet due is <b>in progress</b>: counted in its own column, and in neither
            side of the percentage. A priority with nothing finished or overdue yet has no percentage.
          </li>
          <li>
            <b>Against the KPI Matrix.</b> The same sum on the same jobs: for the same clients and month, a priority’s
            Actual % here is its Completed row’s On time % there, and Late and In progress are the same counts. The Matrix
            also scores whether a job was started in time, which this page does not.
          </li>
          <li>
            <b>Priorities.</b> Used as AroFlo names them. AP1–AP4 are counted with P1–P4, and AP5 with P4 — a group that
            holds AP5 jobs is headed P4/P5. Each table’s Priority column shows the job’s own. A work order with any other
            priority, or none, is in General Statistics but not in the priority sections.
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
            together. Tick either on its own, or Projects / Other for every other company taken together; with nothing
            ticked it is everyone.
          </li>
          <li>
            <b>How fresh.</b> As of the time in the bar at the top. Nothing updates until someone presses Refresh.
          </li>
          <li>
            <b>Whose clock.</b> {zoneName()} time. “Today” — what is overdue, how many days late, where this month starts —
            and every date and time on the page are {zoneName()}’s, wherever the page is opened from.
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
            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
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
              {/* The overdue rate both ways, each saying which: of the jobs
                  issued, and of the jobs completed. The second passes 100%
                  while few of the period's jobs are finished. */}
              {data.summary.overdueRateOfIssued !== undefined && (
                <KpiCard
                  label="Overdue Rate"
                  value={`${data.summary.overdueRateOfIssued.toFixed(1)}%`}
                  pillText="of issued"
                  level={rateLevel(data.summary.overdueRateOfIssued, 10, 25, false)}
                  palette={palette}
                />
              )}
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
              For each priority: how many work orders were on time, how many are late, and how many are still in progress
              (open and not yet due). Actual % is on time ÷ (on time + late) — work still in progress is counted on its own
              and is in neither — against the agreed target. Click the pencil to edit.
            </p>
            {complianceRows.length === 0 ? (
              <div
                className="rounded-md p-4 text-[13px]"
                style={{ background: 'rgba(2,132,199,0.08)', color: palette.inkSecondary, border: `1px solid ${palette.border}` }}
              >
                No work orders in a priority with a defined KPI target for this selection.
                {data && !data.meta.priorityCodeMapConfigured && (
                  <> Priority levels are not set up for this AroFlo account yet — ask whoever looks after this app.</>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
                <div className="xl:col-span-3 space-y-2">
                  <EditableTable
                    stateKey="compliance"
                    scope={scope}
                    palette={palette}
                    striped={striped}
                    columns={[
                      { key: 'priority', label: 'Priority' },
                      { key: 'onTime', label: 'On time', align: 'right' },
                      { key: 'late', label: 'Late', align: 'right' },
                      { key: 'inProgress', label: 'In progress', align: 'right' },
                      { key: 'actual', label: 'Actual %', align: 'right' },
                      { key: 'target', label: 'Target %', align: 'right' },
                      { key: 'variance', label: 'Variance (pp)', align: 'right' },
                      { key: 'status', label: 'Status' },
                    ]}
                    defaultRows={complianceRows.map((r) => ({
                      priority: levelLabel(r.priority, levelLabels),
                      onTime: r.onTime ?? '',
                      late: r.late ?? '',
                      inProgress: r.inProgress ?? '',
                      // No percentage until something is finished or overdue.
                      actual: r.actualPercent === null ? '—' : r.actualPercent.toFixed(1),
                      target: r.targetPercent.toFixed(0),
                      variance: r.variancePp === null ? '—' : `${r.variancePp >= 0 ? '+' : ''}${r.variancePp.toFixed(1)}`,
                      status: r.status,
                    }))}
                    cellStyle={(colKey, row) => {
                      if (colKey === 'variance') {
                        const v = parseFloat(String(row.variance));
                        if (!Number.isFinite(v)) return { color: palette.inkMuted };
                        return v >= 0
                          ? { color: palette.statusGood, background: 'rgba(5,150,105,0.08)' }
                          : { color: palette.statusCritical, background: 'rgba(220,38,38,0.10)' };
                      }
                      if (colKey === 'late') return Number(row.late) > 0 ? { color: palette.statusCritical, fontWeight: 700 } : undefined;
                      if (colKey === 'status') {
                        if (row.status === 'Met') return { color: palette.statusGood, fontWeight: 700 };
                        if (row.status === 'In progress') return { color: palette.inkMuted, fontWeight: 700 };
                        return { color: palette.statusCritical, fontWeight: 700 };
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
                      <span style={{ color: belowTarget > 0 ? palette.statusCritical : palette.statusGood }}>
                        Below Target <b>{belowTarget}</b>
                      </span>
                      {complianceRows.length - compliant - belowTarget > 0 && (
                        <span style={{ color: palette.inkMuted }}>
                          Nothing decided yet <b>{complianceRows.length - compliant - belowTarget}</b>
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="xl:col-span-2">
                  <ComplianceChart rows={complianceRows} palette={palette} stateKey="compliance_chart" scope={scope} labels={levelLabels} />
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
              <PriorityChart tasks={data.tasks} palette={palette} stateKey="chart_priority" scope={scope} labels={levelLabels} />
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
            'Preventative Maintenance (PM)',
            PM_PRIORITIES,
            data.pmBreakdown,
            'pm',
            'No PM work orders in this selection.',
          )}

          {/* Export */}
          <div>
            <h2 className={SECTION_H2} style={{ borderBottom: `1px solid ${palette.border}`, color: palette.inkPrimary }}>
              Download report
            </h2>
            {/* What is in the files, said plainly. (This used to say the
                reports include on-screen edits; they never did.) */}
            <p className="text-[12px] mb-3" style={{ color: palette.inkMuted }}>
              The Excel and PDF reports cover the current selection ({formatDisplayDate(effectiveDateFrom)} –{' '}
              {formatDisplayDate(effectiveDateTo)} · {viewLabel}): General Statistics, Target KPI Compliance, both
              breakdown tables in full, and the Overdue &amp; Ageing list — plus the charts in the PDF. A table you have
              edited with the pencil goes in as you edited it, and the report’s notes say which. Sorting or filtering a
              table changes nothing in the reports; to save one table exactly as it is showing, use <b>Download CSV</b>{' '}
              above it.
            </p>
            {downloads}
          </div>
        </>
      )}

      <p className="text-[11px] pt-2" style={{ color: palette.inkMuted, borderTop: `1px solid ${palette.border}` }}>
        Source: AroFlo API
        {data?.meta.lastFetchedAt ? ` · data as of ${formatDisplayDate(dayOfInstant(data.meta.lastFetchedAt))}` : ''} ·{' '}
        {formatDisplayDate(effectiveDateFrom)} – {formatDisplayDate(effectiveDateTo)} · Generated {formatDisplayDate(todayStr())}
      </p>
    </div>
  );
};

const PriorityTabs: React.FC<{ priorities: string[]; label: (p: string) => string; renderTab: (p: string) => React.ReactNode }> = ({
  priorities,
  label,
  renderTab,
}) => {
  const [active, setActive] = useState(priorities[0]);
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
