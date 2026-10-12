import React, { useMemo, useState } from 'react';
import { Plot, baseLayout, headroom, PLOT_CONFIG } from '../plotly';
import { Palette, statusColors, fallbackColorCycle } from '../theme';
import { ReportTask, ColorOverrides } from '../types';
import { EditScope } from '../../services/reportingEdits';
import { ChartCard } from '../components/ChartCard';
import { ChartEmpty } from '../components/ChartEmpty';

const KNOWN_ORDER = ['Completed', 'In Progress', 'Scheduled', 'On Hold', 'Awaiting Approval'];

interface StatusChartProps {
  tasks: ReportTask[];
  palette: Palette;
  stateKey: string;
  scope: EditScope;
}

// Ported from aroflo_dash's render_status_chart — "Work Orders by Status",
// horizontal bar, known statuses first (in status_colors' order) then any
// other status this account uses, y-axis reversed so the top status is
// visually first.
export const StatusChart: React.FC<StatusChartProps> = ({ tasks, palette, stateKey, scope }) => {
  const known = statusColors(palette);
  const cycle = fallbackColorCycle(palette);

  const { statuses, counts, defaultColors } = useMemo(() => {
    const byStatus = new Map<string, number>();
    for (const t of tasks) byStatus.set(t.status, (byStatus.get(t.status) || 0) + 1);
    const others = [...byStatus.keys()].filter((s) => !KNOWN_ORDER.includes(s)).sort();
    const order = [...KNOWN_ORDER.filter((s) => byStatus.has(s)), ...others];
    const dc: Record<string, string> = {};
    let cycleIdx = 0;
    for (const s of order) dc[s] = known[s] || cycle[cycleIdx++ % cycle.length];
    return { statuses: order, counts: order.map((s) => byStatus.get(s) || 0), defaultColors: dc };
  }, [tasks, palette]);

  const [colors, setColors] = useState<ColorOverrides>(defaultColors);
  const max = Math.max(0, ...counts);

  if (statuses.length === 0) {
    return <ChartEmpty palette={palette} title="Work Orders by Status" />;
  }

  return (
    <ChartCard
      stateKey={stateKey}
      scope={scope}
      categories={statuses}
      defaultColors={defaultColors}
      palette={palette}
      onColorsChange={setColors}
    >
      <Plot
        data={[
          {
            type: 'bar',
            orientation: 'h',
            y: statuses,
            x: counts,
            text: counts.map(String),
            textposition: 'outside',
            marker: { color: statuses.map((s) => colors[s] || defaultColors[s]) },
          },
        ]}
        layout={{
          ...baseLayout(palette, { title: 'Work Orders by Status' }),
          xaxis: { ...baseLayout(palette, { title: '' }).xaxis, range: [0, headroom(max)] },
          yaxis: { ...baseLayout(palette, { title: '' }).yaxis, autorange: 'reversed', showgrid: false },
        }}
        config={PLOT_CONFIG}
        style={{ width: '100%', height: 320 }}
        useResizeHandler
      />
    </ChartCard>
  );
};
