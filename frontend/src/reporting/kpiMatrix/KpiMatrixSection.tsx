import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Plot, baseLayout, PLOT_CONFIG } from '../plotly';
import { Palette } from '../theme';
import {
  ASSUMPTIONS,
  CAPTION,
  ISSUES_FORM_NAME,
  JSA_NAME,
  KpiDef,
  Metric,
  TIER_WINDOW_LABEL,
  TIERS,
  Tier,
} from './config';
import { buildDataset, buildDatasetFromRows, Diagnostics, KpiTaskRow } from './ingest';
import { computeKpis, KpiResult, LateJob, lateJobs, matrixCells, reconcile } from './engine';
import { buildKpiMatrixPdf, buildKpiMatrixWorkbook, MatrixReportMeta } from './exportMatrix';
import { ReportDownloads } from '../components/ReportDownloads';
import { fetchLiveKpiRows, LIVE_CLIENT_COLUMN, LiveKpiRows } from '../../services/reportingKpiMatrix';
import { LateRuleNote } from '../components/LateRuleNote';
import { clientGroupOf, clientGroupOptions } from '../components/ClientMultiSelect';
import { formatInstant, today, zonedNow, zoneName } from '../time';
import { ariaSort, ColumnHeading, ControlColumn, ControlSummary, DownloadCsv, NoMatches, useTableControls } from '../components/tableControls';
import { ClientMultiSelect } from '../components/ClientMultiSelect';
import { formatCoverage } from '../../services/reportingRefresh';

const CSV_KEY = 'kpi-matrix-csv';
const NAME_KEY = 'kpi-matrix-filename';
const MAX_PERSIST = 3_000_000; // chars

// The matrix reads live work orders from AroFlo unless a CSV export has been
// uploaded, which then takes over until it is cleared. Three KPIs need data
// AroFlo's API doesn't expose — a task's invoice date, checklists, compliance
// forms — so with live data those rows are left blank, with a note that only
// an uploaded export fills them, instead of scoring every job a failure for
// something it was never given (confirmed 2026-10-13).
const LIVE_UNMEASURED: Set<Metric> = new Set(['invoice', 'jsa', 'issues']);
const UPLOAD_ONLY_NOTE = 'Filled only when a CSV export is uploaded';

function unmeasured(def: KpiDef): KpiResult {
  return {
    def,
    uploadOnly: true,
    count: 0,
    total: 0,
    ontimeCount: null,
    ontimePool: null,
    comment: UPLOAD_ONLY_NOTE,
    failCount: 0,
    ontimeFailCount: null,
    completionPct: null,
    ontimePct: null,
    scorePct: null,
    late: 0,
    measurable: false,
    met: false,
  };
}

const LIVE_CAPTION =
  'On time % is out of the jobs whose outcome is known; the ones still in progress are counted on their own. ' +
  'A job still open past its due date counts as late. ' +
  'Commenced is read from each job’s status and substatus. Contributing factors are conditions ' +
  'present on the job, not confirmed causes of delay.';

const LIVE_ASSUMPTIONS = [
  'Tiers come from AroFlo’s own priority names: AP1–AP4 count with P1–P4, and AP5 with P4 (the same 30-day window) — the P4 rows are headed P4/P5 when there are AP5 jobs in them. A priority with no level in its name is left out of the tiered rows.',
  'Completed rows: a job is late if it was finished after the due date, or still open past it — the due date on the job in AroFlo is the deadline, judged by day (finished any time on the due date is on time). On time % is on time ÷ (on time + late). A job that is open and not yet due is In progress: counted in its own column, and in neither side of the percentage.',
  'For the same clients and month, a Completed row’s On time %, Late and In progress are that priority’s figures under Target KPI Compliance on the Work Orders page.',
  'Commenced rows go by the job’s status and substatus, which say where a job is now, not when it got there. A job counts as started if it is finished, In Progress, or its substatus is Materials Ordered, On Hold/Materials Required, Sent to Procurement, Non Access, Ready for Invoicing, To be Reviewed, Re-book or Job Cancelled. A job is late to start only if it has still not been started once its time limit has passed (P1 the same day if requested before 1 pm, otherwise the next day; P2 3 days; P3 14 days; P4/P5 and PM 30 days); a job not yet started inside its limit is In progress. Because nothing records when a job was started, one that has been started is not called late to start.',
  'Late jobs lists a job once, with what it was late for: finishing (its due date), or only starting (its time limit to be started).',
  'KPIs 12–14 are left blank: AroFlo’s API does not link an invoice to its work order, or expose checklists and compliance forms. They are filled only when a CSV export is uploaded.',
];

function loadPersisted(): { csv: string; name: string } | null {
  try {
    const csv = localStorage.getItem(CSV_KEY);
    if (!csv) return null;
    return { csv, name: localStorage.getItem(NAME_KEY) || 'saved upload' };
  } catch {
    return null;
  }
}

