import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPalette, Palette, resolveIsDark, ThemeMode } from '../reporting/theme';
import { AuthError } from '../services/api';
import { fetchReportingConfig } from '../services/reportingConfig';
import { fetchWorkload, startWorkloadUpdate, WorkloadBacklogJob, WorkloadJob, WorkloadNotCounted, WorkloadResponse, WorkloadUnbooked } from '../services/workload';
import { formatDay, formatInstant, setReportTimeZone, today, zoneName } from '../reporting/time';
import { KpiCard } from '../reporting/components/KpiCard';
import { ClientMultiSelect } from '../reporting/components/ClientMultiSelect';
import { ariaSort, ColumnHeading, ControlColumn, ControlSummary, DownloadCsv, matches, NoMatches, TableControls, useTableControls } from '../reporting/components/tableControls';

// Workloads, in two tabs:
//   - Scheduled: the jobs on each field worker's calendar for a day, and
//     which of them are done ("take all that is scheduled today and then
//     log all that is finished", 2026-10-14);
//   - Not done yet: every job scheduled to each worker from that day back
//     over the last few weeks that isn't finished, and how many carried over
//     from earlier days they finished that day.
// Whose a job is comes from the calendar only; a job scheduled to two
// people is on both their lists. The server works it all out
// (src/workload/view.js); this page shows it.
//
// Reading the page never touches AroFlo. Only "Update now" does; between
// presses the page asks this app's own server every few seconds, which is
// where anything AroFlo has pushed turns up.

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
type Tab = 'scheduled' | 'backlog';

// Booked but not done, as the day being looked at calls it.
const stillToDo = (when: When) => (when === 'past' ? 'Not finished' : when === 'future' ? 'Still to come' : 'Still to do');

// A job that is done is done one of three ways.
function stateLabel(job: WorkloadJob, when: When): string {
  if (job.state === 'completed') return job.doneHow === 'invoicing' ? 'Ready for invoicing' : job.doneHow === 'earlier' ? 'Completed earlier' : 'Completed';
  return when === 'past' ? 'Not finished that day' : when === 'future' ? 'Booked' : 'Ongoing';
}

// When it was finished: the time that day, or the day for one finished earlier.
const finishedText = (j: WorkloadJob) => (j.doneHow === 'earlier' ? formatDay(j.completedAt) : clock(j.completedAt));
const statusText = (j: { status: string; substatus: string; unread?: boolean }) => (j.unread ? 'Not read from AroFlo yet' : [j.status, j.substatus].filter(Boolean).join(' · '));
const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
// The customer's order number; a job without one shows its job number, said to be one.
const jobRef = (j: { customerOrderNumber: string; jobNumber: string }) => j.customerOrderNumber || (j.jobNumber ? `${j.jobNumber} (job no.)` : '');
const share = (done: number, of: number) => (of > 0 ? Math.round((done / of) * 100) : 0);

function scheduledColumns(when: When): ControlColumn<WorkloadJob>[] {
  return [
    { key: 'worker', label: 'Worker', filter: 'choice', text: (j) => j.worker },
    { key: 'job', label: 'Customer order no.', text: jobRef },
    { key: 'task', label: 'Task', text: (j) => j.taskName },
    { key: 'client', label: 'Client', filter: 'choice', text: (j) => j.client },
    { key: 'site', label: 'Site', text: (j) => j.site },
    { key: 'priority', label: 'Priority', filter: 'choice', text: (j) => j.priority },
    { key: 'booked', label: 'Booked', filter: 'none', text: (j) => [clock(j.start), clock(j.end)].filter(Boolean).join(' – '), sortValue: (j) => j.start },
    // As AroFlo has it now, substatus beside the status: what to compare with AroFlo.
    { key: 'aroflo', label: 'Status in AroFlo', filter: 'choice', text: statusText },
    { key: 'state', label: 'State', filter: 'choice', text: (j) => stateLabel(j, when) },
    { key: 'finished', label: 'Finished', filter: 'none', text: finishedText, sortValue: (j) => j.completedAt },
  ];
}

// The days a job was on a worker's calendar: "13 Oct", or "9 Oct … 14 Oct (3 days)".
function scheduledText(j: WorkloadBacklogJob, day: string): string {
  const name = (d: string) => (d === day ? 'that day' : formatDay(d));
  if (j.scheduledDays.length <= 1) return name(j.firstScheduled);
  return `${name(j.firstScheduled)} … ${name(j.lastScheduled)} (${j.scheduledDays.length} days)`;
}

