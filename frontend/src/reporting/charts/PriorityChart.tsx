import React, { useMemo, useState } from 'react';
import { Plot, baseLayout, headroom, PLOT_CONFIG } from '../plotly';
import { Palette, PRIORITY_ORDER } from '../theme';
import { ReportTask, ColorOverrides } from '../types';
import { EditScope } from '../../services/reportingEdits';
import { ChartCard } from '../components/ChartCard';
import { ChartEmpty } from '../components/ChartEmpty';

interface PriorityChartProps {
  tasks: ReportTask[];
  palette: Palette;
  stateKey: string;
  scope: EditScope;
}

// Ported from aroflo_dash's render_priority_chart — "Work Orders by
// Priority", fixed P1..PM order, zero-filled. Only tasks whose priority
// successfully mapped to a P-code count here (unmapped ones are already
// excluded server-side — see views.js buildReportingKpis).
export const PriorityChart: React.FC<PriorityChartProps> = ({ tasks, palette, stateKey, scope }) => {
  const defaultColors = palette.priorityColors;
  const [colors, setColors] = useState<ColorOverrides>(defaultColors);

  const counts = useMemo(() => {
    const byPriority = new Map<string, number>();
    for (const p of PRIORITY_ORDER) byPriority.set(p, 0);
    for (const t of tasks) if (t.priority) byPriority.set(t.priority, (byPriority.get(t.priority) || 0) + 1);
    return PRIORITY_ORDER.map((p) => byPriority.get(p) || 0);
  }, [tasks]);

  const max = Math.max(0, ...counts);

  if (max === 0) {
    return <ChartEmpty palette={palette} title="Work Orders by Priority" message="No work orders with a mapped priority in this range." />;
  }

  return (
    <ChartCard
      stateKey={stateKey}
      scope={scope}
      categories={PRIORITY_ORDER}
      defaultColors={defaultColors}
      palette={palette}
      onColorsChange={setColors}
    >
      <Plot
        data={[
          {
            type: 'bar',
            x: PRIORITY_ORDER,
            y: counts,
            text: counts.map(String),
            textposition: 'outside',
            marker: { color: PRIORITY_ORDER.map((p) => colors[p] || defaultColors[p]) },
          },
        ]}
        layout={{
          ...baseLayout(palette, { title: 'Work Orders by Priority' }),
          yaxis: { ...baseLayout(palette, { title: '' }).yaxis, range: [0, headroom(max)] },
        }}
        config={PLOT_CONFIG}
        style={{ width: '100%', height: 320 }}
        useResizeHandler
      />
    </ChartCard>
  );
};
