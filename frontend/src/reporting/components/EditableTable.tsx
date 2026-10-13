import React, { useEffect, useRef, useState } from 'react';
import { Palette } from '../theme';
import { EditScope, loadDashboardEdit, saveDashboardEdit, deleteDashboardEdit } from '../../services/reportingEdits';
import { ariaSort, ColumnHeading, ControlColumn, ControlSummary, FilterKind, NoMatches, useTableControls } from './tableControls';

export interface EditableColumn {
  key: string;
  label: string;
  align?: 'left' | 'right';
  // With `filterable`: what kind of filter the column gets (default: a box
  // to type in). See tableControls.tsx.
  filter?: FilterKind;
}

// A one-click filter above the table: sets `column`'s filter to `value`,
// and clears it again when clicked while on.
export interface QuickFilter {
  label: string;
  column: string;
  value: string;
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
  // Sortable headings with a filter under each, and a row count. For the
  // long tables; a five-row summary doesn't need it.
  filterable?: boolean;
  quickFilters?: QuickFilter[];
}

const ROWS_PER_PAGE = 20;
// Taller than this and the table scrolls (px) — about twelve rows.
const MAX_TABLE_HEIGHT = 460;

type Row = Record<string, string | number | null>;

interface SavedEdit {
  rows: Row[];
  extraCols: string[];
  // On everything saved from here on. This table used to save itself,
  // untouched, the first time it was shown — so a stored payload without this
  // is a snapshot of whatever data was on screen that day, not an edit.
  edited?: boolean;
}

