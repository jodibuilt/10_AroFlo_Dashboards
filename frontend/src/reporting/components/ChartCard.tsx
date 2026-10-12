import React, { useState } from 'react';
import { Palette } from '../theme';
import { EditScope } from '../../services/reportingEdits';
import { ColorOverrides } from '../types';
import { ColorEditor } from './ColorEditor';

interface ChartCardProps {
  stateKey: string;
  scope: EditScope;
  categories: string[];
  defaultColors: Record<string, string>;
  palette: Palette;
  onColorsChange: (colors: ColorOverrides) => void;
  children: React.ReactNode;
}

// Bordered card chrome shared by every chart on the Reports page — top-right
// pencil toggles a ColorEditor beneath the chart, matching aroflo_dash's
// per-chart "edit chart data" card pattern (colors only here; the source's
// inline data-editor grid for charts is covered by the underlying
// EditableTable-backed breakdown/compliance tables instead of duplicated
// per-chart, since chart data here is always derived from real tasks).
export const ChartCard: React.FC<ChartCardProps> = ({ stateKey, scope, categories, defaultColors, palette, onColorsChange, children }) => {
  const [isEditing, setIsEditing] = useState(false);

  return (
    <div className="rounded-md p-4" style={{ background: palette.surface, border: `1px solid ${palette.border}` }}>
      <div className="flex justify-end">
        <button
          onClick={() => setIsEditing((v) => !v)}
          title={isEditing ? 'Done editing' : 'Edit chart colors'}
          className="p-1 rounded-md hover:opacity-70"
          style={{ color: palette.inkMuted }}
        >
          <span className="material-symbols-outlined text-[18px]">{isEditing ? 'check' : 'edit'}</span>
        </button>
      </div>
      {children}
      {isEditing && (
        <ColorEditor
          stateKey={stateKey}
          scope={scope}
          categories={categories}
          defaultColors={defaultColors}
          palette={palette}
          onChange={onColorsChange}
        />
      )}
    </div>
  );
};