function backlogColumns(day: string, when: When): ControlColumn<WorkloadBacklogJob>[] {
  const finished = when === 'today' ? 'Finished today' : 'Finished that day';
  return [
    { key: 'worker', label: 'Worker', filter: 'choice', text: (j) => j.worker },
    { key: 'job', label: 'Customer order no.', text: jobRef },
    { key: 'task', label: 'Task', text: (j) => j.taskName },
    { key: 'client', label: 'Client', filter: 'choice', text: (j) => j.client },
    { key: 'site', label: 'Site', text: (j) => j.site },
    { key: 'priority', label: 'Priority', filter: 'choice', text: (j) => j.priority },
    { key: 'scheduled', label: 'Scheduled to them', filter: 'none', text: (j) => scheduledText(j, day), sortValue: (j) => j.firstScheduled },
    { key: 'waiting', label: 'Days waiting', filter: 'number', align: 'right', text: (j) => (j.state === 'open' ? String(j.daysWaiting) : ''), sortValue: (j) => (j.state === 'open' ? j.daysWaiting : null) },
    { key: 'aroflo', label: 'Status in AroFlo', filter: 'choice', text: statusText },
    { key: 'state', label: 'State', filter: 'choice', text: (j) => (j.state === 'finished' ? finished : j.onDay ? 'Not done — on that day’s calendar' : 'Not done — carried over') },
    { key: 'finished', label: 'Finished', filter: 'none', text: (j) => clock(j.completedAt), sortValue: (j) => j.completedAt },
  ];
}

const NOT_COUNTED_COLUMNS: ControlColumn<WorkloadNotCounted>[] = [
  { key: 'worker', label: 'Worker', filter: 'choice', text: (j) => j.worker },
  { key: 'job', label: 'Customer order no.', text: jobRef },
  { key: 'task', label: 'Booked for', text: (j) => j.taskName },
  { key: 'booked', label: 'Booked', filter: 'none', text: (j) => [clock(j.start), clock(j.end)].filter(Boolean).join(' – '), sortValue: (j) => j.start },
  { key: 'why', label: 'Why it is not counted', filter: 'choice', text: (j) => j.reason },
];

const UNBOOKED_COLUMNS: ControlColumn<WorkloadUnbooked>[] = [
  { key: 'job', label: 'Customer order no.', text: jobRef },
  { key: 'task', label: 'Task', text: (j) => j.taskName },
  { key: 'client', label: 'Client', filter: 'choice', text: (j) => j.client },
  { key: 'site', label: 'Site', text: (j) => j.site },
  { key: 'finished', label: 'Finished', filter: 'none', text: (j) => clock(j.completedAt), sortValue: (j) => j.completedAt },
  { key: 'by', label: 'Marked done by', filter: 'choice', text: (j) => j.completedBy },
];

const jobKey = (j: { jobNumber: string; taskName: string }) => `${j.jobNumber}|${j.taskName}`;

// The columns the Scheduled table and the Not done yet table both have, and
// that read the same in each: a filter on one of them in the Scheduled table
// narrows the jobs carried over from earlier days counted beside it too.
const SHARED_KEYS = ['worker', 'job', 'task', 'client', 'site', 'priority', 'aroflo'];
function sameFilters<R>(rows: R[], columns: ControlColumn<R>[], filters: Record<string, string>): R[] {
  const on = columns.filter((c) => SHARED_KEYS.includes(c.key) && (filters[c.key] || '').trim());
  return on.length ? rows.filter((r) => on.every((c) => matches(c, r, filters[c.key]))) : rows;
}

// Scheduled, by worker: their day's calendar, and — beside it — what they
// finished that day of what was carried over from earlier days.
interface ScheduledRow {
  worker: string;
  booked: number;
  done: number;
  open: number;
  hours: number;
  finishedFromEarlier: number;
  finishedInAll: number;
}
function scheduledRows(jobs: WorkloadJob[], carriedOver: WorkloadBacklogJob[]): ScheduledRow[] {
  const rows = new Map<string, ScheduledRow>();
  const finished = new Map<string, Set<string>>();
  const rowOf = (worker: string) => {
    if (!rows.has(worker)) rows.set(worker, { worker, booked: 0, done: 0, open: 0, hours: 0, finishedFromEarlier: 0, finishedInAll: 0 });
    return rows.get(worker)!;
  };
  const add = (a: number, b: number) => Math.round((a + (b || 0)) * 100) / 100;
  const finish = (worker: string, key: string) => finished.set(worker, new Set([...(finished.get(worker) ?? []), key]));
  for (const j of jobs) {
    const row = rowOf(j.worker);
    row.booked += 1;
    if (j.state === 'completed') {
      row.done += 1;
      // Finished in all is what was finished ON the day: not a job finished on an earlier day still on the calendar.
      if (j.doneHow !== 'earlier') finish(j.worker, jobKey(j));
    } else row.open += 1;
    row.hours = add(row.hours, j.hours);
  }
  for (const j of carriedOver) {
    if (j.state !== 'finished') continue;
    rowOf(j.worker).finishedFromEarlier += 1;
    finish(j.worker, jobKey(j));
  }
  for (const [worker, keys] of finished) rowOf(worker).finishedInAll = keys.size;
  return [...rows.values()].sort((a, b) => byName(a.worker, b.worker));
}

