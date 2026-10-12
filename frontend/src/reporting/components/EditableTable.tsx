import React, { useEffect, useRef, useState } from 'react';
import { Palette } from '../theme';
import { EditScope, loadDashboardEdit, saveDashboardEdit, deleteDashboardEdit } from '../../services/reportingEdits';

export interface EditableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
}

interface EditableTableProps {
  stateKey: string;
  scope: EditScope;
  columns: EditableColumn[];
  defaultRows: Record<string, string | number | null>[];
  palette: Palette;
  striped: boolean;
  cellStyle?: (colKey: string, row: Record<string, string | number | null>) => React.CSSProperties | undefined;
  formatCell?: (colKey: string, value: string | number | null, row: Record<string, string | number | null>) => React.ReactNode;
  extraHeaderControls?: React.ReactNode;
  emptyMessage?: string;
}

const ROWS_PER_PAGE = 20;

// Ported from aroflo_dash's editable.py — hand-built per-cell inputs (not a
// canvas-drawn grid, so it can be themed), autosave on every change (no Save
// button), Reset re-seeds from the freshly computed default and clears the
// persisted row. Persistence is the new /api/dashboard-edits/:stateKey route
// (src/server.js), scoped per user+view+dateRange+stateKey — same shape as
// edit_store.py's SQLite table, JSON instead of pickle.
export const EditableTable: React.FC<EditableTableProps> = ({
  stateKey,
  scope,
  columns,
  defaultRows,
  palette,
  striped,
  cellStyle,
  formatCell,
  extraHeaderControls,
  emptyMessage,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [rows, setRows] = useState<Record<string, string | number | null>[]>(defaultRows);
  const [extraCols, setExtraCols] = useState<string[]>([]);
  const [newColName, setNewColName] = useState('');
  const [page, setPage] = useState(0);
  const skipAutosave = useRef(true);

  useEffect(() => {
    skipAutosave.current = true;
    loadDashboardEdit<{ rows: typeof defaultRows; extraCols: string[] }>(stateKey, scope).then((saved) => {
      if (saved) {
        setRows(saved.rows);
        setExtraCols(saved.extraCols || []);
      } else {
        setRows(defaultRows);
        setExtraCols([]);
      }
      setPage(0);
      // Let the seeding render commit before autosave starts reacting.
      setTimeout(() => {
        skipAutosave.current = false;
      }, 0);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey, scope.view, scope.dateFrom, scope.dateTo]);

  useEffect(() => {
    if (skipAutosave.current) return;
    const t = setTimeout(() => {
      saveDashboardEdit(stateKey, scope, { rows, extraCols }).catch(() => {});
    }, 500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, extraCols]);

  const allColumns: EditableColumn[] = [...columns, ...extraCols.map((c) => ({ key: c, label: c }))];

  const handleCellChange = (rowIdx: number, colKey: string, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === rowIdx ? { ...r, [colKey]: value } : r)));
  };

  const handleAddRow = () => {
    const blank: Record<string, string | number | null> = {};
    for (const c of allColumns) blank[c.key] = '';
    setRows((prev) => [...prev, blank]);
  };

  const handleAddColumn = () => {
    const name = newColName.trim();
    if (!name || allColumns.some((c) => c.key === name)) return;
    setExtraCols((prev) => [...prev, name]);
    setRows((prev) => prev.map((r) => ({ ...r, [name]: '' })));
    setNewColName('');
  };

  const handleReset = () => {
    skipAutosave.current = true;
    deleteDashboardEdit(stateKey, scope).catch(() => {});
    setRows(defaultRows);
    setExtraCols([]);
    setPage(0);
    setTimeout(() => {
      skipAutosave.current = false;
    }, 0);
  };

  const pageRows = isEditing ? rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE) : rows;
  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));

  return (
    <div className="rounded-md overflow-hidden" style={{ background: palette.surface, border: `1px solid ${palette.border}` }}>
      <div className="flex items-center justify-end gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${palette.border}` }}>
        {extraHeaderControls}
        <button
          onClick={() => setIsEditing((v) => !v)}
          title={isEditing ? 'Done editing' : 'Edit'}
          className="p-1 rounded-md hover:opacity-70"
          style={{ color: palette.inkMuted }}
        >
          <span className="material-symbols-outlined text-[18px]">{isEditing ? 'check' : 'edit'}</span>
        </button>
      </div>

      {rows.length === 0 && !isEditing ? (
        <div className="p-6 text-center text-[13px]" style={{ color: palette.inkMuted }}>
          {emptyMessage || 'No rows.'}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr style={{ borderBottom: `1px solid ${palette.border}` }}>
                {allColumns.map((c) => (
                  <th
                    key={c.key}
                    className={`p-2 font-semibold uppercase text-[11px] ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                    style={{ color: palette.inkMuted }}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((row, idx) => {
                const rowIdx = isEditing ? page * ROWS_PER_PAGE + idx : idx;
                const isStriped = striped && idx % 2 === 1;
                return (
                  <tr key={rowIdx} style={isStriped ? { background: palette.pagePlane } : undefined}>
                    {allColumns.map((c) => {
                      const value = row[c.key] ?? '';
                      if (isEditing) {
                        return (
                          <td key={c.key} className="p-1">
                            <input
                              value={String(value)}
                              onChange={(e) => handleCellChange(rowIdx, c.key, e.target.value)}
                              className="w-full px-1.5 py-1 rounded-md text-[12px]"
                              style={{ background: palette.pagePlane, border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
                            />
                          </td>
                        );
                      }
                      const style = cellStyle?.(c.key, row);
                      return (
                        <td key={c.key} className={`p-2 ${c.align === 'right' ? 'text-right' : ''}`} style={{ color: palette.inkPrimary, ...style }}>
                          {formatCell ? formatCell(c.key, value, row) : String(value)}
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {isEditing && (
        <div className="p-3 flex flex-wrap items-center gap-3" style={{ borderTop: `1px solid ${palette.border}` }}>
          <button
            onClick={handleAddRow}
            className="px-2.5 py-1 rounded-md text-[12px] font-semibold"
            style={{ background: palette.pagePlane, border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
          >
            + Add row
          </button>
          <div className="flex items-center gap-1.5">
            <input
              value={newColName}
              onChange={(e) => setNewColName(e.target.value)}
              placeholder="New column name"
              className="px-2 py-1 rounded-md text-[12px]"
              style={{ background: palette.pagePlane, border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
            />
            <button
              onClick={handleAddColumn}
              className="px-2.5 py-1 rounded-md text-[12px] font-semibold"
              style={{ background: palette.pagePlane, border: `1px solid ${palette.border}`, color: palette.inkPrimary }}
            >
              + Add column
            </button>
          </div>
          <button onClick={handleReset} className="px-2.5 py-1 rounded-md text-[12px] font-semibold ml-auto" style={{ color: palette.statusCritical }}>
            Reset
          </button>
          {pageCount > 1 && (
            <div className="flex items-center gap-2 text-[12px]" style={{ color: palette.inkMuted }}>
              <button disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} className="disabled:opacity-40">
                Prev
              </button>
              Page {page + 1} / {pageCount}
              <button disabled={page >= pageCount - 1} onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} className="disabled:opacity-40">
                Next
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
