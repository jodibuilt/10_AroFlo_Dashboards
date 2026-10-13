import React, { useEffect, useRef, useState } from 'react';
import { Palette } from '../theme';
import { AroFloStatus, fetchAroFloStatus, formatCoverage, startAroFloRefresh } from '../../services/reportingRefresh';
import { formatInstant } from '../time';

interface Props {
  palette: Palette;
  // Called once a refresh has finished, so the page can re-read its data.
  onRefreshed: () => void;
  // Called with the first day the loaded data covers, whenever it is learnt.
  onCoverage?: (coverageFrom: string | null) => void;
}

const ZONE_NAMES: Record<string, string> = {
  priorities: 'Priorities',
  jobs: 'Work orders',
  invoices: 'Invoices',
  payments: 'Payments',
};
// The order the server loads them in (src/cache.js).
const ZONE_ORDER = ['priorities', 'jobs', 'invoices', 'payments'];

// In the reports' time zone (Adelaide), with the zone said — not in whatever
// the browser is set to.
const when = formatInstant;

// The one place AroFlo data gets reloaded. The server never fetches on its
// own — AroFlo's daily request allowance is shared with other tools — so
// this bar says how old the data is and has the button that reloads it.
// What a refresh costs and how much allowance is left go to the server log,
// not here; the bar only mentions the allowance when it has paused a refresh.
export const RefreshControl: React.FC<Props> = ({ palette, onRefreshed, onCoverage }) => {
  const [status, setStatus] = useState<AroFloStatus | null>(null);
  const coverageFrom = status?.coverageFrom ?? null;
  const months = status?.lookbackMonths ?? 0;
  const reach = months > 0 ? `up to ${months} month${months === 1 ? '' : 's'} back` : 'this month';

  useEffect(() => {
    onCoverage?.(coverageFrom);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coverageFrom]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // lastRefreshCompletedAt as it was before the refresh being waited on.
  const before = useRef<string | null>(null);

  useEffect(() => {
    fetchAroFloStatus()
      .then((s) => {
        setStatus(s);
        // Someone else may have started one already.
        if (s.isRefreshingAll) {
          before.current = s.lastRefreshCompletedAt;
          setRefreshing(true);
        }
      })
      .catch(() => {});
  }, []);

  // While a refresh runs, watch for it to finish.
  useEffect(() => {
    if (!refreshing) return;
    let stopped = false;
    let timer: number;
    const deadline = Date.now() + 5 * 60 * 1000;
    const check = async () => {
      try {
        const s = await fetchAroFloStatus();
        if (stopped) return;
        setStatus(s);
        if (!s.isRefreshingAll && s.lastRefreshCompletedAt !== before.current) {
          setRefreshing(false);
          onRefreshed();
          return;
        }
      } catch {
        /* keep waiting */
      }
      if (stopped) return;
      if (Date.now() > deadline) {
        setRefreshing(false);
        setError('The refresh is taking longer than expected. Check back in a minute.');
        return;
      }
      timer = window.setTimeout(check, 2000);
    };
    timer = window.setTimeout(check, 1500);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshing]);

  async function refresh() {
    setError(null);
    before.current = status?.lastRefreshCompletedAt ?? null;
    try {
      await startAroFloRefresh();
      setRefreshing(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the refresh.');
    }
  }

  const loaded = Boolean(status?.lastRefreshCompletedAt);
  // One line per distinct problem, naming every zone that has it — a paused
  // refresh gives several zones the same message.
  const zonesByError = new Map<string, string[]>();
  for (const [key, z] of Object.entries(status?.zones ?? {})) {
    if (z.error) zonesByError.set(z.error, [...(zonesByError.get(z.error) ?? []), ZONE_NAMES[key] ?? key]);
  }
  const problems = [...zonesByError].map(([message, zones]) => `${zones.join(', ')}: ${message}`);
  const warnings = Object.entries(status?.zones ?? {})
    .filter(([, z]) => z.warning)
    .map(([key, z]) => `${ZONE_NAMES[key] ?? key}: ${z.warning}`);

  let headline: string;
  if (refreshing) headline = 'Refreshing from AroFlo — this takes about a minute…';
  else if (!status) headline = 'Checking what is loaded…';
  else if (loaded) headline = `AroFlo data as of ${when(status.lastRefreshCompletedAt as string)}`;
  else headline = 'Nothing has been loaded from AroFlo since the server started. Press Refresh to load it.';

  // How far the load has got, one step per thing AroFlo is asked for, in the
  // order the server asks. A step is done once it has been fetched since
  // this refresh began.
  const startedAt = status?.refreshStartedAt ?? null;
  const steps = ZONE_ORDER.map((key) => {
    const z = status?.zones[key];
    const done = Boolean(z?.lastFetchedAt && startedAt && z.lastFetchedAt >= startedAt);
    return { key, name: ZONE_NAMES[key], count: z?.count ?? 0, done, loading: Boolean(z?.isRefreshing) };
  });
  const doneCount = steps.filter((s) => s.done).length;
  const current = steps.find((s) => s.loading) ?? steps.find((s) => !s.done);
  // Everything the reports need is in, with nothing failed or cut short.
  const allLoaded = loaded && steps.every((s) => status?.zones[s.key]?.lastFetchedAt) && problems.length === 0 && warnings.length === 0;
  const counts = steps
    .filter((s) => s.key !== 'priorities')
    .map((s) => `${s.count.toLocaleString()} ${s.name.toLowerCase()}`)
    .join(' · ');

  // The button keeps its place at the right of the bar however long the text
  // beside it gets — the text wraps, the button doesn't drop under it. Only
  // on a phone-width screen does it go on its own line.
  return (
    <div
      className="rounded-md px-4 py-3 flex flex-wrap sm:flex-nowrap items-center justify-between gap-3"
      style={{
        background: loaded || refreshing || !status ? palette.surface : 'rgba(2,132,199,0.08)',
        border: `1px solid ${palette.border}`,
      }}
    >
      <div className="min-w-0 flex-1 basis-full sm:basis-0 text-[12px]">
        <div className="text-[13px] font-semibold" style={{ color: palette.inkPrimary }} role="status" aria-live="polite">
          {headline}
        </div>
        {/* While it loads: a bar, and which of the four things it is on. */}
        {refreshing && (
          <div className="mt-1.5 mb-1" data-load-progress>
            <div
              className="h-1.5 rounded-full overflow-hidden"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={steps.length}
              aria-valuenow={doneCount}
              aria-label="Loading from AroFlo"
              style={{ background: palette.border, maxWidth: 360 }}
            >
              <div className="h-full transition-[width] duration-500" style={{ width: `${(doneCount / steps.length) * 100}%`, background: palette.accentBlue }} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5" style={{ color: palette.inkSecondary }}>
              <span>
                Loaded {doneCount} of {steps.length}
                {current ? ` — now ${current.name.toLowerCase()}` : ''}
              </span>
              {steps.map((s) => (
                <span key={s.key} style={{ color: s.done ? palette.statusGood : s.loading ? palette.inkPrimary : palette.inkMuted, fontWeight: s.loading ? 600 : 400 }}>
                  {s.done ? '✓' : s.loading ? '…' : '○'} {s.name}
                </span>
              ))}
            </div>
          </div>
        )}
        {/* Once it is in: say so, with how much, so nobody wonders whether
            the page is still filling. */}
        {!refreshing && loaded && (
          <div data-load-summary style={{ color: allLoaded ? palette.statusGood : palette.statusWarningText, fontWeight: 600 }}>
            {allLoaded ? `✓ All data loaded: ${counts}` : `Not everything loaded — see below. Have: ${counts}`}
          </div>
        )}
        <div style={{ color: palette.inkMuted }}>
          {/* What the reports can't see is as important as how fresh they
              are: nothing before this day is in any figure on the page. */}
          {coverageFrom &&
            `Covers ${reach} only: work orders requested, and invoices raised, since ${formatCoverage(coverageFrom)}. Anything older is not in these reports. `}
          Data only reloads when someone presses Refresh — and each refresh uses a daily AroFlo allowance shared with other
          tools, so refresh when you need new figures, not repeatedly.
        </div>
        {problems.map((p) => (
          <div key={p} style={{ color: palette.statusCritical }}>
            {p}
          </div>
        ))}
        {warnings.map((w) => (
          <div key={w} style={{ color: palette.statusWarningText }}>
            {w}
          </div>
        ))}
        {error && <div style={{ color: palette.statusCritical }}>{error}</div>}
      </div>
      <button
        type="button"
        onClick={refresh}
        disabled={refreshing || !status}
        className="px-3 py-1.5 rounded-md text-[12px] font-semibold inline-flex items-center gap-1 shrink-0 disabled:opacity-60"
        style={{ background: palette.accentBlue, color: '#fff' }}
      >
        <span className={`material-symbols-outlined text-[16px] ${refreshing ? 'animate-spin' : ''}`} aria-hidden="true">
          {refreshing ? 'progress_activity' : 'refresh'}
        </span>
        {refreshing ? 'Refreshing…' : 'Refresh from AroFlo'}
      </button>
    </div>
  );
};