// Ported from aroflo_dash's editable.py — hand-built per-cell inputs (not a
// canvas-drawn grid, so it can be themed), autosave on every change (no Save
// button), Reset goes back to the freshly computed rows and clears the
// persisted edit. Persistence is the /api/dashboard-edits/:stateKey route
// (src/server.js), scoped per user+view+dateRange+stateKey — same shape as
// edit_store.py's SQLite table, JSON instead of pickle.
//
// The fresh rows are never copied into state. With no edit the table renders
// `defaultRows` as they arrive, so a refresh or a change of filter always
// shows through; only something the user changes becomes an edit, and only
// an edit is ever saved. (Copying them in was the old behaviour, and it went
// wrong twice over: the copy was taken before the new filter's data had
// arrived, so the table showed the previous client's rows, and the copy was
// then saved as an "edit" that replaced live data from that day on.)
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
  filterable = false,
  quickFilters = [],
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [edit, setEdit] = useState<SavedEdit | null>(null);
  const [newColName, setNewColName] = useState('');
  const [page, setPage] = useState(0);
  const saveTimer = useRef<number | undefined>(undefined);

  const rows = edit ? edit.rows : defaultRows;
  const extraCols = edit ? edit.extraCols : [];

  useEffect(() => {
    let stale = false;
    setEdit(null);
    setPage(0);
    loadDashboardEdit<SavedEdit>(stateKey, scope)
      .then((saved) => {
        if (!stale && saved && saved.edited) setEdit({ ...saved, extraCols: saved.extraCols || [] });
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateKey, scope.view, scope.dateFrom, scope.dateTo]);

  const allColumns: EditableColumn[] = [...columns, ...extraCols.map((c) => ({ key: c, label: c }))];

  // Every change the user makes goes through here: it starts from what is on
  // screen, becomes the edit, and is saved shortly after.
  const applyEdit = (change: (current: SavedEdit) => SavedEdit) => {
    const next: SavedEdit = { ...change(edit ?? { rows: defaultRows, extraCols: [] }), edited: true };
    setEdit(next);
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveDashboardEdit(stateKey, scope, next).catch(() => {});
    }, 500);
  };

  const handleCellChange = (rowIdx: number, colKey: string, value: string) => {
    applyEdit((e) => ({ ...e, rows: e.rows.map((r, i) => (i === rowIdx ? { ...r, [colKey]: value } : r)) }));
  };

  const handleAddRow = () => {
    const blank: Row = {};
    for (const c of allColumns) blank[c.key] = '';
    applyEdit((e) => ({ ...e, rows: [...e.rows, blank] }));
  };

  const handleAddColumn = () => {
    const name = newColName.trim();
    if (!name || allColumns.some((c) => c.key === name)) return;
    applyEdit((e) => ({ rows: e.rows.map((r) => ({ ...r, [name]: '' })), extraCols: [...e.extraCols, name] }));
    setNewColName('');
  };

  const handleReset = () => {
    window.clearTimeout(saveTimer.current);
    deleteDashboardEdit(stateKey, scope).catch(() => {});
    setEdit(null);
    setPage(0);
  };

  // Filters match the cell as it is shown (a date as "05 Sept 2026"); sorting
  // goes by the value underneath, which for a date is YYYY/MM/DD and for a
  // count is a number.
  const shownText = (key: string, row: Row): string => {
    const shown = formatCell ? formatCell(key, row[key] ?? null, row) : row[key];
    return typeof shown === 'string' || typeof shown === 'number' ? String(shown) : String(row[key] ?? '');
  };
  const controlColumns: ControlColumn<Row>[] = allColumns.map((c) => ({
    key: c.key,
    label: c.label,
    align: c.align,
    filter: c.filter ?? 'text',
    text: (row) => shownText(c.key, row),
    sortValue: (row) => row[c.key],
  }));
  const controls = useTableControls(rows, controlColumns);
  // While editing, every row is shown in its own order: an edit is saved
  // against the row's position, which a filter or a sort would move.
  const controlled = filterable && !isEditing;
  const viewRows = controlled ? controls.rows : rows;

  const pageRows = isEditing ? rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE) : viewRows;
  const pageCount = Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));

  return (
    <div className="rounded-md overflow-hidden" style={{ background: palette.surface, border: `1px solid ${palette.border}` }}>
      <div className="flex items-center justify-end gap-2 px-3 py-2" style={{ borderBottom: `1px solid ${palette.border}` }}>
        {/* An edit replaces the live rows, so say so — otherwise a table that
            has stopped following AroFlo looks exactly like one that hasn't. */}
        <div className="mr-auto flex flex-wrap items-center gap-x-3 gap-y-1">
          {controlled && rows.length > 0 && <ControlSummary controls={controls} palette={palette} />}
          {controlled &&
            rows.length > 0 &&
            quickFilters.map((q) => {
              const on = (controls.filters[q.column] || '') === q.value;
              return (
                <button
                  key={q.label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => controls.setFilter(q.column, on ? '' : q.value)}
                  className="px-2 py-0.5 rounded-md text-[11px] font-semibold"
                  style={{
                    background: on ? palette.accentBlue : 'transparent',
                    color: on ? '#fff' : palette.inkPrimary,
                    border: `1px solid ${on ? palette.accentBlue : palette.border}`,
                  }}
                >
                  {q.label}
                </button>
              );
            })}
          {edit && (
            <span className="text-[11px]" style={{ color: palette.statusWarningText }}>
              Showing your edited version of this table, not the latest AroFlo data.{' '}
              <button onClick={handleReset} className="underline font-semibold">
                Reset
              </button>
            </span>
          )}
        </div>
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
        // A long table scrolls inside this box, under a header that stays
        // put, instead of running down the page — the same height as the
        // other report tables. The header line is a shadow on the cells: a
        // row border doesn't travel with a sticky header.
        <div className="overflow-auto" style={{ maxHeight: MAX_TABLE_HEIGHT }}>
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr>
                {allColumns.map((c, i) => (
                  <th
                    key={c.key}
                    aria-sort={controlled ? ariaSort(controls, c.key) : undefined}
                    className={`p-2 font-semibold uppercase text-[11px] sticky top-0 z-10 align-bottom ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                    style={{ color: palette.inkMuted, background: palette.surface, boxShadow: `inset 0 -1px 0 ${palette.border}` }}
                  >
                    {controlled ? <ColumnHeading column={controlColumns[i]} controls={controls} palette={palette} /> : c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {controlled && <NoMatches controls={controls} palette={palette} span={allColumns.length} />}
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
