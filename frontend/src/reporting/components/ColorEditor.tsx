import React, { useEffect, useRef, useState } from 'react';
import { Palette } from '../theme';
import { EditScope, loadDashboardEdit, saveDashboardEdit } from '../../services/reportingEdits';
import { ColorOverrides } from '../types';

const MAX_PER_ROW = 6;

interface ColorEditorProps {
  stateKey: string;
  scope: EditScope;
  categories: string[];
  defaultColors: Record<string, string>;
  palette: Palette;
  onChange: (overrides: ColorOverrides) => void;
}

// Ported from aroflo_dash's colors.py — one native color-picker swatch per
// category, always laid out in fixed rows of 6 (even a partial last row)
// so swatches stay compact instead of stretching. Precedence: saved override
// > caller-supplied default palette entry > "#0284c7" fallback. Persists via
// the same /api/dashboard-edits/:stateKey route EditableTable uses.
export const ColorEditor: React.FC<ColorEditorProps> = ({ stateKey, scope, categories, defaultColors, palette, onChange }) => {
  const [overrides, setOverrides] = useState<ColorOverrides>({});
  const loaded = useRef(false);

  useEffect(() => {
    loaded.current = false;
    loadDashboardEdit<ColorOverrides>(stateKey, scope).then((saved) => {
      const initial = saved || {};
      setOverrides(initial);
      loaded.current = true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey, scope.view, scope.dateFrom, scope.dateTo]);

  useEffect(() => {
    if (!loaded.current) return;
    // Always fully populate every current category before handing back to
    // the caller — same as render_color_editor's return shape in colors.py.
    const merged: ColorOverrides = {};
    for (const cat of categories) merged[cat] = overrides[cat] || defaultColors[cat] || '#0284c7';
    onChange(merged);
    const t = setTimeout(() => {
      saveDashboardEdit(stateKey, scope, overrides).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overrides, categories.join('|')]);

  const rows: string[][] = [];
  for (let i = 0; i < categories.length; i += MAX_PER_ROW) rows.push(categories.slice(i, i + MAX_PER_ROW));

  return (
    <div className="space-y-2 mt-2">
      <p className="text-[11px] font-semibold uppercase" style={{ color: palette.inkMuted }}>
        Series colors
      </p>
      {rows.map((row, ri) => (
        <div key={ri} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${MAX_PER_ROW}, minmax(0, 1fr))` }}>
          {row.map((cat) => (
            <label key={cat} className="flex flex-col items-start gap-1">
              <span className="text-[10px] truncate w-full" style={{ color: palette.inkSecondary }} title={cat}>
                {cat}
              </span>
              <input
                type="color"
                value={overrides[cat] || defaultColors[cat] || '#0284c7'}
                onChange={(e) => setOverrides((prev) => ({ ...prev, [cat]: e.target.value }))}
                className="w-full h-7 rounded-md cursor-pointer"
                style={{ border: `1px solid ${palette.border}` }}
              />
            </label>
          ))}
        </div>
      ))}
    </div>
  );
};
