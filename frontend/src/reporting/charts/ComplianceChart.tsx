import React, { useState } from 'react';
import { Plot, baseLayout, PLOT_CONFIG } from '../plotly';
import { Palette, PRIORITY_ORDER, kpiTargetDefaultColors, LevelLabels, levelLabel } from '../theme';
import { ComplianceRow, ColorOverrides } from '../types';
import { EditScope } from '../../services/reportingEdits';
import { ChartCard } from '../components/ChartCard';

interface ComplianceChartProps {
  rows: ComplianceRow[];
  palette: Palette;
  stateKey: string;
  scope: EditScope;
  // What to print under a bar instead of its level's code ("P4/P5").
  labels?: LevelLabels | null;
}

// Ported from aroflo_dash's render_kpi_target_chart — "Actual vs. Target KPI
// Compliance by Priority": Met/Below-Target bars (Actual %) + a diamond
// scatter marker per priority at Target %. X order forced to P1..PM,
// filtered to priorities actually present; fixed y-range [0, 118].
export const ComplianceChart: React.FC<ComplianceChartProps> = ({ rows, palette, stateKey, scope, labels }) => {
  const defaultColors = kpiTargetDefaultColors(palette);
  const [colors, setColors] = useState<ColorOverrides>(defaultColors);

  // A priority with nothing finished or overdue yet has no percentage to
  // draw — it is all in progress — so it has no bar.
  const scored = rows.filter((r): r is ComplianceRow & { actualPercent: number } => r.actualPercent !== null);
  const order = PRIORITY_ORDER.filter((p) => scored.some((r) => r.priority === p));
  const byPriority = new Map(scored.map((r) => [r.priority, r]));
  const met = order.filter((p) => byPriority.get(p)?.status === 'Met');
  const below = order.filter((p) => byPriority.get(p)?.status === 'Below Target');

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
          {
            type: 'bar',
            name: 'Met Target',
            x: met,
            y: met.map((p) => byPriority.get(p)!.actualPercent),
            text: met.map((p) => `${byPriority.get(p)!.actualPercent.toFixed(0)}%`),
            textposition: 'outside',
            marker: { color: colors['Met Target'] || defaultColors['Met Target'] },
          },
          {
            type: 'bar',
            name: 'Below Target',
            x: below,
            y: below.map((p) => byPriority.get(p)!.actualPercent),
            text: below.map((p) => `${byPriority.get(p)!.actualPercent.toFixed(0)}%`),
            textposition: 'outside',
            marker: { color: colors['Below Target'] || defaultColors['Below Target'] },
          },
          {
            type: 'scatter',
            mode: 'markers',
            name: 'Target',
            x: order,
            y: order.map((p) => byPriority.get(p)!.targetPercent),
            marker: {
              symbol: 'diamond',
              size: 12,
              color: colors.Target || defaultColors.Target,
              line: { width: 1, color: palette.surface },
            },
          },
        ]}
        layout={{
          ...baseLayout(palette, { title: 'Actual vs. Target KPI Compliance by Priority', hasLegend: true }),
          xaxis: {
            ...baseLayout(palette, { title: '' }).xaxis,
            categoryorder: 'array',
            categoryarray: order,
            tickmode: 'array',
            tickvals: order,
            ticktext: order.map((p) => levelLabel(p, labels)),
          },
          yaxis: { ...baseLayout(palette, { title: '' }).yaxis, range: [0, 118], title: { text: '%' } },
        }}
        config={PLOT_CONFIG}
        style={{ width: '100%', height: 320 }}
        useResizeHandler
      />
    </ChartCard>
  );
};
