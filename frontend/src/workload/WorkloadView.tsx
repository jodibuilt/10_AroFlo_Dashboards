import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPalette, resolveIsDark, ThemeMode } from '../reporting/theme';
import { AuthError } from '../services/api';
import { fetchReportingConfig } from '../services/reportingConfig';
import { fetchWorkload, startWorkloadUpdate, WorkloadJob, WorkloadResponse, WorkloadUnbooked, WorkloadWorker } from '../services/workload';
import { formatDay, formatInstant, setReportTimeZone, today, zoneName } from '../reporting/time';
import { KpiCard } from '../reporting/components/KpiCard';
import { ClientMultiSelect } from '../reporting/components/ClientMultiSelect';
import { ariaSort, ColumnHeading, ControlColumn, ControlSummary, DownloadCsv, NoMatches, useTableControls } from '../reporting/components/tableControls';

// Workloads: the jobs booked to each field worker on a day, and how many of
// them are done.
//
// A job is a worker's for the day it is booked to them in AroFlo's calendar,
// and is completed on the day it is actually finished — the server works
// that out (src/workload/view.js); this page shows it.
//
// Reading the page never touches AroFlo. Only "Update now" does (two or
// three requests); between presses the page asks this app's own server every
// few seconds, which is where anything AroFlo has pushed turns up.

const OWN_SERVER_EVERY_MS = 15_000;
const WHILE_UPDATING_EVERY_MS = 2_000;

const pad = (n: number) => String(n).padStart(2, '0');

// A YYYY-MM-DD day moved by some days — by the calendar, not by a clock.
function shiftDay(day: string, by: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + by));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// "Wednesday 14 Oct 2026".
function dayName(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-AU', { weekday: 'long', timeZone: 'UTC' });
  return `${weekday} ${formatDay(day)}`;
}

// The time in one of AroFlo's "2026/10/14 07:30:00" strings, as "7:30 am".
function clock(value: string): string {
  const m = /[ T](\d{1,2}):(\d{2})/.exec(value || '');
  if (!m) return '';
  const hour = Number(m[1]);
  return `${hour % 12 || 12}:${m[2]} ${hour < 12 ? 'am' : 'pm'}`;
}

type When = WorkloadResponse['data']['when'];

// What a job that isn't finished is called depends on which day is being
// looked at: still going today, never finished on a day gone by, and simply
// booked on a day still to come.
function stateLabel(state: WorkloadJob['state'], when: When): string {
  if (state === 'completed') return 'Completed';
  return when === 'past' ? 'Not finished that day' : when === 'future' ? 'Booked' : 'Ongoing';
}

function jobColumns(when: When): ControlColumn<WorkloadJob>[] {
  return [
    { key: 'worker', label: 'Worker', filter: 'choice', text: (j) => j.worker },
    { key: 'job', label: 'Job', text: (j) => j.jobNumber },
    { key: 'task', label: 'Task', text: (j) => j.taskName },
    { key: 'client', label: 'Client', filter: 'choice', text: (j) => j.client },
    { key: 'site', label: 'Site', text: (j) => j.site },
    { key: 'priority', label: 'Priority', filter: 'choice', text: (j) => j.priority },
    { key: 'booked', label: 'Booked', filter: 'none', text: (j) => [clock(j.start), clock(j.end)].filter(Boolean).join(' – '), sortValue: (j) => j.start },
    { key: 'state', label: 'State', filter: 'choice', text: (j) => stateLabel(j.state, when) },
    { key: 'finished', label: 'Finished', filter: 'none', text: (j) => clock(j.completedAt), sortValue: (j) => j.completedAt },
  ];
}

