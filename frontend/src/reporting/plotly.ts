import createPlotlyComponent from 'react-plotly.js/factory';
// plotly.js-dist-min ships no type declarations; @types/plotly.js resolves for
// the bare specifier's typings pattern, so this imports untyped (as `any`),
// fine for createPlotlyComponent's (plotly: object) signature.
import Plotly from 'plotly.js-dist-min';
import type { Layout } from 'plotly.js';
import { Palette, FONT_FAMILY } from './theme';

export const Plot = createPlotlyComponent(Plotly);

// Ported from aroflo_dash's charts.py _base_layout/_finalize — shared
// styling every chart on the Reports page uses (margins, legend position,
// axis styling, font). See cosmic-tumbling-pearl.md for the source values.
export function baseLayout(palette: Palette, opts: { title: string; hasLegend?: boolean }): Partial<Layout> {
  return {
    // Re-measure the container on every update. Without this Plotly keeps
    // the size of its first draw, and several charts size their container
    // from the data (rows x px): change a filter and the chart either spills
    // out of a box that shrank or sits small in one that grew.
    autosize: true,
    paper_bgcolor: palette.surface,
    plot_bgcolor: palette.surface,
    font: { family: FONT_FAMILY, color: palette.inkSecondary, size: 13 },
    title: { text: opts.title, font: { size: 15, color: palette.inkPrimary }, x: 0.02, y: 0.95, xanchor: 'left', yanchor: 'top' },
    margin: { l: 20, r: 30, t: 64, b: opts.hasLegend ? 56 : 32 },
    legend: opts.hasLegend
      ? { orientation: 'h', y: -0.28, x: 0, xanchor: 'left', bgcolor: 'transparent', font: { color: palette.inkSecondary } }
      : undefined,
    showlegend: Boolean(opts.hasLegend),
    // automargin lets Plotly grow the margin to fit tick labels AND an axis
    // title, so an x-axis title never lands on top of the ticks or the bars.
    xaxis: {
      showgrid: false,
      showline: true,
      linecolor: palette.border,
      tickfont: { color: palette.inkMuted },
      automargin: true,
      title: { standoff: 12 },
    },
    yaxis: {
      showgrid: true,
      gridcolor: palette.border,
      zeroline: false,
      tickfont: { color: palette.inkMuted },
      automargin: true,
    },
  } as Partial<Layout>;
}

// 22% headroom above the max value so outside bar-text labels don't clip the title.
export function headroom(max: number): number {
  return max <= 0 ? 1 : max * 1.22;
}

export const PLOT_CONFIG = { displayModeBar: false, responsive: true };