// Not done yet, by worker.
interface BacklogRow {
  worker: string;
  notDone: number;
  onDay: number;
  earlier: number;
  oldest: string;
  waitingLongest: number;
  finished: number;
}
function backlogRows(jobs: WorkloadBacklogJob[]): BacklogRow[] {
  const rows = new Map<string, BacklogRow>();
  for (const j of jobs) {
    const row = rows.get(j.worker) ?? { worker: j.worker, notDone: 0, onDay: 0, earlier: 0, oldest: '', waitingLongest: 0, finished: 0 };
    if (j.state === 'open') {
      row.notDone += 1;
      if (j.onDay) row.onDay += 1;
      else row.earlier += 1;
      if (!row.oldest || j.firstScheduled < row.oldest) row.oldest = j.firstScheduled;
      row.waitingLongest = Math.max(row.waitingLongest, j.daysWaiting);
    } else row.finished += 1;
    rows.set(j.worker, row);
  }
  return [...rows.values()].sort((a, b) => byName(a.worker, b.worker));
}

// A table's controls with the Show buttons' choice applied on top: what is
// listed (and downloaded) is the part picked; the counts above it are not.
function withShow<R>(controls: TableControls<R>, keep: ((r: R) => boolean) | null, clearShow: () => void): TableControls<R> {
  if (!keep) return controls;
  return { ...controls, rows: controls.rows.filter(keep), filtered: true, clear: () => (controls.clear(), clearShow()) };
}

function ShowButtons({ options, value, onPick, palette }: { options: { value: string; label: string; count: number }[]; value: string; onPick: (v: string) => void; palette: Palette }) {
  const line = `1px solid ${palette.border}`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px]" role="group" aria-label="Show" data-workload-show>
      <span style={{ color: palette.inkSecondary }}>Show</span>
      {options
        .filter((o) => o.value === '' || o.count > 0 || o.value === value)
        .map((o) => (
          <button
            key={o.value || 'all'}
            type="button"
            onClick={() => onPick(o.value)}
            aria-pressed={value === o.value}
            className="px-3 py-1 rounded-full font-semibold"
            style={{ background: value === o.value ? palette.accentBlue : palette.surface, color: value === o.value ? '#fff' : palette.inkPrimary, border: line }}
          >
            {o.label} <span className="tabular-nums font-normal">({o.count.toLocaleString()})</span>
          </button>
        ))}
    </div>
  );
}