const UNBOOKED_COLUMNS: ControlColumn<WorkloadUnbooked>[] = [
  { key: 'job', label: 'Job', text: (j) => j.jobNumber },
  { key: 'task', label: 'Task', text: (j) => j.taskName },
  { key: 'client', label: 'Client', filter: 'choice', text: (j) => j.client },
  { key: 'site', label: 'Site', text: (j) => j.site },
  { key: 'finished', label: 'Finished', filter: 'none', text: (j) => clock(j.completedAt), sortValue: (j) => j.completedAt },
  { key: 'by', label: 'Marked done by', filter: 'choice', text: (j) => j.completedBy },
  { key: 'last', label: 'Last booked to', filter: 'choice', text: (j) => j.lastBookedTo },
];

// One row per worker from a list of their jobs, by name.
function byWorker(jobs: WorkloadJob[]): WorkloadWorker[] {
  const rows = new Map<string, WorkloadWorker>();
  for (const j of jobs) {
    const row = rows.get(j.worker) ?? { worker: j.worker, booked: 0, completed: 0, ongoing: 0, hours: 0 };
    row.booked += 1;
    row[j.state] += 1;
    row.hours = Math.round((row.hours + j.hours) * 100) / 100;
    rows.set(j.worker, row);
  }
  return [...rows.values()].sort((a, b) => a.worker.localeCompare(b.worker, undefined, { sensitivity: 'base', numeric: true }));
}

interface Props {
  themeMode: ThemeMode;
}