function fmtDate(d: Date | null): string {
  if (!d) return '';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// The Late jobs table's columns, as its headings sort and filter them
// (components/tableControls.tsx). Text is what the cell shows. Category has
// its own picker above the table, so it only sorts here.
const LATE_COLUMNS: ControlColumn<LateJob>[] = [
  { key: 'job', label: 'Job', text: (j) => j.jobNumber },
  { key: 'task', label: 'Task', text: (j) => j.task },
  // A late job whose priority has no level on the scale is in no tier.
  { key: 'tier', label: 'Tier', filter: 'choice', text: (j) => j.tier || '—' },
  { key: 'requested', label: 'Requested', text: (j) => fmtDate(j.requested), sortValue: (j) => j.requested?.getTime() },
  { key: 'completed', label: 'Completed', text: (j) => (j.completed ? fmtDate(j.completed) : 'still open'), sortValue: (j) => j.completed?.getTime() },
  { key: 'days', label: 'Days late', filter: 'number', align: 'right', text: (j) => String(j.daysLate), sortValue: (j) => j.daysLate },
  // Which deadline was missed: the due date, or only the time limit to start.
  { key: 'lateFor', label: 'Late for', filter: 'choice', text: (j) => LATE_FOR[j.lateFor] },
  { key: 'category', label: 'Category', filter: 'none', text: (j) => j.category },
];
const LATE_FOR: Record<LateJob['lateFor'], string> = { finishing: 'Finishing', starting: 'Starting' };

interface Props {
  palette: Palette;
  striped: boolean;
  // Changes when the server has re-read AroFlo (the page's Refresh button);
  // the work orders are fetched again.
  dataVersion?: number;
  // The first day the loaded data covers (YYYY/MM/DD), if known.
  coverageFrom?: string | null;
  // The contract's clients — { name in AroFlo: short label } — which is who
  // this SLA template is for. The page opens on them together; each can be
  // ticked alone, and every other company is one more group.
  targetClients?: Record<string, string>;
}

const NO_TARGET_CLIENTS: Record<string, string> = {};

export const KpiMatrixSection: React.FC<Props> = ({
  palette,
  striped,
  dataVersion = 0,
  coverageFrom = null,
  targetClients = NO_TARGET_CLIENTS,
}) => {
  const persisted = useMemo(loadPersisted, []);
  const [csvText, setCsvText] = useState<string | null>(persisted?.csv ?? null);
  const [fileName, setFileName] = useState<string | null>(persisted?.name ?? null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [monthFilter, setMonthFilter] = useState<string>('__recent__');
  const [tierFilter, setTierFilter] = useState<Set<Tier>>(new Set(TIERS));
  const [catFilter, setCatFilter] = useState<string>('__all__');
  const [loadedAt, setLoadedAt] = useState<Date | null>(persisted ? new Date() : null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [live, setLive] = useState<LiveKpiRows | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  // Client groups to show, live mode only: the same three as every other
  // dashboard. Empty means everyone; null means nobody has picked yet, so it
  // is the contract's clients together.
  const [pickedClients, setClientFilter] = useState<string[] | null>(null);
  const clientOptions = useMemo(() => clientGroupOptions(targetClients), [targetClients]);
  const clientFilter = pickedClients ?? Object.keys(targetClients);
  const fileRef = useRef<HTMLInputElement>(null);

  const isLive = !csvText;

  // Re-derived on every refresh so "overdue" / invoice-maturity checks use a
  // current clock, and every downstream useMemo recomputes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // Now on the clock in Adelaide (../time): the dates in the rows are read
  // as written, so "is it past its due date?" has to be asked the same way —
  // not against the browser's own clock, which may be in another zone.
  const now = useMemo(() => zonedNow(), [reloadNonce, dataVersion]);

  // AroFlo's work orders as the server holds them, whenever no CSV is
  // standing in for them. Fetched again when a refresh from AroFlo finishes.
  useEffect(() => {
    if (!isLive) return;
    let stale = false;
    fetchLiveKpiRows()
      .then((res) => {
        if (stale) return;
        setLive(res);
        setLiveError(null);
      })
      .catch((e) => {
        if (!stale) setLiveError(e instanceof Error ? e.message : 'Could not load work orders');
      });
    return () => {
      stale = true;
    };
  }, [isLive, dataVersion]);

  // Keyed on the names, not the array: the default arrives as a new array
  // each render.
  const clientKey = clientFilter.join('||');
  const activeClients = useMemo(
    () => clientFilter.filter((c) => clientOptions.some((o) => o.value === c)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [clientKey, clientOptions],
  );
  // A row is in when its client's group is ticked — or nothing is.
  const inPickedClients = useMemo(
    () => (r: { [key: string]: string }) =>
      activeClients.length === 0 || activeClients.includes(clientGroupOf(r[LIVE_CLIENT_COLUMN], targetClients)),
    [activeClients, targetClients],
  );
  // What the pick is called, on the downloaded reports.
  const clientsLabel = activeClients.length
    ? activeClients.map((c) => clientOptions.find((o) => o.value === c)?.label ?? c).join(' + ')
    : 'All clients';

  // The picked clients' work orders that arrived from AroFlo with the
  // priority field empty — listed at the bottom of the page.
  const noPriorityRows = useMemo(() => (live?.rows ?? []).filter((r) => !r.Priority && inPickedClients(r)), [live, inPickedClients]);

  function resetFilters() {
    setMonthFilter('__recent__');
    setTierFilter(new Set(TIERS));
    setCatFilter('__all__');
  }

  const parsed = useMemo(() => {
    try {
      if (csvText) return buildDataset(csvText, now);
      if (!live) return null;
      // Live data: whether a job has been started is read from its status
      // and substatus, not from a start date (see ingest's DatasetOptions).
      return buildDatasetFromRows(live.headers, live.rows.filter(inPickedClients), now, { commenced: 'substatus' });
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Failed to parse CSV' } as { error: string };
    }
  }, [csvText, live, inPickedClients, now]);

  const dataset = parsed && !('error' in parsed) ? parsed : null;
  const datasetError = parsed && 'error' in parsed ? parsed.error : null;

  const months = useMemo(() => {
    if (!dataset) return [];
    return [...new Set(dataset.rows.map((r) => r.period).filter(Boolean) as string[])].sort();
  }, [dataset]);

  const resolvedMonth = useMemo(() => {
    if (monthFilter !== '__recent__') return monthFilter;
    if (!dataset) return '__all__';
    const evaluable = dataset.rows.filter((r) => r.taskEvaluable && r.period);
    if (evaluable.length) return [...new Set(evaluable.map((r) => r.period as string))].sort().slice(-1)[0];
    return months.length ? months[months.length - 1] : '__all__';
  }, [monthFilter, dataset, months]);

  const filteredRows: KpiTaskRow[] = useMemo(() => {
    if (!dataset) return [];
    return dataset.rows.filter((r) => {
      if (resolvedMonth !== '__all__' && r.period !== resolvedMonth) return false;
      if (r.tier && !tierFilter.has(r.tier)) return false; // keep null-tier rows for KPIs 11-14
      return true;
    });
  }, [dataset, resolvedMonth, tierFilter]);

  const results = useMemo(() => {
    const all = computeKpis(filteredRows, now);
    return isLive ? all.map((r) => (LIVE_UNMEASURED.has(r.def.metric) ? unmeasured(r.def) : r)) : all;
  }, [filteredRows, now, isLive]);
  const problems = useMemo(
    () => reconcile(filteredRows, isLive ? results.filter((r) => !LIVE_UNMEASURED.has(r.def.metric)) : results, now),
    [filteredRows, results, now, isLive],
  );
  // "P4/P5" where the P4 tier here holds level-5 (AP5) jobs. The tier is the
  // same either way — this is only how it is headed, on the rows, the chart,
  // the tier buttons, the late jobs and the downloaded reports.
  const hasLevel5 = useMemo(
    () => filteredRows.some((r) => r.tier === 'P4' && /^(?:A?P|Priority(?:\s+Level)?)\s*5(?!\d)/i.test(r.priority)),
    [filteredRows],
  );
  const tierName = (tier: string) => (tier === 'P4' && hasLevel5 ? 'P4/P5' : tier);
  const shownResults = useMemo(
    () => results.map((r) => (r.def.tier === 'P4' && hasLevel5 ? { ...r, def: { ...r.def, name: r.def.name.replace(/^P4\b/, 'P4/P5') } } : r)),
    [results, hasLevel5],
  );
  const late = useMemo(
    () => lateJobs(filteredRows, now, { byDay: isLive }).map((j) => (j.tier === 'P4' && hasLevel5 ? { ...j, tier: 'P4/P5' } : j)),
    [filteredRows, now, hasLevel5, isLive],
  );

  const lateCats = useMemo(() => [...new Set(late.map((j) => j.category))].sort(), [late]);
  const shownLate = catFilter === '__all__' ? late : late.filter((j) => j.category === catFilter);
  // Sorting and a filter per column, for looking through the list. The
  // Category picker above it is the one that also decides what the Excel
  // export lists; these don't.
  const lateControls = useTableControls(shownLate, LATE_COLUMNS);

  async function onFile(file: File) {
    setParseError(null);
    try {
      const text = await file.text();
      setCsvText(text);
      setFileName(file.name);
      setLoadedAt(new Date());
      resetFilters(); // a new file shouldn't be hidden by a stale month/tier pick
      setReloadNonce((n) => n + 1);
      try {
        if (text.length <= MAX_PERSIST) {
          localStorage.setItem(CSV_KEY, text);
          localStorage.setItem(NAME_KEY, file.name);
        } else {
          localStorage.removeItem(CSV_KEY);
        }
      } catch {
        /* quota — keep in memory only */
      }
    } catch (e) {
      setParseError(e instanceof Error ? e.message : 'Could not read file');
    }
  }

  // Re-read whatever is in localStorage (e.g. saved from another tab), reset
  // filters, and refresh the clock. To load an *edited* file you must re-pick
  // it with "Replace CSV" — the browser can't re-read a file from disk on its own.
  function refreshData() {
    const p = loadPersisted();
    if (p) {
      setCsvText(p.csv);
      setFileName(p.name);
    }
    setLoadedAt(new Date());
    resetFilters();
    setReloadNonce((n) => n + 1);
  }

  // Dropping the upload hands the matrix back to live AroFlo data.
  function clearUpload() {
    setCsvText(null);
    setFileName(null);
    setLoadedAt(null);
    resetFilters();
    try {
      localStorage.removeItem(CSV_KEY);
      localStorage.removeItem(NAME_KEY);
    } catch {
      /* noop */
    }
  }

  // What a downloaded matrix report says about itself: the month, whose work
  // orders, and how the figures are worked out.
  function reportMeta(): MatrixReportMeta {
    return {
      months: resolvedMonth === '__all__' ? 'all' : resolvedMonth,
      generated: today(),
      scope: isLive ? clientsLabel : `Uploaded file: ${fileName ?? 'CSV'}`,
      notes: [
        ...(isLive && coverageFrom ? [`Only work orders requested since ${formatCoverage(coverageFrom)} are loaded.`] : []),
        'A work order belongs to the month it was requested in.',
        ...(isLive ? LIVE_ASSUMPTIONS : ASSUMPTIONS),
        `Dates and "today" are ${zoneName()} time.`,
        ...(catFilter === '__all__' ? [] : [`Late jobs listed: category "${catFilter}" only.`]),
      ],
    };
  }

  const cardStyle: React.CSSProperties = { background: palette.surface, border: `1px solid ${palette.border}` };
  const outlineButton: React.CSSProperties = { border: `1px solid ${palette.border}`, color: palette.inkPrimary };
  const liveEmpty = isLive && live !== null && live.rows.length === 0;

  return (
    <div>
      {/* No heading of its own: the page is headed "KPI Matrix" already. */}
      <p className="text-[12px] mb-3" style={{ color: palette.inkMuted }}>
        {isLive ? LIVE_CAPTION : CAPTION}
      </p>

      {/* Data source — live AroFlo work orders, or an uploaded CSV export */}
      <div className="rounded-md p-4 mb-4 flex flex-wrap items-center gap-3" style={cardStyle}>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = '';
          }}
        />
        {isLive && (
          <>
            <span className="text-[12px] font-semibold" style={{ color: palette.inkPrimary }}>
              From AroFlo
            </span>
            {live && (
              <span className="text-[12px]" style={{ color: palette.inkSecondary }}>
                {live.rows.length.toLocaleString()} work orders
              </span>
            )}
            <div className="text-[12px] inline-flex items-center gap-2" style={{ color: palette.inkSecondary }}>
              Client
              <div style={{ width: 240 }}>
                <ClientMultiSelect palette={palette} options={clientOptions} selected={activeClients} onChange={setClientFilter} />
              </div>
            </div>
          </>
        )}
        <button
          onClick={() => fileRef.current?.click()}
          className="px-3 py-1.5 rounded-md text-[12px] font-semibold"
          style={isLive ? outlineButton : { background: palette.accentBlue, color: '#fff' }}
        >
          {csvText ? 'Replace CSV' : 'Upload a CSV instead'}
        </button>
        {csvText && (
          <button
            onClick={refreshData}
            className="px-3 py-1.5 rounded-md text-[12px] font-semibold inline-flex items-center gap-1"
            style={outlineButton}
            title="Re-parse the current file and reset filters"
          >
            <span className="material-symbols-outlined text-[16px]">refresh</span>
            Refresh data
          </button>
        )}
        {fileName && (
          <>
            <span className="text-[12px]" style={{ color: palette.inkSecondary }}>
              {fileName}
              {loadedAt && (
                <span style={{ color: palette.inkMuted }}> · loaded {formatInstant(loadedAt.toISOString())}</span>
              )}
            </span>
            <button onClick={clearUpload} className="text-[12px] underline" style={{ color: palette.inkMuted }}>
              clear — back to AroFlo data
            </button>
          </>
        )}
        {isLive ? (
          <span className="text-[12px] w-full" style={{ color: palette.inkMuted }}>
            Read straight from AroFlo — no upload needed. KPIs 12–14 need invoice, checklist and compliance-form data
            the AroFlo API doesn’t expose; to measure those, upload the AroFlo task export (the 20-column one, with the
            Description column).
          </span>
        ) : (
          <span className="text-[12px] w-full" style={{ color: palette.inkMuted }}>
            Showing the uploaded file instead of AroFlo data. Edited the file? Re-pick it with <b>Replace CSV</b> —
            the browser can’t re-read a file from disk on its own.
          </span>
        )}
      </div>

      {parseError && (
        <p className="text-[12px] mb-3" style={{ color: palette.statusCritical }}>
          {parseError}
        </p>
      )}
      {datasetError && (
        <p className="text-[12px] mb-3" style={{ color: palette.statusCritical }}>
          {datasetError}
        </p>
      )}
      {isLive && liveError && (
        <p className="text-[12px] mb-3" style={{ color: palette.statusCritical }}>
          Could not load work orders from the server: {liveError}
        </p>
      )}
      {/* A failed AroFlo refresh is reported by the bar at the top of the page. */}
      {isLive && !live && !liveError && (
        <p className="text-[13px] mb-3" style={{ color: palette.inkMuted }}>
          Loading work orders…
        </p>
      )}
      {liveEmpty && (
        <p className="text-[13px] mb-3" style={{ color: palette.inkMuted }}>
          No work orders are loaded yet. Press <b>Refresh from AroFlo</b> at the top of the page, or upload a CSV export.
        </p>
      )}

      {dataset && !liveEmpty && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-end gap-4 mb-4">
            <label className="flex flex-col gap-1 text-[12px]" style={{ color: palette.inkSecondary }}>
              Month
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="px-2 py-1.5 rounded-md text-[13px]"
                style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
              >
                <option value="__recent__">Most recent with data ({resolvedMonth})</option>
                <option value="__all__">All months</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-1 text-[12px]" style={{ color: palette.inkSecondary }}>
              Tier
              <div className="flex gap-1">
                {TIERS.map((t) => {
                  const on = tierFilter.has(t);
                  return (
                    <button
                      key={t}
                      onClick={() =>
                        setTierFilter((prev) => {
                          const next = new Set(prev);
                          if (next.has(t)) next.delete(t);
                          else next.add(t);
                          return next;
                        })
                      }
                      className="px-2 py-1 rounded-md text-[11px] font-semibold"
                      style={{
                        background: on ? palette.accentBlue : palette.surface,
                        color: on ? '#fff' : palette.inkPrimary,
                        border: `1px solid ${palette.border}`,
                      }}
                    >
                      {tierName(t)}
                    </button>
                  );
                })}
              </div>
            </div>
            <ReportDownloads
              palette={palette}
              excel={() => buildKpiMatrixWorkbook(shownResults, shownLate, reportMeta())}
              pdf={() => buildKpiMatrixPdf(shownResults, shownLate, reportMeta())}
            />
            <button
              onClick={() => setShowDiag((v) => !v)}
              className="px-3 py-1.5 rounded-md text-[12px] font-semibold"
              style={{ border: `1px solid ${palette.border}`, color: palette.inkMuted }}
            >
              {showDiag ? 'Hide' : 'Show'} diagnostics
            </button>
          </div>

          {showDiag && <DiagnosticsPanel diag={dataset.diag} palette={palette} live={isLive} />}

          {problems.length > 0 && (
            <div
              className="rounded-md p-3 mb-4 text-[12px]"
              style={{ background: 'rgba(220,38,38,0.10)', color: palette.statusCritical }}
            >
              Reconciliation failures (counts disagree):
              <ul className="list-disc ml-5 mt-1">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mb-4">
            <LateRuleNote palette={palette} />
          </div>

          <MatrixTable results={shownResults} palette={palette} striped={striped} />

          {/* items-start: each chart is as tall as its own rows need. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4 items-start">
            <OnTimeChart results={shownResults} palette={palette} />
            <FactorsChart late={late} palette={palette} />
          </div>

          {/* Late jobs */}
          <div className="mt-4">
            <h3 className="text-[14px] font-semibold mb-2" style={{ color: palette.inkPrimary }}>
              Late jobs ({late.length})
            </h3>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
              <label className="text-[12px] inline-flex items-center gap-2" style={{ color: palette.inkSecondary }}>
                Category
                <select
                  value={catFilter}
                  onChange={(e) => setCatFilter(e.target.value)}
                  className="px-2 py-1 rounded-md text-[12px]"
                  style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
                >
                  <option value="__all__">All</option>
                  {lateCats.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              {shownLate.length > 0 && <ControlSummary controls={lateControls} palette={palette} noun="late jobs" />}
              {shownLate.length > 0 && <DownloadCsv controls={lateControls} palette={palette} name="late jobs" />}
            </div>
            <div className="overflow-auto rounded-md" style={{ background: palette.surface, border: `1px solid ${palette.border}`, maxHeight: 460 }}>
              <table className="w-full text-[12px]" style={{ color: palette.inkPrimary }}>
                <thead>
                  <tr>
                    {LATE_COLUMNS.map((c) => (
                      <th
                        key={c.key}
                        aria-sort={ariaSort(lateControls, c.key)}
                        className={`px-3 py-2 font-semibold sticky top-0 z-10 align-bottom ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                        style={{ color: palette.inkSecondary, background: palette.pagePlane }}
                      >
                        <ColumnHeading column={c} controls={lateControls} palette={palette} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shownLate.length === 0 && (
                    <tr>
                      <td colSpan={LATE_COLUMNS.length} className="px-3 py-3" style={{ color: palette.inkMuted }}>
                        No late jobs in this selection.
                      </td>
                    </tr>
                  )}
                  <NoMatches controls={lateControls} palette={palette} span={LATE_COLUMNS.length} />
                  {lateControls.rows.map((j, i) => (
                    <tr key={`${j.jobNumber}-${i}`} style={{ background: striped && i % 2 ? palette.pagePlane : 'transparent' }}>
                      <td className="px-3 py-1.5">{j.jobNumber}</td>
                      <td className="px-3 py-1.5">{j.task}</td>
                      <td className="px-3 py-1.5">{j.tier || '—'}</td>
                      <td className="px-3 py-1.5">{fmtDate(j.requested)}</td>
                      {/* Late without a completion date: open past its due date. */}
                      <td className="px-3 py-1.5" style={j.completed ? undefined : { color: palette.inkMuted }}>
                        {j.completed ? fmtDate(j.completed) : 'still open'}
                      </td>
                      <td className="px-3 py-1.5 text-right" style={{ color: palette.statusCritical, fontWeight: 700 }}>
                        {j.daysLate}
                      </td>
                      <td className="px-3 py-1.5">{LATE_FOR[j.lateFor]}</td>
                      <td className="px-3 py-1.5">{j.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Exactly what AroFlo's API sent for the jobs the reports call
              "No priority", so they can be looked up and compared in AroFlo. */}
          {isLive && noPriorityRows.length > 0 && (
            <details className="mt-4 text-[12px]" style={{ color: palette.inkSecondary }}>
              <summary className="cursor-pointer font-semibold">
                Work orders AroFlo sent with no priority ({noPriorityRows.length})
              </summary>
              <p className="mt-2 mb-2" style={{ color: palette.inkMuted }}>
                For each of these, the priority field in AroFlo’s API reply was empty. They are left out of the tiered rows
                above and show as “No priority” on the Work Orders page. Follows the client filter at the top.
              </p>
              <div className="overflow-auto rounded-md" style={{ background: palette.surface, border: `1px solid ${palette.border}`, maxHeight: 460 }}>
                <table className="w-full text-[12px]" style={{ color: palette.inkPrimary }}>
                  <thead>
                    <tr>
                      {['Job', 'Task', 'Client', 'Status', 'Requested', 'Priority from AroFlo'].map((h) => (
                        <th
                          key={h}
                          className="text-left px-3 py-2 font-semibold sticky top-0 z-10"
                          style={{ color: palette.inkSecondary, background: palette.pagePlane }}
                        >
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {noPriorityRows.map((r, i) => (
                      <tr key={`${r.Jobnumber}-${i}`} style={{ background: striped && i % 2 ? palette.pagePlane : 'transparent' }}>
                        <td className="px-3 py-1.5">{r.Jobnumber || '(no job number)'}</td>
                        <td className="px-3 py-1.5">{r.Task}</td>
                        <td className="px-3 py-1.5">{r[LIVE_CLIENT_COLUMN]}</td>
                        <td className="px-3 py-1.5">{r.Status}</td>
                        <td className="px-3 py-1.5">{r['Requested Date']}</td>
                        <td className="px-3 py-1.5" style={{ color: palette.inkMuted }}>
                          (empty)
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <details className="mt-4 text-[12px]" style={{ color: palette.inkSecondary }}>
            <summary className="cursor-pointer font-semibold">Assumptions &amp; known limitations</summary>
            <ul className="list-disc ml-5 mt-2 space-y-1">
              {isLive && (
                <li>
                  {coverageFrom
                    ? `Only work orders requested since ${formatCoverage(coverageFrom)} are loaded; anything older is not in the matrix.`
                    : 'Only recent work orders are loaded — the bar at the top says from when.'}{' '}
                  A work order belongs to the month it was requested in, and every month offered is loaded in full.
                </li>
              )}
              {isLive && (
                <li>
                  Opens on the contract clients together. Tick either on its own, or Projects / Other for every other
                  company taken together; with nothing ticked it is everyone.
                </li>
              )}
              {(isLive ? LIVE_ASSUMPTIONS : ASSUMPTIONS).map((a) => (
                <li key={a}>{a}</li>
              ))}
              <li>
                {zoneName()} time: whether a job is past its due date is judged against today in {zoneName()}, wherever
                the page is opened from.
              </li>
              <li>
                Categories are conditions present on the job, not confirmed causes of delay. The proper fix is a
                mandatory delay-reason field in AroFlo.
              </li>
              {!isLive && (
                <li>Completed-only exports make the “%” column read 100% by construction, not by performance.</li>
              )}
              {!isLive && (
                <li>A job in the file that is still open past its Task Due Date counts as late on its Completed row.</li>
              )}
            </ul>
          </details>
        </>
      )}
    </div>
  );
};

// --------------------------------------------------------------------------
// Sub-components
// --------------------------------------------------------------------------

// `live` drops the checks that only make sense for an uploaded export: its
// shape (completed-only / open-only), and the checklist / compliance-form
// names behind KPIs 13-14, which live data never carries.
const DiagnosticsPanel: React.FC<{ diag: Diagnostics; palette: Palette; live: boolean }> = ({ diag, palette, live }) => {
  const warn = (t: string) => (
    <p key={t} className="text-[12px]" style={{ color: palette.statusWarningText }}>
      ⚠ {t}
    </p>
  );
  return (
    <div className="rounded-md p-4 mb-4 space-y-1 text-[12px]" style={{ background: palette.pagePlane, border: `1px solid ${palette.border}`, color: palette.inkSecondary }}>
      <div>
        Rows loaded <b>{diag.rowsLoaded.toLocaleString()}</b> · after dedup <b>{diag.rowsAfterDedup.toLocaleString()}</b> ·
        duplicates removed <b>{diag.duplicatesRemoved}</b> ({diag.duplicateJobNumbers} duplicate job numbers)
      </div>
      <div>
        Rows with null tier <b>{diag.rowsNullTier}</b> · with a completion date <b>{diag.rowsWithCompletion}</b> · with a{' '}
        {live ? 'logged labour start' : 'schedule start'} <b>{diag.rowsWithScheduleStart}</b>
      </div>
      {diag.missingColumns.length > 0 && warn(`Missing expected columns: ${diag.missingColumns.join(', ')}`)}
      {diag.unmappedPriorities.length > 0 &&
        warn(
          live
            ? `AroFlo priorities with no level on the P-scale (give them one in KPI_PRIORITY_CODE_MAP_JSON): ${diag.unmappedPriorities.join(' | ')}`
            : `Unmapped Priority values (new AroFlo wording?): ${diag.unmappedPriorities.join(' | ')}`,
        )}
      {!diag.hasDescriptionColumn &&
        warn('No Description column — every row falls to "reason not recorded" and categorisation is disabled.')}
      {!live && (
        <>
          {diag.completedOnlyExport &&
            warn('Looks like a completed-tasks export (~100% have completions): "%" reads 100% by construction.')}
          {diag.looksOpenTasks && warn('Looks like an open-tasks export: most rows have no completion date.')}
          <div>
            Checklist Name values: <b>{diag.checklistNames.join(', ') || 'none'}</b>
          </div>
          <div>
            Compliance Form Name values: <b>{diag.complianceFormNames.join(', ') || 'none'}</b>
          </div>
          {diag.jsaNameMatches === 0 &&
            warn(`KPI 13 unmeasured: no Checklist Name equals "${JSA_NAME}" (fix JSA_NAME in config).`)}
          {diag.issuesNameMatches === 0 &&
            warn(`KPI 14 unmeasured: no Compliance Form Name equals "${ISSUES_FORM_NAME}" (fix ISSUES_FORM_NAME in config).`)}
        </>
      )}
    </div>
  );
};

const MatrixTable: React.FC<{ results: ReturnType<typeof computeKpis>; palette: Palette; striped: boolean }> = ({
  results,
  palette,
  striped,
}) => {
  function scoreStyle(measurable: boolean, met: boolean): React.CSSProperties | undefined {
    if (!measurable) return { color: palette.inkMuted };
    return met
      ? { color: palette.statusGood, fontWeight: 700 }
      : { color: palette.statusCritical, fontWeight: 700, background: 'rgba(220,38,38,0.10)' };
  }
  return (
    // The surface background is what makes the stripes show: striped rows
    // are the page colour, so on a bare page they vanish.
    <div className="overflow-auto rounded-md" style={{ background: palette.surface, border: `1px solid ${palette.border}`, maxHeight: 620 }}>
      <table className="w-full text-[12px]" style={{ color: palette.inkPrimary }}>
        <thead>
          <tr>
            {['KPI', 'Name', 'Target %', '%', 'On time %', 'No.', 'Late', 'In progress', 'Comments'].map((h) => (
              <th
                key={h}
                className="text-left px-3 py-2 font-semibold sticky top-0 z-10"
                style={{ color: palette.inkSecondary, background: palette.pagePlane }}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {results.map((r, i) => {
            const isSla = r.def.metric === 'commenced' || r.def.metric === 'completed';
            const cells = matrixCells(r);
            return (
              <tr key={r.def.id} data-upload-only={r.uploadOnly ? '' : undefined} style={{ background: striped && i % 2 ? palette.pagePlane : 'transparent' }}>
                <td className="px-3 py-1.5">{r.def.id}</td>
                <td className="px-3 py-1.5">{r.def.name}</td>
                <td className="px-3 py-1.5 text-right">{r.def.target}</td>
                <td className="px-3 py-1.5 text-right" style={!isSla ? scoreStyle(r.measurable, r.met) : { color: palette.inkSecondary }}>
                  {cells.pct}
                </td>
                <td className="px-3 py-1.5 text-right" style={isSla ? scoreStyle(r.measurable, r.met) : undefined}>
                  {cells.ontimePct}
                </td>
                <td className="px-3 py-1.5 text-right">{cells.count}</td>
                <td className="px-3 py-1.5 text-right" style={r.late > 0 ? { color: palette.statusCritical } : undefined}>
                  {cells.late}
                </td>
                <td className="px-3 py-1.5 text-right" style={{ color: palette.inkSecondary }}>
                  {cells.inProgress}
                </td>
                <td className="px-3 py-1.5" style={{ color: palette.inkSecondary }}>
                  {r.comment}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

function colourFor(score: number | null, target: number, palette: Palette): string {
  if (score === null) return palette.inkMuted;
  if (score >= target) return palette.statusGood;
  if (score >= target - 10) return palette.statusWarning;
  return palette.statusCritical;
}

const OnTimeChart: React.FC<{ results: ReturnType<typeof computeKpis>; palette: Palette }> = ({ results, palette }) => {
  const plot = results
    .filter((r) => (r.def.metric === 'commenced' || r.def.metric === 'completed') && r.ontimePct !== null)
    .sort((a, b) => (a.ontimePct as number) - (b.ontimePct as number));

  // "30 days (assumed)" reads as "PM Commenced (30 days (assumed))" on an
  // axis; the assumption is stated once, in the list under the page.
  const labels = plot.map((r) => `${r.def.name} (${TIER_WINDOW_LABEL[r.def.tier as Tier].replace(/\s*\(assumed\)/, '')})`);
  const values = plot.map((r) => r.ontimePct as number);
  const colours = plot.map((r) => colourFor(r.ontimePct, r.def.target, palette));

  return (
    <div className="rounded-md p-4" style={{ background: palette.surface, border: `1px solid ${palette.border}` }}>
      {plot.length === 0 ? (
        <p className="text-[13px] py-8 text-center" style={{ color: palette.inkMuted }}>
          No evaluable SLA rows in this selection.
        </p>
      ) : (
        <Plot
          data={[
            {
              type: 'bar',
              orientation: 'h',
              x: values,
              y: labels,
              text: values.map((v) => `${Math.round(v)}%`),
              textposition: 'outside',
              // Let a "100%" label run into the right margin instead of
              // being cut off at the edge of the plot on a narrow card.
              cliponaxis: false,
              marker: { color: colours },
              hovertemplate: '%{y}<br>on-time %{x:.0f}%<extra></extra>',
            },
          ]}
          layout={{
            ...baseLayout(palette, { title: 'On-time % by KPI (line = target)' }),
            xaxis: { ...baseLayout(palette, { title: '' }).xaxis, range: [0, 112], title: { text: 'On-time %', standoff: 12 } },
            yaxis: { ...baseLayout(palette, { title: '' }).yaxis, automargin: true },
            shapes: plot.map((r, i) => ({
              type: 'line',
              xref: 'x',
              yref: 'y',
              x0: r.def.target,
              x1: r.def.target,
              y0: i - 0.4,
              y1: i + 0.4,
              line: { color: palette.inkMuted, width: 2, dash: 'dot' },
            })),
          }}
          config={PLOT_CONFIG}
          style={{ width: '100%', height: Math.max(280, plot.length * 40 + 120) }}
          useResizeHandler
        />
      )}
    </div>
  );
};

const FactorsChart: React.FC<{ late: ReturnType<typeof lateJobs>; palette: Palette }> = ({ late, palette }) => {
  const counts = new Map<string, number>();
  for (const j of late) counts.set(j.category, (counts.get(j.category) ?? 0) + 1);
  const entries = [...counts.entries()].sort((a, b) => a[1] - b[1]);

  return (
    <div className="rounded-md p-4" style={{ background: palette.surface, border: `1px solid ${palette.border}` }}>
      {entries.length === 0 ? (
        <p className="text-[13px] py-8 text-center" style={{ color: palette.inkMuted }}>
          No late jobs in this selection.
        </p>
      ) : (
        <Plot
          data={[
            {
              type: 'bar',
              orientation: 'h',
              x: entries.map((e) => e[1]),
              y: entries.map((e) => e[0]),
              text: entries.map((e) => String(e[1])),
              textposition: 'outside',
              marker: { color: palette.catBlue },
              hovertemplate: '%{y}<br>%{x} late jobs<extra></extra>',
            },
          ]}
          layout={{
            ...baseLayout(palette, { title: 'Contributing factors (conditions present, not causes)' }),
            xaxis: { ...baseLayout(palette, { title: '' }).xaxis, title: { text: 'Late jobs', standoff: 12 } },
            yaxis: { ...baseLayout(palette, { title: '' }).yaxis, automargin: true },
          }}
          config={PLOT_CONFIG}
          style={{ width: '100%', height: Math.max(280, entries.length * 34 + 120) }}
          useResizeHandler
        />
      )}
    </div>
  );
};