// One table with its column headings (sort + filter), rows and "nothing matches".
function ControlledTable<R>({
  controls,
  palette,
  keyOf,
  cellStyle,
  empty,
  testId,
  maxHeight = 460,
}: {
  controls: TableControls<R>;
  palette: Palette;
  keyOf: (r: R, i: number) => string;
  cellStyle?: (key: string, r: R) => React.CSSProperties | undefined;
  empty?: string | null;
  testId: string;
  maxHeight?: number;
}) {
  const headCell = 'text-left px-3 py-2 font-semibold sticky top-0 z-10 align-top';
  const headStyle: React.CSSProperties = { color: palette.inkSecondary, background: palette.pagePlane };
  const columns = controls.columns;
  return (
    <div className="overflow-auto rounded-md" style={{ background: palette.surface, border: `1px solid ${palette.border}`, maxHeight }}>
      <table className="w-full text-[12px]" style={{ color: palette.inkPrimary }} {...{ [`data-${testId}`]: true }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} aria-sort={ariaSort(controls, c.key)} className={headCell} style={headStyle}>
                <ColumnHeading column={c} controls={controls} palette={palette} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {controls.rows.map((r, i) => (
            <tr key={keyOf(r, i)} style={{ background: i % 2 ? palette.pagePlane : 'transparent' }}>
              {columns.map((c) => (
                <td key={c.key} className={`px-3 py-1.5 ${c.align === 'right' ? 'text-right' : ''}`} style={cellStyle?.(c.key, r)}>
                  {c.text(r)}
                </td>
              ))}
            </tr>
          ))}
          <NoMatches controls={controls} palette={palette} span={columns.length} />
          {empty && controls.total === 0 && (
            <tr>
              <td colSpan={columns.length} className="px-3 py-3" style={{ color: palette.inkMuted }}>
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
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
  const [tab, setTab] = useState<Tab>('scheduled');
  const [showScheduled, setShowScheduled] = useState('');
  const [showBacklog, setShowBacklog] = useState('');
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
  const thatDay = when === 'today' ? 'today' : 'that day';
  const theDay = when === 'today' ? 'today' : formatDay(day);

  // Everyone with a job on either tab. A worker picked yesterday who has nothing today is simply not there to show.
  const names = useMemo(() => (data ? [...new Set([...data.jobs.map((j) => j.worker), ...data.backlog.jobs.map((j) => j.worker)])].sort(byName) : []), [data]);
  const picked = selected.filter((w) => names.includes(w));
  const pick = <R extends { worker: string }>(rows: R[]) => rows.filter((r) => picked.length === 0 || picked.includes(r.worker));
  const jobs = useMemo(() => pick(data?.jobs ?? []), [data, picked.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps
  const backlog = useMemo(() => pick(data?.backlog.jobs ?? []), [data, picked.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Scheduled ----
  const sColumns = useMemo(() => scheduledColumns(when), [when]);
  const sControls = useTableControls(jobs, sColumns);
  const bColumns = useMemo(() => backlogColumns(day, when), [day, when]);
  // The tiles and the table by worker count what the Worker picker and the
  // table's column filters leave — the carried-over jobs as well as the
  // day's; the Show buttons pick what is listed.
  const carriedOver = useMemo(() => sameFilters(backlog, bColumns, sControls.filters), [backlog, bColumns, sControls.filters]);
  const sRows = useMemo(() => scheduledRows(sControls.rows, carriedOver), [sControls.rows, carriedOver]);
  const sTotal = (key: keyof Omit<ScheduledRow, 'worker'>) => Math.round(sRows.reduce((n, r) => n + r[key], 0) * 100) / 100;
  const sKeep = showScheduled === 'done' ? (j: WorkloadJob) => j.state === 'completed' : showScheduled === 'open' ? (j: WorkloadJob) => j.state !== 'completed' : null;
  const sShown = withShow(sControls, sKeep, () => setShowScheduled(''));

  // ---- Not done yet ----
  const bControls = useTableControls(backlog, bColumns);
  const bRows = useMemo(() => backlogRows(bControls.rows), [bControls.rows]);
  const bTotal = (key: 'notDone' | 'onDay' | 'earlier' | 'finished') => bRows.reduce((n, r) => n + r[key], 0);
  const longest = bRows.reduce((m, r) => Math.max(m, r.waitingLongest), 0);
  const bKeep =
    showBacklog === 'open'
      ? (j: WorkloadBacklogJob) => j.state === 'open'
      : showBacklog === 'earlier'
        ? (j: WorkloadBacklogJob) => j.state === 'open' && !j.onDay
        : showBacklog === 'finished'
          ? (j: WorkloadBacklogJob) => j.state === 'finished'
          : null;
  const bShown = withShow(bControls, bKeep, () => setShowBacklog(''));

  const unbookedControls = useTableControls(data?.notBooked ?? [], UNBOOKED_COLUMNS);
  const notCountedControls = useTableControls(data?.notCounted ?? [], NOT_COUNTED_COLUMNS);

  const line = `1px solid ${palette.border}`;
  const headCell = 'text-left px-3 py-2 font-semibold sticky top-0 z-10 align-top';
  const headStyle: React.CSSProperties = { color: palette.inkSecondary, background: palette.pagePlane };
  const num = (n: number, good = false) => (
    <span style={{ color: good && n > 0 ? palette.statusGood : n === 0 ? palette.inkMuted : undefined, fontWeight: good && n > 0 ? 700 : 400 }}>{n}</span>
  );
  const workerButton = (worker: string) => {
    const only = picked.length === 1 && picked[0] === worker;
    return (
      <button
        type="button"
        onClick={() => setSelected(only ? [] : [worker])}
        title={only ? 'Show every worker again' : `Show only ${worker}’s jobs`}
        className="font-semibold underline-offset-2 hover:underline text-left"
        style={{ color: palette.inkPrimary }}
      >
        {worker}
      </button>
    );
  };
  const narrowedNote = (controls: TableControls<unknown>, counted: number) =>
    controls.filtered && (
      <p className="text-[12px] -mt-3" style={{ color: palette.inkSecondary }} data-workload-narrowed>
        Counting only the jobs the filters on the table below leave: {counted.toLocaleString()} of {controls.total.toLocaleString()}.{' '}
        <button type="button" onClick={controls.clear} className="underline font-semibold" style={{ color: palette.accentBlue }}>
          Clear filters
        </button>
      </p>
    );
  const tabButton = (id: Tab, label: string, count: number) => (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      onClick={() => setTab(id)}
      className="px-4 py-2 text-[13px] font-semibold -mb-px"
      style={{ color: tab === id ? palette.accentBlue : palette.inkSecondary, borderBottom: `2px solid ${tab === id ? palette.accentBlue : 'transparent'}` }}
      data-workload-tab={id}
    >
      {label} <span className="tabular-nums font-normal">({count.toLocaleString()})</span>
    </button>
  );

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
            What is scheduled to each field worker, what they have finished, and what is still waiting
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
                    ? `Calendar for ${dayName(day)}, as of ${formatInstant(meta.fetchedAt)}`
                    : `Nothing has been read from AroFlo for ${dayName(day)} yet. Press Update now to load it.`}
            </div>
            {data?.loaded && !updating && (
              <div data-workload-summary style={{ color: palette.statusGood, fontWeight: 600 }}>
                ✓ {data.totals.booked.toLocaleString()} jobs scheduled to {data.totals.workers.toLocaleString()} workers · {data.totals.done.toLocaleString()} done
                {data.totals.finishedFromEarlier > 0 && ` · ${data.totals.finishedFromEarlier.toLocaleString()} more finished from earlier days`}
                {` · ${data.totals.notDone.toLocaleString()} not done yet`}
              </div>
            )}
            <div style={{ color: palette.inkMuted }}>
              {meta?.pushEnabled ? 'Completions arrive from AroFlo as they happen. ' : 'Completions are as of the time above. '}
              {meta?.autoUpdateMinutes
                ? `Today is read from AroFlo every ${meta.autoUpdateMinutes} minutes by itself; press Update now to read it sooner.`
                : 'The calendar is read from AroFlo when the page is first opened each day; press Update now to pick up changes to it since.'}
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
              <b>Scheduled</b> — the job is in AroFlo’s calendar for that worker on that day. Whose a job is comes from the calendar and nothing
              else. A job scheduled to two people counts, and is listed, for each of them; scheduled to one person twice in a day, it counts once.
              A booking <b>hidden</b> on AroFlo’s calendar counts when its job is finished — AroFlo hides a job’s bookings once it’s done. On a
              job that isn’t finished it’s a follow-up with the tradie, not a job, and isn’t counted; it’s listed at the foot of the page with
              leave and equipment.
            </li>
            <li>
              <b>Done</b> — the job was marked Completed in AroFlo <i>on that day</i>. A job booked on Monday and finished on Tuesday is still to
              do on Monday’s page. A job whose substatus is <b>Ready for Invoicing</b> counts as done too, and so does one finished on an earlier
              day that is still on the calendar (“Completed earlier”).
            </li>
            <li>
              <b>Not done yet</b> — every job scheduled to someone in the {data?.backlog.days ?? 30} days up to and including the day that isn’t
              finished, on the list of whoever it was <i>most recently</i> scheduled to: a job moved from one person to another is the second
              person’s. It also shows the jobs carried over from earlier days that were finished on the day. <b>Finished in all</b> is everything
              a worker finished on the day: from the day’s calendar, and carried over from earlier days (a job already finished before the day
              isn’t in it, even if it is still on the calendar).
            </li>
            <li>
              <b>Whose clock.</b> {zoneName()} time: “today” and every time on the page are {zoneName()}’s, wherever the page is opened from.
            </li>
          </ul>
        </details>

        {data && !data.loaded && !updating && (
          <div className="rounded-md p-6 text-[13px]" style={{ background: 'rgba(2,132,199,0.08)', border: line, color: palette.inkSecondary }}>
            Nothing is loaded for {dayName(day)}. Press <b>Update now</b> at the top of the page.
          </div>
        )}

        {data?.loaded && (
          <>
            <div className="flex flex-wrap gap-1" role="tablist" style={{ borderBottom: line }}>
              {tabButton('scheduled', when === 'today' ? 'Scheduled today' : `Scheduled ${formatDay(day)}`, data.totals.booked)}
              {tabButton('backlog', 'Not done yet', data.totals.notDone)}
            </div>

            {tab === 'scheduled' ? (
              <>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" data-workload-tiles>
                  <KpiCard label="Workers" value={sRows.filter((r) => r.booked).length.toLocaleString()} pillText={dayName(day)} level="neutral" palette={palette} />
                  <KpiCard label="Scheduled" value={sTotal('booked').toLocaleString()} pillText="jobs on the calendar" level="neutral" palette={palette} />
                  <KpiCard label="Done" value={sTotal('done').toLocaleString()} pillText={`${share(sTotal('done'), sTotal('booked'))}% of scheduled`} level="good" palette={palette} />
                  <KpiCard label={stillToDo(when)} value={sTotal('open').toLocaleString()} pillText="of what was scheduled" level={when === 'past' && sTotal('open') > 0 ? 'warning' : 'neutral'} palette={palette} />
                  <KpiCard label="Finished from earlier days" value={sTotal('finishedFromEarlier').toLocaleString()} pillText={`carried over, finished ${thatDay}`} level="good" palette={palette} />
                  <KpiCard label="Finished in all" value={sTotal('finishedInAll').toLocaleString()} pillText={`finished ${thatDay}, scheduled or carried over`} level="good" palette={palette} />
                </div>
                {narrowedNote(sControls as TableControls<unknown>, sControls.rows.length)}

                <section className="space-y-2">
                  <h2 className="text-[1.05rem] font-semibold" style={{ color: palette.inkPrimary }}>
                    By worker
                  </h2>
                  {sRows.length === 0 ? (
                    <p className="text-[13px]" style={{ color: palette.inkMuted }}>
                      {jobs.length === 0 ? `Nothing is scheduled to anyone on ${dayName(day)}.` : 'No jobs match the filters on the table below.'}
                    </p>
                  ) : (
                    <div className="overflow-auto rounded-md" style={{ background: palette.surface, border: line, maxHeight: 460 }}>
                      <table className="w-full text-[12px]" style={{ color: palette.inkPrimary }} data-workload-workers>
                        <thead>
                          <tr>
                            {(
                              [
                                ['Worker', '', ''],
                                ['Scheduled', 'r', `Jobs on their calendar ${thatDay}`],
                                ['Done', 'r', 'Scheduled jobs that are done'],
                                [stillToDo(when), 'r', 'Scheduled jobs not done'],
                                ['Done %', '', 'Done out of scheduled'],
                                ['Finished from earlier days', 'r b', `Jobs carried over from earlier days’ calendars that they finished ${thatDay}`],
                                ['Finished in all', 'r b', `Everything they finished ${thatDay}: from the day’s calendar and carried over from earlier days`],
                                ['Booked (h)', 'r', 'Hours booked on the calendar'],
                              ] as const
                            ).map(([h, how, tip]) => (
                              <th key={h} title={tip || undefined} className={`${headCell} ${how.includes('r') ? 'text-right' : ''}`} style={{ ...headStyle, borderLeft: how.includes('b') ? line : undefined }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sRows.map((w, i) => {
                            const pct = share(w.done, w.booked);
                            return (
                              <tr key={w.worker} style={{ background: i % 2 ? palette.pagePlane : 'transparent' }}>
                                <td className="px-3 py-1.5">{workerButton(w.worker)}</td>
                                <td className="px-3 py-1.5 text-right">{num(w.booked)}</td>
                                <td className="px-3 py-1.5 text-right">{num(w.done, true)}</td>
                                <td className="px-3 py-1.5 text-right">{num(w.open)}</td>
                                <td className="px-3 py-1.5" style={{ minWidth: 140 }}>
                                  {w.booked > 0 ? (
                                    <div className="flex items-center gap-2">
                                      <div className="h-2 flex-1 rounded-full overflow-hidden" style={{ background: palette.border }} role="progressbar" aria-valuemin={0} aria-valuemax={w.booked} aria-valuenow={w.done} aria-label={`${w.worker}: ${w.done} of ${w.booked} scheduled jobs done`}>
                                        <div className="h-full" style={{ width: `${pct}%`, background: palette.statusGood }} />
                                      </div>
                                      <span className="tabular-nums" style={{ color: palette.inkSecondary, minWidth: 36, textAlign: 'right' }}>
                                        {pct}%
                                      </span>
                                    </div>
                                  ) : (
                                    <span style={{ color: palette.inkMuted }}>nothing scheduled</span>
                                  )}
                                </td>
                                <td className="px-3 py-1.5 text-right" style={{ borderLeft: line }}>{num(w.finishedFromEarlier, true)}</td>
                                <td className="px-3 py-1.5 text-right" style={{ borderLeft: line }}>{num(w.finishedInAll, true)}</td>
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
                      Scheduled {thatDay}{picked.length === 1 ? ` — ${picked[0]}` : ''}
                    </h2>
                    <div className="flex items-center gap-3">
                      <ControlSummary controls={sShown} palette={palette} noun="jobs" />
                      <DownloadCsv controls={sShown} palette={palette} name={`scheduled-${day}`} />
                    </div>
                  </div>
                  <ShowButtons
                    palette={palette}
                    value={showScheduled}
                    onPick={setShowScheduled}
                    options={[
                      { value: '', label: 'All', count: sControls.rows.length },
                      { value: 'done', label: 'Done', count: sControls.rows.filter((j) => j.state === 'completed').length },
                      { value: 'open', label: stillToDo(when), count: sControls.rows.filter((j) => j.state !== 'completed').length },
                    ]}
                  />
                  <ControlledTable
                    controls={sShown}
                    palette={palette}
                    testId="workload-jobs"
                    keyOf={(j) => `${j.worker}|${j.jobNumber}|${j.taskName}|${j.start}`}
                    empty="Nothing scheduled."
                    cellStyle={(key, j) => (key === 'state' ? { color: j.state === 'completed' ? palette.statusGood : when === 'past' ? palette.statusWarningText : palette.inkSecondary, fontWeight: 600 } : undefined)}
                  />
                </section>
              </>
            ) : (
              <>
                <p className="text-[12px]" style={{ color: palette.inkSecondary }}>
                  Every job scheduled to someone from {formatDay(data.backlog.from)} to {dayName(day)} that isn’t finished, on the list of whoever it
                  was last scheduled to — and the ones carried over from earlier days that were finished {thatDay}.
                  {data.backlog.calendarsKept < data.backlog.days &&
                    ` Only ${data.backlog.calendarsKept} of those ${data.backlog.days} earlier days’ calendars have been read so far, so some may be missing: press Update now.`}
                </p>
                <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3" data-workload-backlog-tiles>
                  <KpiCard label="Workers" value={bRows.filter((r) => r.notDone).length.toLocaleString()} pillText="with jobs not done" level="neutral" palette={palette} />
                  <KpiCard label="Not done" value={bTotal('notDone').toLocaleString()} pillText={`as of ${theDay}`} level={bTotal('notDone') > 0 ? 'warning' : 'good'} palette={palette} />
                  <KpiCard label={`On ${when === 'today' ? 'today’s' : 'that day’s'} calendar`} value={bTotal('onDay').toLocaleString()} pillText="of those not done" level="neutral" palette={palette} />
                  <KpiCard label="Carried over" value={bTotal('earlier').toLocaleString()} pillText="only on earlier days’ calendars" level={bTotal('earlier') > 0 ? 'warning' : 'neutral'} palette={palette} />
                  <KpiCard label="Finished from earlier days" value={bTotal('finished').toLocaleString()} pillText={`finished ${thatDay}`} level="good" palette={palette} />
                  <KpiCard label="Waiting longest" value={`${longest} day${longest === 1 ? '' : 's'}`} pillText="since first scheduled" level={longest > 7 ? 'warning' : 'neutral'} palette={palette} />
                </div>
                {narrowedNote(bControls as TableControls<unknown>, bControls.rows.length)}

                <section className="space-y-2">
                  <h2 className="text-[1.05rem] font-semibold" style={{ color: palette.inkPrimary }}>
                    By worker
                  </h2>
                  {bRows.length === 0 ? (
                    <p className="text-[13px]" style={{ color: palette.inkMuted }}>
                      {backlog.length === 0 ? 'Nothing scheduled is waiting to be done.' : 'No jobs match the filters on the table below.'}
                    </p>
                  ) : (
                    <div className="overflow-auto rounded-md" style={{ background: palette.surface, border: line, maxHeight: 460 }}>
                      <table className="w-full text-[12px]" style={{ color: palette.inkPrimary }} data-workload-backlog-workers>
                        <thead>
                          <tr>
                            {(
                              [
                                ['Worker', '', ''],
                                ['Not done', 'r', `Jobs last scheduled to them, from ${formatDay(data.backlog.from)} to ${theDay}, not finished`],
                                [`On ${when === 'today' ? 'today’s' : 'that day’s'} calendar`, 'r', 'Of those, on the day’s own calendar'],
                                ['Carried over', 'r', 'Of those, only on earlier days’ calendars'],
                                ['Waiting since', '', 'The first day the longest-waiting one was scheduled to them'],
                                ['Finished from earlier days', 'r b', `Carried over from earlier days and finished ${thatDay}`],
                              ] as const
                            ).map(([h, how, tip]) => (
                              <th key={h} title={tip || undefined} className={`${headCell} ${how.includes('r') ? 'text-right' : ''}`} style={{ ...headStyle, borderLeft: how.includes('b') ? line : undefined }}>
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {bRows.map((w, i) => (
                            <tr key={w.worker} style={{ background: i % 2 ? palette.pagePlane : 'transparent' }}>
                              <td className="px-3 py-1.5">{workerButton(w.worker)}</td>
                              <td className="px-3 py-1.5 text-right" style={{ fontWeight: w.notDone ? 700 : 400 }}>{num(w.notDone)}</td>
                              <td className="px-3 py-1.5 text-right">{num(w.onDay)}</td>
                              <td className="px-3 py-1.5 text-right" style={{ color: w.earlier ? palette.statusWarningText : undefined }}>{num(w.earlier)}</td>
                              <td className="px-3 py-1.5">{w.oldest ? `${formatDay(w.oldest)} (${w.waitingLongest} day${w.waitingLongest === 1 ? '' : 's'})` : ''}</td>
                              <td className="px-3 py-1.5 text-right" style={{ borderLeft: line }}>{num(w.finished, true)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-[1.05rem] font-semibold" style={{ color: palette.inkPrimary }}>
                      Not done yet{picked.length === 1 ? ` — ${picked[0]}` : ''}
                    </h2>
                    <div className="flex items-center gap-3">
                      <ControlSummary controls={bShown} palette={palette} noun="jobs" />
                      <DownloadCsv controls={bShown} palette={palette} name={`not-done-yet-${day}`} />
                    </div>
                  </div>
                  <ShowButtons
                    palette={palette}
                    value={showBacklog}
                    onPick={setShowBacklog}
                    options={[
                      { value: '', label: 'All', count: bControls.rows.length },
                      { value: 'open', label: 'Not done', count: bControls.rows.filter((j) => j.state === 'open').length },
                      { value: 'earlier', label: 'Carried over', count: bControls.rows.filter((j) => j.state === 'open' && !j.onDay).length },
                      { value: 'finished', label: `Finished ${thatDay}`, count: bControls.rows.filter((j) => j.state === 'finished').length },
                    ]}
                  />
                  <ControlledTable
                    controls={bShown}
                    palette={palette}
                    testId="workload-backlog"
                    keyOf={(j) => `${j.worker}|${j.jobNumber}|${j.taskName}`}
                    empty="Nothing scheduled is waiting to be done."
                    cellStyle={(key, j) =>
                      key === 'state'
                        ? { color: j.state === 'finished' ? palette.statusGood : j.onDay ? palette.inkSecondary : palette.statusWarningText, fontWeight: 600 }
                        : key === 'waiting' && j.daysWaiting > 7 && j.state === 'open'
                          ? { color: palette.statusWarningText, fontWeight: 700 }
                          : undefined
                    }
                  />
                </section>
              </>
            )}

            {data.notBooked.length > 0 && (
              <section className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[1.05rem] font-semibold" style={{ color: palette.inkPrimary }}>
                    Finished {thatDay}, on nobody’s calendar ({data.notBooked.length})
                  </h2>
                  <DownloadCsv controls={unbookedControls} palette={palette} name={`finished-not-scheduled-${day}`} />
                </div>
                <p className="text-[12px]" style={{ color: palette.inkMuted }}>
                  Done all the same, but not scheduled to anyone in the {data.backlog.days} days up to {theDay}, so it is on nobody’s list above. For every
                  worker, whatever the filters say.
                </p>
                <ControlledTable controls={unbookedControls} palette={palette} testId="workload-not-booked" maxHeight={320} keyOf={(j, i) => `${j.jobNumber}|${j.taskName}|${i}`} />
              </section>
            )}

            {data.notCounted.length > 0 && (
              <section className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-[1.05rem] font-semibold" style={{ color: palette.inkPrimary }}>
                    On the calendar {thatDay}, not counted ({data.notCounted.length})
                  </h2>
                  <DownloadCsv controls={notCountedControls} palette={palette} name={`not-counted-${day}`} />
                </div>
                <p className="text-[12px]" style={{ color: palette.inkMuted }}>
                  Every other booking AroFlo has for the day — hidden follow-ups, leave, equipment — and why it isn’t in the figures above. For every
                  worker, whatever the filters say.
                </p>
                <ControlledTable controls={notCountedControls} palette={palette} testId="workload-not-counted" maxHeight={320} keyOf={(j, i) => `${j.worker}|${j.taskName}|${j.start}|${i}`} />
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
};
