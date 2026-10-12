import React from 'react';
import { Palette } from '../theme';

interface Props {
  palette: Palette;
  title: string;
  message?: string;
  height?: number;
}

// Matches ChartCard's card chrome so an empty chart slot doesn't render as a
// bare pair of Plotly axes. Used by every chart in the Analytics tab when its
// data is empty for the current selection.
export const ChartEmpty: React.FC<Props> = ({ palette, title, message = 'No data for this selection.', height = 320 }) => (
  <div className="rounded-md p-4" style={{ background: palette.surface, border: `1px solid ${palette.border}` }}>
    <div className="text-[15px] font-semibold mb-1" style={{ color: palette.inkPrimary }}>
      {title}
    </div>
    <div className="flex items-center justify-center text-center text-[13px]" style={{ height: height - 40, color: palette.inkMuted }}>
      {message}
    </div>
  </div>
);