export const WorkloadView: React.FC<Props> = ({ themeMode }) => {
  const palette = getPalette(themeMode);
  const isDark = resolveIsDark(themeMode);
  // Empty until the reports' time zone is known: "today" is Adelaide's.
  const [day, setDay] = useState('');
  const [title, setTitle] = useState('');
  const [page, setPage] = useState<WorkloadResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  // An update was asked for and the page hasn't yet seen it finish.
  const [waiting, setWaiting] = useState(false);
  const showing = useRef('');
  const fetchedBefore = useRef<string | null>(null);

  useEffect(() => {
    fetchReportingConfig()
      .then((c) => {
        setReportTimeZone(c.timeZone);
        setTitle(c.reportTitle || '');
      })
      .catch(() => {})
      .finally(() => setDay(today()));
  }, []);

  const load = useCallback(async (which: string) => {
    try {
      const next = await fetchWorkload(which);
      if (showing.current !== which) return; // the day was changed while this was on its way
      setPage(next);
      setError(null);
      if (!next.meta.updating && (next.meta.fetchedAt !== fetchedBefore.current || next.meta.error)) setWaiting(false);
    } catch (e) {
      if (e instanceof AuthError) return; // the app shell notices a session that has ended
      setError(e instanceof Error ? e.message : 'Could not load the workload.');
    }
  }, []);

  useEffect(() => {
    if (!day) return;
    showing.current = day;
    setPage(null);
    setWaiting(false);
    load(day);
  }, [day, load]);

  const updating = waiting || Boolean(page?.meta.updating);
  useEffect(() => {
    if (!day) return;
    const timer = window.setInterval(
      () => {
        if (!document.hidden) load(day);
      },
      updating ? WHILE_UPDATING_EVERY_MS : OWN_SERVER_EVERY_MS,
    );
    return () => window.clearInterval(timer);
  }, [day, updating, load]);

  async function update() {
    setError(null);
    fetchedBefore.current = page?.meta.fetchedAt ?? null;
    try {
      await startWorkloadUpdate(day);
      setWaiting(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the update.');
    }
  }

  const data = page?.data;
  const meta = page?.meta;
  const when: When = data?.when ?? 'today';

  // A worker picked yesterday who has nothing today is simply not there to show.
  const names = useMemo(() => (data ? data.workers.map((w) => w.worker) : []), [data]);
  const picked = selected.filter((w) => names.includes(w));
  const jobs = useMemo(() => (data?.jobs ?? []).filter((j) => picked.length === 0 || picked.includes(j.worker)), [data, picked.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const share = (done: number, of: number) => (of > 0 ? Math.round((done / of) * 100) : 0);

  const columns = useMemo(() => jobColumns(when), [when]);
  const jobControls = useTableControls(jobs, columns);
  const unbookedControls = useTableControls(data?.notBooked ?? [], UNBOOKED_COLUMNS);

  // The tiles and the table by worker count the jobs the filters leave —
  // the Worker picker above and the Jobs table's own filters both — so
  // filtering by client or priority shows each worker's load of just that.
  const workers = useMemo(() => byWorker(jobControls.rows), [jobControls.rows]);
  const total = workers.reduce((t, w) => ({ booked: t.booked + w.booked, completed: t.completed + w.completed, ongoing: t.ongoing + w.ongoing }), { booked: 0, completed: 0, ongoing: 0 });
  const narrowed = picked.length > 0 || jobControls.filtered;

  const line = `1px solid ${palette.border}`;
  const units = (meta?.businessUnits?.reportsAreFor ?? []).filter((u) => u !== '*');
  const unfinished = when === 'past' ? 'Not finished that day' : when === 'future' ? 'Booked' : 'Ongoing';
  const headCell = 'text-left px-3 py-2 font-semibold sticky top-0 z-10 align-top';
  const headStyle: React.CSSProperties = { color: palette.inkSecondary, background: palette.pagePlane };

  return (
    <div className={isDark ? 'dash-dark' : ''} style={{ background: palette.pagePlane, minHeight: '100%' }}>
      <div className="p-8 space-y-6">
        <div className="pb-3" style={{ borderBottom: line }}>
          {title && (
            <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: palette.inkMuted }}>
              {title}
            </div>
          )}
          <h1 className="text-[1.6rem] font-bold" style={{ color: palette.inkPrimary }}>
            Workloads
          </h1>
          <div className="text-[0.95rem]" style={{ color: palette.inkSecondary }}>
            Jobs booked to each field worker for a day, and how many are done
          </div>
        </div>

        {/* What is loaded, how old it is, and the one button that asks AroFlo. */}
        <div
          data-workload-status
          className="rounded-md px-4 py-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3"
          style={{ background: !data || data.loaded || updating ? palette.surface : 'rgba(2,132,199,0.08)', border: line }}
        >
          <div className="min-w-0 flex-1 basis-full sm:basis-0 text-[12px]">
            <div className="text-[13px] font-semibold" style={{ color: palette.inkPrimary }} role="status" aria-live="polite">
              {!day || !data
                ? 'Checking what is loaded…'
                : updating
                  ? `Reading ${dayName(day)} from AroFlo…`
                  : data.loaded && meta?.fetchedAt
                    ? `Bookings for ${dayName(day)}, as of ${formatInstant(meta.fetchedAt)}`
                    : `Nothing has been read from AroFlo for ${dayName(day)} yet. Press Update now to load it.`}
            </div>
            {data?.loaded && !updating && (
              <div data-workload-summary style={{ color: palette.statusGood, fontWeight: 600 }}>
                ✓ {data.totals.booked.toLocaleString()} jobs booked to {data.totals.workers.toLocaleString()} workers · {data.totals.completed.toLocaleString()} completed
              </div>
            )}
            {data?.loaded && units.length > 0 && meta?.businessUnits && (
              <div data-business-units style={{ color: palette.inkSecondary }}>
                {units.join(' + ')} only
                {meta.businessUnits.leftOut > 0 ? `. Left out, as another business unit’s: ${meta.businessUnits.leftOut.toLocaleString()} bookings.` : '.'}
              </div>
            )}
            <div style={{ color: palette.inkMuted }}>
              {meta?.pushEnabled
                ? 'Completions arrive from AroFlo as they happen. Bookings are as of the time above: '
                : 'Bookings and completions are as of the time above: '}
              nothing is read from AroFlo until someone presses Update now, which uses two or three of the daily AroFlo requests shared with other tools.
            </div>
            {meta?.calendarChangedAt && (
              <div style={{ color: palette.statusWarningText }}>
                AroFlo’s calendar changed at {formatInstant(meta.calendarChangedAt)}, after these bookings were read. Press Update now to bring them up to date.
              </div>
            )}
            {(meta?.notes ?? []).map((note) => (
              <div key={note} style={{ color: palette.statusWarningText }}>
                {note}
              </div>
            ))}
            {meta?.error && <div style={{ color: palette.statusCritical }}>The last update failed: {meta.error}</div>}
            {error && <div style={{ color: palette.statusCritical }}>{error}</div>}
          </div>
          <button
            type="button"
            onClick={update}
            disabled={updating || !data}
            className="px-3 py-1.5 rounded-md text-[12px] font-semibold inline-flex items-center gap-1 shrink-0 disabled:opacity-60"
            style={{ background: palette.accentBlue, color: '#fff' }}
          >
            <span className={`material-symbols-outlined text-[16px] ${updating ? 'animate-spin' : ''}`} aria-hidden="true">
              {updating ? 'progress_activity' : 'refresh'}
            </span>
            {updating ? 'Updating…' : 'Update now'}
          </button>
        </div>

        {/* Which day, and whose jobs. */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <label className="block text-[12px]" style={{ color: palette.inkSecondary }}>
            Day
            <input
              type="date"
              value={day}
              onChange={(e) => e.target.value && setDay(e.target.value)}
              className="mt-1 w-full px-2 py-1.5 rounded-md text-[13px]"
              style={{ background: palette.surface, border: line, color: palette.inkPrimary }}
            />
          </label>
          <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: palette.inkSecondary }}>
            {data &&
              ([
                ['Yesterday', shiftDay(data.today, -1)],
                ['Today', data.today],
                ['Tomorrow', shiftDay(data.today, 1)],
              ] as const).map(([label, value]) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => setDay(value)}
                  aria-pressed={day === value}
                  className="px-3 py-1.5 rounded-md text-[12px] font-semibold"
                  style={{ background: day === value ? palette.accentBlue : palette.surface, color: day === value ? '#fff' : palette.inkPrimary, border: line }}
                >
                  {label}
                </button>
              ))}
          </div>
          <div className="text-[12px]" style={{ color: palette.inkSecondary }}>
            Worker
            <div className="mt-1">
              <ClientMultiSelect palette={palette} options={names.map((w) => ({ value: w, label: w }))} selected={picked} onChange={setSelected} allLabel="All workers" noun="worker" />
            </div>
          </div>
        </div>

        <details className="text-[12px]" style={{ color: palette.inkSecondary }}>
          <summary className="cursor-pointer font-semibold" style={{ color: palette.inkPrimary }}>
            How this is counted
          </summary>
          <ul className="mt-2 list-disc pl-5 space-y-1">
            <li>
              <b>Booked</b> — the job is in AroFlo’s calendar for that worker on that day. A job booked to two people counts for each of them;
              booked to one person twice in a day, it counts once.
            </li>
            <li>
              <b>Completed</b> — the job was marked Completed in AroFlo <i>on that day</i>. A job booked on Monday and finished on Tuesday is
              ongoing on Monday’s page and completed on Tuesday’s.
            </li>
            <li>
              <b>Finished without being booked that day</b> — listed at the foot of the page, with who last had it booked, so a job carried
              over from an earlier day is still seen to be done.
            </li>
            <li>
              <b>Which jobs.</b> Only bookings of a job to a person: leave, meetings and bookings of equipment are not counted.
            </li>
            <li>
              <b>Whose clock.</b> {zoneName()} time: “today” and every time on the page are {zoneName()}’s, wherever the page is opened from.
            </li>
          </ul>
        </details>

        {data && !data.loaded && !updating && (
          <div className="rounded-md p-6 text-[13px]" style={{ background: 'rgba(2,132,199,0.08)', border: line, color: palette.inkSecondary }}>
            No bookings are loaded for {dayName(day)}. Press <b>Update now</b> at the top of the page.
          </div>
        )}

        {data?.loaded && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-workload-tiles>
              <KpiCard label="Workers" value={workers.length.toLocaleString()} pillText={narrowed ? `of ${data.totals.workers} booked` : 'with jobs booked'} level="neutral" palette={palette} />
              <KpiCard label="Jobs booked" value={total.booked.toLocaleString()} pillText={dayName(day)} level="neutral" palette={palette} />
              <KpiCard label="Completed" value={total.completed.toLocaleString()} pillText={`${share(total.completed, total.booked)}% of booked`} level="good" palette={palette} />
              <KpiCard label={unfinished} value={total.ongoing.toLocaleString()} pillText={when === 'past' ? 'carried over' : when === 'future' ? 'still to come' : 'still to do today'} level={when === 'past' && total.ongoing > 0 ? 'warning' : 'neutral'} palette={palette} />
            </div>

            {/* Said, so a smaller number up here is never a mystery. */}
            {jobControls.filtered && (
              <p className="text-[12px] -mt-3" style={{ color: palette.inkSecondary }} data-workload-narrowed>
                Counting only the jobs the filters on the Jobs table leave: {jobControls.rows.length.toLocaleString()} of {jobControls.total.toLocaleString()}.{' '}
                <button type="button" onClick={jobControls.clear} className="underline font-semibold" style={{ color: palette.accentBlue }}>
                  Clear filters
                </button>
              </p>
            )}

            <section className="space-y-2">
              <h2 className="text-[1.05rem] font-semibold" style={{ color: palette.inkPrimary }}>
                By worker
              </h2>
              {workers.length === 0 ? (
                <p className="text-[13px]" style={{ color: palette.inkMuted }}>
                  {jobs.length === 0 ? `No jobs are booked to anyone on ${dayName(day)}.` : 'No jobs match the filters on the Jobs table.'}
                </p>
              ) : (
                <div className="overflow-auto rounded-md" style={{ background: palette.surface, border: line, maxHeight: 460 }}>
                  <table className="w-full text-[12px]" style={{ color: palette.inkPrimary }} data-workload-workers>
                    <thead>
                      <tr>
                        {['Worker', 'Booked', 'Completed', unfinished, 'Done', 'Hours booked'].map((h, i) => (
                          <th key={h} className={`${headCell} ${i > 0 && i !== 4 ? 'text-right' : ''}`} style={headStyle}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {workers.map((w, i) => {
                        const only = picked.length === 1 && picked[0] === w.worker;
                        const pct = share(w.completed, w.booked);
                        return (
                          <tr key={w.worker} style={{ background: i % 2 ? palette.pagePlane : 'transparent' }}>
                            <td className="px-3 py-1.5">
                              <button
                                type="button"
                                onClick={() => setSelected(only ? [] : [w.worker])}
                                title={only ? 'Show every worker again' : `Show only ${w.worker}’s jobs`}
                                className="font-semibold underline-offset-2 hover:underline text-left"
                                style={{ color: palette.inkPrimary }}
                              >
                                {w.worker}
                              </button>
                            </td>
                            <td className="px-3 py-1.5 text-right">{w.booked}</td>
                            <td className="px-3 py-1.5 text-right" style={{ color: w.completed > 0 ? palette.statusGood : undefined, fontWeight: w.completed > 0 ? 700 : 400 }}>
                              {w.completed}
                            </td>
                            <td className="px-3 py-1.5 text-right">{w.ongoing}</td>
                            <td className="px-3 py-1.5" style={{ minWidth: 160 }}>
                              <div className="flex items-center gap-2">
                                <div className="h-2 flex-1 rounded-full overflow-hidden" style={{ background: palette.border }} role="progressbar" aria-valuemin={0} aria-valuemax={w.booked} aria-valuenow={w.completed} aria-label={`${w.worker}: ${w.completed} of ${w.booked} done`}>
                                  <div className="h-full" style={{ width: `${pct}%`, background: palette.statusGood }} />
                                </div>
                                <span className="tabular-nums" style={{ color: palette.inkSecondary, minWidth: 36, textAlign: 'right' }}>
                                  {pct}%
                                </span>
                              </div>
                            </td>
                            <td className="px-3 py-1.5 text-right">{w.hours ? w.hours : ''}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-[1.05rem] font-semibold" style={{ color: palette.inkPrimary }}>
                  Jobs{picked.length === 1 ? ` — ${picked[0]}` : ''}
                </h2>
                <div className="flex items-center gap-3">
                  <ControlSummary controls={jobControls} palette={palette} noun="jobs" />
                  <DownloadCsv controls={jobControls} palette={palette} name={`workload-${day}`} />
                </div>
              </div>
              <div className="overflow-auto rounded-md" style={{ background: palette.surface, border: line, maxHeight: 460 }}>
                <table className="w-full text-[12px]" style={{ color: palette.inkPrimary }} data-workload-jobs>
                  <thead>
                    <tr>
                      {columns.map((c) => (
                        <th key={c.key} aria-sort={ariaSort(jobControls, c.key)} className={headCell} style={headStyle}>
                          <ColumnHeading column={c} controls={jobControls} palette={palette} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {jobControls.rows.map((j, i) => (
                      <tr key={`${j.worker}|${j.jobNumber}|${j.taskName}|${j.start}`} style={{ background: i % 2 ? palette.pagePlane : 'transparent' }}>
                        {columns.map((c) => (
                          <td
                            key={c.key}
                            className="px-3 py-1.5"
                            style={c.key === 'state' ? { color: j.state === 'completed' ? palette.statusGood : when === 'past' ? palette.statusWarningText : palette.inkSecondary, fontWeight: 600 } : undefined}
                          >
                            {c.text(j)}
                          </td>
                        ))}
                      </tr>
                    ))}
                    <NoMatches controls={jobControls} palette={palette} span={columns.length} />
                    {jobs.length === 0 && (
                      <tr>
                        <td colSpan={columns.length} className="px-3 py-3" style={{ color: palette.inkMuted }}>
                          No jobs booked.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            {data.notBooked.length > 0 && (
              <section className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[1.05rem] font-semibold" style={{ color: palette.inkPrimary }}>
                    Finished that day without being booked on it ({data.notBooked.length})
                  </h2>
                  <DownloadCsv controls={unbookedControls} palette={palette} name={`finished-not-booked-${day}`} />
                </div>
                <p className="text-[12px]" style={{ color: palette.inkMuted }}>
                  Done all the same, and on nobody’s list above — usually a job carried over from an earlier day. For every worker, whatever the
                  filter says.
                </p>
                <div className="overflow-auto rounded-md" style={{ background: palette.surface, border: line, maxHeight: 320 }}>
                  <table className="w-full text-[12px]" style={{ color: palette.inkPrimary }} data-workload-not-booked>
                    <thead>
                      <tr>
                        {UNBOOKED_COLUMNS.map((c) => (
                          <th key={c.key} aria-sort={ariaSort(unbookedControls, c.key)} className={headCell} style={headStyle}>
                            <ColumnHeading column={c} controls={unbookedControls} palette={palette} />
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {unbookedControls.rows.map((j, i) => (
                        <tr key={`${j.jobNumber}|${j.taskName}|${j.completedAt}`} style={{ background: i % 2 ? palette.pagePlane : 'transparent' }}>
                          {UNBOOKED_COLUMNS.map((c) => (
                            <td key={c.key} className="px-3 py-1.5">
                              {c.text(j)}
                            </td>
                          ))}
                        </tr>
                      ))}
                      <NoMatches controls={unbookedControls} palette={palette} span={UNBOOKED_COLUMNS.length} />
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};
