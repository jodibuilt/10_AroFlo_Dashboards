import React, { useEffect, useMemo, useState } from 'react';
import { Plot, baseLayout, PLOT_CONFIG } from '../plotly';
import { Palette } from '../theme';
import { KpiCard, rateLevel } from '../components/KpiCard';
import { OverdueAgeingResponse } from '../types';
import { fetchOverdueAgeing } from '../../services/reportingOverdue';

interface Props {
  palette: Palette;
  striped: boolean;
  view: string;
}

const BUCKET_ORDER = ['0-7', '8-14', '15-30', '30+'];

function bucketColor(key: string, palette: Palette): string {
  switch (key) {
    case '0-7':
      return palette.statusWarning;
    case '8-14':
      return palette.statusSerious;
    case '15-30':
      return palette.statusCritical;
    default:
      return '#7a1a1a';
  }
}

function fmtDate(v: string | null): string {
  if (!v) return '';
  const d = new Date(v.replace(/\//g, '-'));
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const OverdueAgeingSection: React.FC<Props> = ({ palette, striped, view }) => {
  const [data, setData] = useState<OverdueAgeingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [priorityFilter, setPriorityFilter] = useState<string>('__all__');

  useEffect(() => {
    let cancelled = false;
    fetchOverdueAgeing(view)
      .then((res) => {
        if (cancelled) return;
        setData(res);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : 'Failed to load'));
    return () => {
      cancelled = true;
    };
  }, [view]);

  const d = data?.data;

  const priorities = useMemo(() => (d ? d.byPriority.map((p) => p.priority) : []), [d]);
  const shownRows = useMemo(() => {
    if (!d) return [];
    return priorityFilter === '__all__' ? d.rows : d.rows.filter((r) => r.priority === priorityFilter);
  }, [d, priorityFilter]);

  const cardStyle: React.CSSProperties = { background: palette.surface, border: `1px solid ${palette.border}` };

  return (
    <div>
      <h2
        className="text-[1.05rem] font-semibold pb-1 mb-1"
        style={{ borderBottom: `1px solid ${palette.border}`, color: palette.inkPrimary }}
      >
        Overdue &amp; Ageing Work
      </h2>
      <p className="text-[12px] mb-3" style={{ color: palette.inkMuted }}>
        Open work orders past their due date{data ? `, as of ${data.meta.today}` : ''}. Not affected by the date range
        above — this is “what’s outstanding right now”. Honours the client filter.
      </p>

      {error && (
        <div className="p-3 rounded-md text-[13px] mb-3" style={{ background: 'rgba(220,38,38,0.10)', color: palette.statusCritical }}>
          {error}
        </div>
      )}

      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <KpiCard
              label="Overdue work orders"
              value={d.total.toLocaleString()}
              level={d.total === 0 ? 'good' : 'critical'}
              pillText={d.total === 0 ? 'none outstanding' : 'past due'}
              palette={palette}
            />
            <KpiCard
              label="Oldest"
              value={d.oldestDays === null ? '—' : `${d.oldestDays}d`}
              level={rateLevel(d.oldestDays ?? 0, 7, 30, false)}
              pillText="overdue"
              palette={palette}
            />
            <KpiCard
              label="15–30 days"
              value={String(d.buckets.find((b) => b.key === '15-30')?.count ?? 0)}
              level="warning"
              palette={palette}
            />
            <KpiCard
              label="30+ days"
              value={String(d.buckets.find((b) => b.key === '30+')?.count ?? 0)}
              level={(d.buckets.find((b) => b.key === '30+')?.count ?? 0) > 0 ? 'critical' : 'good'}
              palette={palette}
            />
          </div>

          {d.total === 0 ? (
            <div className="rounded-md p-4 text-[13px]" style={{ ...cardStyle, color: palette.inkSecondary }}>
              No overdue work orders in this selection.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
                {/* Stacked bar: priority x ageing bucket */}
                <div className="rounded-md p-4" style={cardStyle}>
                  <Plot
                    data={BUCKET_ORDER.map((key) => {
                      const label = d.buckets.find((b) => b.key === key)?.label ?? key;
                      return {
                        type: 'bar' as const,
                        orientation: 'h' as const,
                        name: label,
                        y: d.byPriority.map((p) => p.priority),
                        x: d.byPriority.map((p) => Number(p[key] ?? 0)),
                        marker: { color: bucketColor(key, palette) },
                        hovertemplate: `%{y} · ${label}: %{x}<extra></extra>`,
                      };
                    })}
                    layout={{
                      ...baseLayout(palette, { title: 'Overdue by priority and age', hasLegend: true }),
                      barmode: 'stack',
                      xaxis: { ...baseLayout(palette, { title: '' }).xaxis, title: { text: 'Work orders', standoff: 12 } },
                      yaxis: { ...baseLayout(palette, { title: '' }).yaxis, automargin: true },
                    }}
                    config={PLOT_CONFIG}
                    style={{ width: '100%', height: Math.max(260, d.byPriority.length * 46 + 130) }}
                    useResizeHandler
                  />
                </div>

                {/* By site */}
                <div className="rounded-md p-4" style={cardStyle}>
                  <Plot
                    data={[
                      {
                        type: 'bar',
                        orientation: 'h',
                        x: d.bySite.slice(0, 12).map((s) => s.total).reverse(),
                        y: d.bySite.slice(0, 12).map((s) => s.site).reverse(),
                        marker: { color: palette.catBlue },
                        text: d.bySite.slice(0, 12).map((s) => String(s.total)).reverse(),
                        textposition: 'outside',
                        hovertemplate: '%{y}: %{x} overdue<extra></extra>',
                      },
                    ]}
                    layout={{
                      ...baseLayout(palette, { title: 'Overdue by site (top 12)' }),
                      xaxis: { ...baseLayout(palette, { title: '' }).xaxis, title: { text: 'Work orders', standoff: 12 } },
                      yaxis: { ...baseLayout(palette, { title: '' }).yaxis, automargin: true },
                    }}
                    config={PLOT_CONFIG}
                    style={{ width: '100%', height: Math.max(260, Math.min(d.bySite.length, 12) * 34 + 130) }}
                    useResizeHandler
                  />
                </div>
              </div>

              {/* Detail table */}
              <div className="flex items-center gap-2 mb-2">
                <label className="text-[12px]" style={{ color: palette.inkSecondary }}>
                  Priority
                </label>
                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  className="px-2 py-1 rounded-md text-[12px]"
                  style={{ background: palette.surface, border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
                >
                  <option value="__all__">All ({d.rows.length})</option>
                  {priorities.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div className="overflow-auto rounded-md" style={{ border: `1px solid ${palette.border}`, maxHeight: 460 }}>
                <table className="w-full text-[12px]" style={{ color: palette.inkPrimary }}>
                  <thead>
                    <tr>
                      {['Job', 'Task', 'Priority', 'Client', 'Site', 'Due', 'Days overdue', 'Status'].map((h) => (
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
                    {shownRows.map((r, i) => (
                      <tr key={r.taskId || `${r.jobNumber}-${i}`} style={{ background: striped && i % 2 ? palette.pagePlane : 'transparent' }}>
                        <td className="px-3 py-1.5">{r.jobNumber}</td>
                        <td className="px-3 py-1.5">{r.taskName}</td>
                        <td className="px-3 py-1.5">{r.priority}</td>
                        <td className="px-3 py-1.5">{r.client}</td>
                        <td className="px-3 py-1.5">{r.site}</td>
                        <td className="px-3 py-1.5">{fmtDate(r.dueDate)}</td>
                        <td
                          className="px-3 py-1.5 text-right"
                          style={{ color: palette.statusCritical, fontWeight: 700, background: 'rgba(220,38,38,0.10)' }}
                        >
                          {r.daysOverdue ?? '—'}
                        </td>
                        <td className="px-3 py-1.5">{r.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
};
