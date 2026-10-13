import React, { useEffect, useMemo, useState } from 'react';
import { Palette } from '../theme';
import { csvBlob, saveBlob, slug } from '../export/download';
import { today } from '../time';

// Filtering and sorting for the long report tables, the same on every one:
// each column heading sorts when clicked and has its own filter under it.
//
// A filter matches what the cell SHOWS — "type what you see": "sep" finds
// every date in September, because the cell reads "05 Sept 2026". It is a
// way of looking at a table and nothing more; the figures on the page and
// the Excel / PDF reports are worked out from every row regardless.

// text   — a box; rows whose cell contains what is typed
// choice — a list of the values in the column; rows with exactly that one
// number — a box; rows with at least that number ("1" in Days Late = late)
// none   — sorts, but has no filter
export type FilterKind = 'text' | 'choice' | 'number' | 'none';

export interface ControlColumn<R> {
  key: string;
  label: string;
  // The cell as plain text: what a filter matches and, unless sortValue is
  // given, what the column sorts by.
  text: (row: R) => string;
  // For a column whose text doesn't sort right: a date as YYYY/MM/DD, a
  // count or an amount as a number.
  sortValue?: (row: R) => string | number | null | undefined;
  filter?: FilterKind;
  align?: 'left' | 'right';
}

type Sort = { key: string; dir: 'asc' | 'desc' } | null;

// The value a blank cell takes in a choice list.
const BLANK = '\u0000blank';

export interface TableControls<R> {
  columns: ControlColumn<R>[];
  // Filtered, then sorted. With no filter and no sort: the rows as given.
  rows: R[];
  total: number;
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
  sort: Sort;
  toggleSort: (key: string) => void;
  clear: () => void;
  // A filter is on (sorting alone doesn't hide anything).
  filtered: boolean;
  choices: (key: string) => string[];
}

function matches<R>(column: ControlColumn<R>, row: R, wanted: string): boolean {
  if (column.filter === 'choice') return wanted === BLANK ? !column.text(row).trim() : column.text(row) === wanted;
  if (column.filter === 'number') {
    const least = Number(wanted);
    if (!wanted.trim() || Number.isNaN(least)) return true;
    const value = column.sortValue ? column.sortValue(row) : column.text(row);
    // A blank is not zero: a job with no days-late figure isn't "at least 0".
    if (value === null || value === undefined || value === '') return false;
    const n = typeof value === 'number' ? value : Number(String(value).replace(/[^0-9.-]/g, ''));
    return !Number.isNaN(n) && n >= least;
  }
  return column.text(row).toLowerCase().includes(wanted.trim().toLowerCase());
}

function compare(a: string | number | null | undefined, b: string | number | null | undefined, dir: 'asc' | 'desc'): number {
  // Blanks go last whichever way the column is sorted.
  const blankA = a === null || a === undefined || a === '';
  const blankB = b === null || b === undefined || b === '';
  if (blankA || blankB) return blankA === blankB ? 0 : blankA ? 1 : -1;
  const order =
    typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  return dir === 'asc' ? order : -order;
}

