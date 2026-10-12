import React, { useMemo, useState } from 'react';
import { Plot, baseLayout, headroom, PLOT_CONFIG } from '../plotly';
import { Palette, clientColors, COMPLETED_STATUSES } from '../theme';
import { ReportTask, ColorOverrides } from '../types';
import { EditScope } from '../../services/reportingEdits';
import { ChartCard } from '../components/ChartCard';
import { ChartEmpty } from '../components/ChartEmpty';

interface ClientComparisonChartProps {
  tasks: ReportTask[];
  targetClients: Record<string, string>; // {realClientName: shortLabel}, e.g. Ventia/SAHA — literal, see cosmic-tumbling-pearl.md
  palette: Palette;
  stateKey: string;
  scope: EditScope;
}

const METRICS = ['Issued', 'Completed', 'Outstanding'] as const;

// Ported from aroflo_dash's render_client_comparison_chart — "SAHA vs.
// Ventia", grouped bar, Issued/Completed/Outstanding per client. Only shown
// in the Overall view (see ReportingDashboardView). Deliberately kept
// literal to the two configured target clients (not generalized to every
// real client — that's what the page's own client filter is for).
export const ClientComparisonChart: React.FC<ClientComparisonChartProps> = ({ tasks, targetClients, palette, stateKey, scope }) => {
  const shortLabels = Object.values(targetClients);
  const defaultColors = clientColors(palette);
  const [colors, setColors] = useState<ColorOverrides>(defaultColors);

  const series = useMemo(() => {
    return Object.entries(targetClients).map(([fullName, shortLabel]) => {
      const clientTasks = tasks.filter((t) => t.client === fullName);
      const issued = clientTasks.length;
      const completed = clientTasks.filter((t) => COMPLETED_STATUSES.has(t.status)).length;
      return { shortLabel, values: { Issued: issued, Completed: completed, Outstanding: issued - completed } };
    });
  }, [tasks, targetClients]);

  const max = Math.max(0, ...series.flatMap((s) => Object.values(s.values)));

  if (max === 0) {
    return <ChartEmpty palette={palette} title="SAHA vs. Ventia" message="No work orders for the configured target clients in this range." />;
  }

  return (
    <ChartCard
      stateKey={stateKey}
      scope={scope}
      categories={shortLabels}
      defaultColors={defaultColors}
      palette={palette}
      onColorsChange={setColors}
    >
      <Plot
        data={series.map((s) => ({
          type: 'bar' as const,
          name: s.shortLabel,
          x: [...METRICS],
          y: METRICS.map((m) => s.values[m]),
          text: METRICS.map((m) => String(s.values[m])),
          textposition: 'outside' as const,
          marker: { color: colors[s.shortLabel] || defaultColors[s.shortLabel] },
        }))}
        layout={{
          ...baseLayout(palette, { title: 'SAHA vs. Ventia', hasLegend: true }),
          barmode: 'group',
          yaxis: { ...baseLayout(palette, { title: '' }).yaxis, range: [0, headroom(max)] },
        }}
        config={PLOT_CONFIG}
        style={{ width: '100%', height: 320 }}
        useResizeHandler
      />
    </ChartCard>
  );
};
