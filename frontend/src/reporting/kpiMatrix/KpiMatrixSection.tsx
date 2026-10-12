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
import { computeKpis, fmtPct, KpiResult, lateJobs, reconcile } from './engine';
import { buildKpiMatrixWorkbook } from './exportMatrix';
import { fetchLiveKpiRows, LIVE_CLIENT_COLUMN, LiveKpiRows } from '../../services/reportingKpiMatrix';

const CSV_KEY = 'kpi-matrix-csv';
const NAME_KEY = 'kpi-matrix-filename';
const MAX_PERSIST = 3_000_000; // chars

// The matrix reads live work orders from AroFlo unless a CSV export has been
// uploaded, which then takes over until it is cleared. Three KPIs need data
// AroFlo's API doesn't expose — a task's invoice date, checklists, compliance
// forms — so live mode reports them as N/A instead of scoring every job a
// failure for a date it was never given.
const LIVE_UNMEASURED: Set<Metric> = new Set(['invoice', 'jsa', 'issues']);

function unmeasured(def: KpiDef): KpiResult {
  return {
    def,
    count: 0,
    total: 0,
    ontimeCount: null,
    ontimePool: null,
    comment: 'Not in live AroFlo data — upload a CSV export to measure',
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
  'On-time % covers jobs started within their response window and finished by their due date. ' +
  'Commenced uses the first labour entry logged on the job. Contributing factors are conditions ' +
  'present on the job, not confirmed causes of delay.';

const LIVE_ASSUMPTIONS = [
  'Commenced KPIs use the first labour entry logged on the job. A job with no labour logged is not scored for commencement.',
  "Completion is judged against AroFlo's own Task Due Date, not the computed contractual SLA date. Those due dates are frequently defaulted / generous.",
  'A due date with no time is treated as due by the end of that day.',
  'KPIs 12–14 are not measured: AroFlo’s API does not link an invoice to its work order, or expose checklists and compliance forms. Upload a CSV export to measure them.',
  'PM SLA window of 30 days was never confirmed with the client.',
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

interface Props {
  palette: Palette;
  striped: boolean;
}

export const KpiMatrixSection: React.FC<Props> = ({ palette, striped }) => {
  const persisted = useMemo(loadPersisted, []);
  const [csvText, setCsvText] = useState<string | null>(persisted?.csv ?? null);
  const [fileName, setFileName] = useState<string | null>(persisted?.name ?? null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [showDiag, setShowDiag] = useState(false);
  const [monthFilter, setMonthFilter] = useState<string>('__recent__');
  const [tierFilter, setTierFilter] = useState<Set<Tier>>(new Set(TIERS));
  const [catFilter, setCatFilter] = useState<string>('__all__');
  const [busy, setBusy] = useState(false);
  const [loadedAt, setLoadedAt] = useState<Date | null>(persisted ? new Date() : null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [live, setLive] = useState<LiveKpiRows | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [clientFilter, setClientFilter] = useState<string>('__all__');
  const fileRef = useRef<HTMLInputElement>(null);

  const isLive = !csvText;

  // Re-derived on every refresh so "overdue" / invoice-maturity checks use a
  // current clock, and every downstream useMemo recomputes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const now = useMemo(() => new Date(), [reloadNonce]);

  // Live work orders, whenever no CSV is standing in for them. reloadNonce
  // re-runs this for the Refresh button.
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
  }, [isLive, reloadNonce]);

  const liveClients = useMemo(
    () => (live ? [...new Set(live.rows.map((r) => r[LIVE_CLIENT_COLUMN]).filter(Boolean))].sort() : []),
    [live],
  );
  // A client picked before a refresh may no longer be in the data.
  const activeClient = liveClients.includes(clientFilter) ? clientFilter : '__all__';

  function resetFilters() {
    setMonthFilter('__recent__');
    setTierFilter(new Set(TIERS));
    setCatFilter('__all__');
  }

  const parsed = useMemo(() => {
    try {
      if (csvText) return buildDataset(csvText, now);
      if (!live) return null;
      const rows = activeClient === '__all__' ? live.rows : live.rows.filter((r) => r[LIVE_CLIENT_COLUMN] === activeClient);
      return buildDatasetFromRows(live.headers, rows, now);
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Failed to parse CSV' } as { error: string };
    }
  }, [csvText, live, activeClient, now]);

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
  const late = useMemo(() => lateJobs(filteredRows, now), [filteredRows, now]);

  const lateCats = useMemo(() => [...new Set(late.map((j) => j.category))].sort(), [late]);
  const shownLate = catFilter === '__all__' ? late : late.filter((j) => j.category === catFilter);

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

  async function exportExcel() {
    setBusy(true);
    try {
      const { blob, filename } = await buildKpiMatrixWorkbook(results, shownLate, {
        months: resolvedMonth === '__all__' ? 'all' : resolvedMonth,
        generated: new Date().toISOString().slice(0, 10),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setBusy(false);
    }
  }

  const h2 = 'text-[1.05rem] font-semibold pb-1 mb-1';
  const cardStyle: React.CSSProperties = { background: palette.surface, border: `1px solid ${palette.border}` };
  const outlineButton: React.CSSProperties = { border: `1px solid ${palette.border}`, color: palette.inkPrimary };
  const liveEmpty = isLive && live !== null && live.rows.length === 0;

  return (
    <div>
      <h2 className={h2} style={{ borderBottom: `1px solid ${palette.border}`, color: palette.inkPrimary }}>
        KPI Compliance Matrix
      </h2>
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
              Live from AroFlo
            </span>
            <button
              onClick={() => setReloadNonce((n) => n + 1)}
              className="px-3 py-1.5 rounded-md text-[12px] font-semibold inline-flex items-center gap-1"
              style={outlineButton}
              title="Re-read the latest work orders the server holds from AroFlo"
            >
              <span className="material-symbols-outlined text-[16px]">refresh</span>
              Refresh
            </button>
            {live && (
              <span className="text-[12px]" style={{ color: palette.inkSecondary }}>
                {live.rows.length.toLocaleString()} work orders
                {live.lastFetchedAt && (
                  <span style={{ color: palette.inkMuted }}>
                    {' '}
                    · as of {new Date(live.lastFetchedAt).toLocaleTimeString()}
                  </span>
                )}
              </span>
            )}
            {liveClients.length > 1 && (
              <label className="text-[12px] inline-flex items-center gap-2" style={{ color: palette.inkSecondary }}>
                Client
                <select
                  value={activeClient}
                  onChange={(e) => setClientFilter(e.target.value)}
                  className="px-2 py-1 rounded-md text-[12px]"
                  style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
                >
                  <option value="__all__">All clients</option>
                  {liveClients.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}
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
                <span style={{ color: palette.inkMuted }}> · loaded {loadedAt.toLocaleTimeString()}</span>
              )}
            </span>
            <button onClick={clearUpload} className="text-[12px] underline" style={{ color: palette.inkMuted }}>
              clear — back to live data
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
            Showing the uploaded file instead of live AroFlo data. Edited the file? Re-pick it with <b>Replace CSV</b> —
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
      {isLive && live?.error && (
        <p className="text-[12px] mb-3" style={{ color: palette.statusCritical }}>
          AroFlo’s last refresh failed ({live.error})
          {live.rows.length > 0 ? ' — showing the work orders that loaded before it.' : '.'}
        </p>
      )}
      {isLive && !live && !liveError && (
        <p className="text-[13px] mb-3" style={{ color: palette.inkMuted }}>
          Loading work orders from AroFlo…
        </p>
      )}
      {liveEmpty && (
        <p className="text-[13px] mb-3" style={{ color: palette.inkMuted }}>
          No work orders have loaded from AroFlo yet. Upload a CSV export to use the matrix in the meantime.
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
                      {t}
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              onClick={exportExcel}
              disabled={busy}
              className="px-3 py-1.5 rounded-md text-[12px] font-semibold disabled:opacity-50"
              style={{ border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
            >
              {busy ? 'Building…' : 'Export to Excel'}
            </button>
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

          <MatrixTable results={results} palette={palette} striped={striped} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
            <OnTimeChart results={results} palette={palette} />
            <FactorsChart late={late} palette={palette} />
          </div>

          {/* Late jobs */}
          <div className="mt-4">
            <h3 className="text-[14px] font-semibold mb-2" style={{ color: palette.inkPrimary }}>
              Late jobs ({late.length})
            </h3>
            <label className="text-[12px] mb-2 inline-flex items-center gap-2" style={{ color: palette.inkSecondary }}>
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
            <div className="overflow-auto rounded-md" style={{ border: `1px solid ${palette.border}`, maxHeight: 460 }}>
              <table className="w-full text-[12px]" style={{ color: palette.inkPrimary }}>
                <thead>
                  <tr>
                    {['Job', 'Task', 'Tier', 'Requested', 'Completed', 'Days late', 'Category'].map((h) => (
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
                  {shownLate.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-3" style={{ color: palette.inkMuted }}>
                        No late jobs in this selection.
                      </td>
                    </tr>
                  )}
                  {shownLate.map((j, i) => (
                    <tr key={`${j.jobNumber}-${i}`} style={{ background: striped && i % 2 ? palette.pagePlane : 'transparent' }}>
                      <td className="px-3 py-1.5">{j.jobNumber}</td>
                      <td className="px-3 py-1.5">{j.task}</td>
                      <td className="px-3 py-1.5">{j.tier}</td>
                      <td className="px-3 py-1.5">{fmtDate(j.requested)}</td>
                      <td className="px-3 py-1.5">{fmtDate(j.completed)}</td>
                      <td className="px-3 py-1.5 text-right" style={{ color: palette.statusCritical, fontWeight: 700 }}>
                        {j.daysLate}
                      </td>
                      <td className="px-3 py-1.5">{j.category}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <details className="mt-4 text-[12px]" style={{ color: palette.inkSecondary }}>
            <summary className="cursor-pointer font-semibold">Assumptions &amp; known limitations</summary>
            <ul className="list-disc ml-5 mt-2 space-y-1">
              {(isLive ? LIVE_ASSUMPTIONS : ASSUMPTIONS).map((a) => (
                <li key={a}>{a}</li>
              ))}
              <li>
                Categories are conditions present on the job, not confirmed causes of delay. The proper fix is a
                mandatory delay-reason field in AroFlo.
              </li>
              {!isLive && (
                <li>Completed-only exports make the “%” column read 100% by construction, not by performance.</li>
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
            ? `Priorities with no tier (label them in KPI_PRIORITY_LABELS_JSON): ${diag.unmappedPriorities.join(' | ')}`
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
    <div className="overflow-auto rounded-md" style={{ border: `1px solid ${palette.border}`, maxHeight: 620 }}>
      <table className="w-full text-[12px]" style={{ color: palette.inkPrimary }}>
        <thead>
          <tr>
            {['KPI', 'Name', 'Target %', '%', 'On time %', 'No.', 'Late', 'Comments'].map((h) => (
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
            return (
              <tr key={r.def.id} style={{ background: striped && i % 2 ? palette.pagePlane : 'transparent' }}>
                <td className="px-3 py-1.5">{r.def.id}</td>
                <td className="px-3 py-1.5">{r.def.name}</td>
                <td className="px-3 py-1.5 text-right">{r.def.target}</td>
                <td className="px-3 py-1.5 text-right" style={!isSla ? scoreStyle(r.measurable, r.met) : { color: palette.inkSecondary }}>
                  {fmtPct(r.completionPct)}
                </td>
                <td className="px-3 py-1.5 text-right" style={isSla ? scoreStyle(r.measurable, r.met) : undefined}>
                  {isSla ? fmtPct(r.ontimePct) : ''}
                </td>
                <td className="px-3 py-1.5 text-right">{r.count}</td>
                <td className="px-3 py-1.5 text-right" style={r.late > 0 ? { color: palette.statusCritical } : undefined}>
                  {r.late}
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

  const labels = plot.map((r) => `${r.def.name} (${TIER_WINDOW_LABEL[r.def.tier as Tier]})`);
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
