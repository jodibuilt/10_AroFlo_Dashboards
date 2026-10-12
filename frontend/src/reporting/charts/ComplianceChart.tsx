import React, { useState } from 'react';
import { Plot, baseLayout, PLOT_CONFIG } from '../plotly';
import { Palette, PRIORITY_ORDER, kpiTargetDefaultColors } from '../theme';
import { ComplianceRow, ColorOverrides } from '../types';
import { EditScope } from '../../services/reportingEdits';
import { ChartCard } from '../components/ChartCard';

interface ComplianceChartProps {
  rows: ComplianceRow[];
  palette: Palette;
  stateKey: string;
  scope: EditScope;
}

// Ported from aroflo_dash's render_kpi_target_chart — "Actual vs. Target KPI
// Compliance by Priority": Met/Below-Target bars (Actual %) + a diamond
// scatter marker per priority at Target %. X order forced to P1..PM,
// filtered to priorities actually present; fixed y-range [0, 118].
export const ComplianceChart: React.FC<ComplianceChartProps> = ({ rows, palette, stateKey, scope }) => {
  const defaultColors = kpiTargetDefaultColors(palette);
  const [colors, setColors] = useState<ColorOverrides>(defaultColors);

  const order = PRIORITY_ORDER.filter((p) => rows.some((r) => r.priority === p));
  const byPriority = new Map(rows.map((r) => [r.priority, r]));
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
          xaxis: { ...baseLayout(palette, { title: '' }).xaxis, categoryorder: 'array', categoryarray: order },
          yaxis: { ...baseLayout(palette, { title: '' }).yaxis, range: [0, 118], title: { text: '%' } },
        }}
        config={PLOT_CONFIG}
        style={{ width: '100%', height: 320 }}
        useResizeHandler
      />
    </ChartCard>
  );
};
