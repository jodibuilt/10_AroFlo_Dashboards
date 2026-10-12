import React, { useMemo, useState } from 'react';
import { Plot, baseLayout, PLOT_CONFIG } from '../plotly';
import { Palette, LIGHT } from '../theme';
import { ReportTask, ColorOverrides } from '../types';
import { EditScope } from '../../services/reportingEdits';
import { ChartCard } from '../components/ChartCard';
import { ChartEmpty } from '../components/ChartEmpty';

function toDayKey(d: string | null): string | null {
  return d ? d.slice(0, 10).replace(/-/g, '/') : null;
}

function cumulativeByDay(dates: string[], allDays: string[]): number[] {
  const counts = new Map<string, number>();
  for (const d of dates) counts.set(d, (counts.get(d) || 0) + 1);
  let running = 0;
  return allDays.map((day) => {
    running += counts.get(day) || 0;
    return running;
  });
}

interface TrendChartProps {
  tasks: ReportTask[];
  palette: Palette;
  stateKey: string;
  scope: EditScope;
}

// Ported from aroflo_dash's render_trend_chart — "Issued vs. Completed
// (Cumulative)" line chart, one point per calendar day from the earliest to
// latest requestDate in scope. Default colors are LIGHT.catBlue/catAqua
// specifically (aroflo_dash pins these two series to the LIGHT palette even
// in dark mode — see charts.py) unless overridden via the color picker.
export const TrendChart: React.FC<TrendChartProps> = ({ tasks, palette, stateKey, scope }) => {
  const defaultColors = { 'Issued (cumulative)': LIGHT.catBlue, 'Completed (cumulative)': LIGHT.catAqua };
  const [colors, setColors] = useState<ColorOverrides>(defaultColors);

  const { days, issued, completed } = useMemo(() => {
    const requestDays = tasks.map((t) => toDayKey(t.requestDate)).filter((d): d is string => Boolean(d));
    const completedDays = tasks.map((t) => toDayKey(t.completedDate)).filter((d): d is string => Boolean(d));
    if (requestDays.length === 0) return { days: [], issued: [], completed: [] };

    const allKnown = [...requestDays, ...completedDays].sort();
    const min = allKnown[0];
    const max = allKnown[allKnown.length - 1];
    const allDays: string[] = [];
    for (let d = new Date(min.replace(/\//g, '-')); d <= new Date(max.replace(/\//g, '-')); d.setDate(d.getDate() + 1)) {
      allDays.push(d.toISOString().slice(0, 10).replace(/-/g, '/'));
    }
    return {
      days: allDays,
      issued: cumulativeByDay(requestDays, allDays),
      completed: cumulativeByDay(completedDays, allDays),
    };
  }, [tasks]);

  if (days.length === 0) {
    return <ChartEmpty palette={palette} title="Issued vs. Completed (Cumulative)" message="No work orders with a request date in this range." />;
  }

  return (
    <ChartCard
      stateKey={stateKey}
      scope={scope}
      categories={Object.keys(defaultColors)}
      defaultColors={defaultColors}
      palette={palette}
      onColorsChange={setColors}
    >
      <Plot
        data={[
          { x: days, y: issued, mode: 'lines', name: 'Issued (cumulative)', line: { color: colors['Issued (cumulative)'], width: 2 } },
          { x: days, y: completed, mode: 'lines', name: 'Completed (cumulative)', line: { color: colors['Completed (cumulative)'], width: 2 } },
        ]}
        layout={{ ...baseLayout(palette, { title: 'Issued vs. Completed (Cumulative)', hasLegend: true }), hovermode: 'x unified' }}
        config={PLOT_CONFIG}
        style={{ width: '100%', height: 320 }}
        useResizeHandler
      />
    </ChartCard>
  );
};