export function useTableControls<R>(rows: R[], columns: ControlColumn<R>[]): TableControls<R> {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<Sort>(null);

  // What each choice column can be set to, from every row (not just the
  // ones left after filtering — picking one value mustn't empty the list).
  const options = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const c of columns) {
      if (c.filter !== 'choice') continue;
      const seen = new Set<string>();
      for (const r of rows) seen.add(c.text(r).trim() ? c.text(r) : BLANK);
      out[c.key] = [...seen].sort((a, b) => (a === BLANK ? 1 : b === BLANK ? -1 : a.localeCompare(b, undefined, { numeric: true })));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns.map((c) => `${c.key}:${c.filter}`).join('|')]);

  // A value picked from a list that the data no longer has — another client,
  // another month — would leave the table empty with nothing to show why.
  useEffect(() => {
    setFilters((current) => {
      const kept = Object.entries(current).filter(([key, value]) => {
        const column = columns.find((c) => c.key === key);
        return column && value && (column.filter !== 'choice' || (options[key] || []).includes(value));
      });
      return kept.length === Object.keys(current).length ? current : Object.fromEntries(kept);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options]);

  const shown = useMemo(() => {
    const on = columns.filter((c) => (filters[c.key] || '').trim() && c.filter !== 'none');
    const kept = on.length ? rows.filter((r) => on.every((c) => matches(c, r, filters[c.key]))) : rows;
    const by = sort && columns.find((c) => c.key === sort.key);
    if (!sort || !by) return kept;
    const value = (r: R) => (by.sortValue ? by.sortValue(r) : by.text(r));
    return [...kept].sort((a, b) => compare(value(a), value(b), sort.dir));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, filters, sort, columns.map((c) => `${c.key}:${c.filter}`).join('|')]);

  return {
    columns,
    rows: shown,
    total: rows.length,
    filters,
    setFilter: (key, value) => setFilters((current) => ({ ...current, [key]: value })),
    sort,
    // First click smallest-first, second largest-first, third back to the
    // order the table arrived in.
    toggleSort: (key) => setSort((current) => (current?.key !== key ? { key, dir: 'asc' } : current.dir === 'asc' ? { key, dir: 'desc' } : null)),
    clear: () => setFilters({}),
    filtered: Object.values(filters).some((v) => v.trim()),
    choices: (key) => options[key] || [],
  };
}

// What goes on a <th>, so a screen reader says which way a column is sorted.
export function ariaSort<R>(controls: TableControls<R>, key: string): 'ascending' | 'descending' | 'none' {
  if (controls.sort?.key !== key) return 'none';
  return controls.sort.dir === 'asc' ? 'ascending' : 'descending';
}

// The inside of one heading cell: the column's name, which sorts when
// clicked, over its filter.
export function ColumnHeading<R>({ column, controls, palette }: { column: ControlColumn<R>; controls: TableControls<R>; palette: Palette }) {
  const sorted = controls.sort?.key === column.key ? controls.sort.dir : null;
  const value = controls.filters[column.key] || '';
  const right = column.align === 'right';
  const kind = column.filter ?? 'text';
  const field: React.CSSProperties = {
    background: palette.surface,
    border: `1px solid ${value ? palette.accentBlue : palette.border}`,
    color: palette.inkPrimary,
  };
  // Wide enough to read a picked value ("Processed") in a narrow column.
  const fieldClass = `w-full ${kind === 'choice' ? 'min-w-[6rem]' : 'min-w-[4rem]'} px-1.5 py-0.5 rounded text-[11px] font-normal normal-case`;
  return (
    <div className={`flex flex-col gap-1 ${right ? 'items-end' : 'items-start'}`}>
      <button
        type="button"
        onClick={() => controls.toggleSort(column.key)}
        title={sorted === 'asc' ? 'Sorted smallest first — click for largest first' : sorted === 'desc' ? 'Sorted largest first — click to stop sorting' : 'Click to sort'}
        className={`inline-flex items-center gap-0.5 font-semibold ${right ? 'text-right' : 'text-left'}`}
        style={{ color: sorted ? palette.inkPrimary : 'inherit', textTransform: 'inherit' }}
      >
        {column.label}
        {/* Plain arrows, not the icon font the rest of the app draws its
            icons with: that font comes over the network, and without it an
            icon prints as its name — "unfold_more" in every heading of
            every table, pushing columns off the side. */}
        <span className="text-[12px] leading-none" aria-hidden="true" style={{ opacity: sorted ? 1 : 0.4 }}>
          {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : '↕'}
        </span>
      </button>
      {kind === 'choice' && (
        <select
          value={value}
          onChange={(e) => controls.setFilter(column.key, e.target.value)}
          aria-label={`Filter by ${column.label}`}
          className={fieldClass}
          style={field}
        >
          <option value="">All</option>
          {controls.choices(column.key).map((choice) => (
            <option key={choice} value={choice}>
              {choice === BLANK ? '(blank)' : choice}
            </option>
          ))}
        </select>
      )}
      {(kind === 'text' || kind === 'number') && (
        <input
          value={value}
          onChange={(e) => controls.setFilter(column.key, e.target.value)}
          inputMode={kind === 'number' ? 'decimal' : undefined}
          placeholder={kind === 'number' ? 'At least…' : 'Filter…'}
          title={kind === 'number' ? 'Show rows with at least this number' : 'Show rows containing this text'}
          aria-label={kind === 'number' ? `${column.label}: at least` : `Filter by ${column.label}`}
          className={`${fieldClass} ${right ? 'text-right' : ''}`}
          style={field}
        />
      )}
    </div>
  );
}

// "Showing 12 of 95 rows · Clear filters" — or just the count, with nothing
// filtered.
export function ControlSummary<R>({ controls, palette, noun = 'rows' }: { controls: TableControls<R>; palette: Palette; noun?: string }) {
  return (
    <span className="text-[11px]" style={{ color: controls.filtered ? palette.inkPrimary : palette.inkMuted }} role="status" aria-live="polite">
      {controls.filtered ? (
        <>
          Showing <b>{controls.rows.length.toLocaleString()}</b> of {controls.total.toLocaleString()} {noun}
          {' · '}
          <button type="button" onClick={controls.clear} className="underline font-semibold" style={{ color: palette.accentBlue }}>
            Clear filters
          </button>
        </>
      ) : (
        <>
          {controls.total.toLocaleString()} {noun}
        </>
      )}
    </span>
  );
}

// Saves the table as a CSV file — the rows as they are showing, so with the
// filters and the sort that are on (and, in an edited table, the edits).
// `name` goes in the file name with today's date.
export function DownloadCsv<R>({ controls, palette, name }: { controls: TableControls<R>; palette: Palette; name: string }) {
  const save = () => {
    const blob = csvBlob(
      controls.columns.map((c) => c.label),
      controls.rows.map((row) => controls.columns.map((c) => c.text(row))),
    );
    saveBlob(blob, `aroflo_${slug(name)}_${today()}.csv`);
  };
  return (
    <button
      type="button"
      onClick={save}
      disabled={controls.rows.length === 0}
      title={controls.filtered ? 'Save the rows showing now (filters applied) as a CSV file' : 'Save this table as a CSV file'}
      className="px-2 py-0.5 rounded-md text-[11px] font-semibold disabled:opacity-50"
      style={{ border: `1px solid ${palette.border}`, color: palette.inkPrimary, background: 'transparent' }}
    >
      Download CSV
    </button>
  );
}

// The row a table shows when its filters leave nothing.
export function NoMatches<R>({ controls, palette, span }: { controls: TableControls<R>; palette: Palette; span: number }) {
  if (!controls.filtered || controls.rows.length > 0) return null;
  return (
    <tr>
      <td colSpan={span} className="px-3 py-4 text-[12px]" style={{ color: palette.inkMuted }}>
        Nothing matches these filters.{' '}
        <button type="button" onClick={controls.clear} className="underline font-semibold" style={{ color: palette.accentBlue }}>
          Clear filters
        </button>
      </td>
    </tr>
  );
}
