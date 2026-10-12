// Ventia Work Order Consolidator — TypeScript port of csv_cleaner/app.py's
// process_data(). Merges a Work Order List CSV with a WO Object List CSV,
// filters to PM work orders in a due-date window, groups one row per work
// order (collapsing repeated values but keeping every asset-level value),
// and maps to the fixed output schema.

import { parseCsv } from '../../lib/csv';

export type Row = Record<string, string>;

const NO_DEDUPE_COLUMNS = new Set([
  'asset id', 'barcode', 'building', 'level', 'room', 'location id', 'quantity',
]);

const OUTPUT_COLUMNS = [
  'Client', 'Project Name', 'Project Stage', 'Task Identification', 'Task Type',
  'Cust ON', 'Location', 'Priority', 'Asset ID', 'Barcode', 'Building', 'Level',
  'Room', 'Quantity', 'Functional Location ID', 'Due Date',
];

// "="value"" (an Excel text-guard) -> value
function cleanExcelArtifact(v: string): string {
  const s = (v ?? '').trim();
  if (s.startsWith('="') && s.endsWith('"')) return s.slice(2, -1);
  return s;
}

// value starting with = + - @ -> ="value" so a spreadsheet won't treat it as a formula
function protectExcelFormula(v: string): string {
  const s = String(v ?? '');
  return /^[=+\-@]/.test(s) ? `="${s}"` : s;
}

function baseColName(col: string): string {
  return col.endsWith('_x') || col.endsWith('_y') ? col.slice(0, -2) : col;
}

const TRAILING_DOT_ZERO = /^-?\d+\.0$/;

// Port of combine_data().
function combineData(values: string[], mergeDuplicates: boolean, collapseIfUniform: boolean): string {
  if (mergeDuplicates) {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const raw of values) {
      const s = (raw ?? '').trim();
      if (!s) continue;
      if (!seen.has(s)) {
        seen.add(s);
        out.push(s);
      }
    }
    return out.join(', ');
  }

  // keep-all column: blanks keep their slot (shown as "-") so asset-aligned
  // columns stay row-for-row with Asset ID
  const strs = values.map((v) => {
    let s = (v ?? '').trim();
    if (TRAILING_DOT_ZERO.test(s)) s = s.slice(0, -2);
    return s;
  });
  const nonBlank = strs.filter((s) => s !== '');
  if (nonBlank.length === 0) return '';
  if (collapseIfUniform) {
    const uniq = new Set(nonBlank);
    if (uniq.size === 1) return nonBlank[0];
  }
  return strs.map((s) => (s === '' ? '-' : s)).join(', ');
}

export interface ParsedCsv {
  headers: string[];
  rows: Row[];
}

export function readCsv(text: string): ParsedCsv {
  const { headers, rows } = parseCsv(text);
  const cleaned = rows.map((r) => {
    const o: Row = {};
    for (const h of headers) o[h] = cleanExcelArtifact(r[h] ?? '');
    return o;
  });
  return { headers, rows: cleaned };
}

export interface ConsolidateResult {
  headers: string[];
  rows: Row[];
  stats: { woRowsIn: number; afterDueFilter: number; afterPmFilter: number; workOrdersOut: number };
}

export function consolidate(
  wo: ParsedCsv,
  obj: ParsedCsv,
  filterVal: string,
  dueDateVal: string,
): ConsolidateResult {
  const woJoin = wo.headers.includes('Work Order Number') ? 'Work Order Number' : wo.headers[0];
  const objJoin = obj.headers.includes('Work Order Number')
    ? 'Work Order Number'
    : obj.headers.includes('Work Orde')
      ? 'Work Orde'
      : obj.headers[0];

  // 1. filter the WO list
  let woFiltered = wo.rows;
  const stats = { woRowsIn: wo.rows.length, afterDueFilter: 0, afterPmFilter: 0, workOrdersOut: 0 };

  const f = filterVal.trim().toLowerCase();
  if (f && wo.headers.includes('Complete Due')) {
    woFiltered = woFiltered.filter((r) => (r['Complete Due'] ?? '').toLowerCase().includes(f));
  }
  stats.afterDueFilter = woFiltered.length;

  if (wo.headers.includes('Priority')) {
    woFiltered = woFiltered.filter((r) => r['Priority'] === 'PM');
  }
  stats.afterPmFilter = woFiltered.length;

  // 2. left-merge with the object list (pandas suffix rules: overlapping
  // non-key columns get _x on the left, _y on the right)
  const sameKey = woJoin === objJoin;
  const overlap = new Set(
    wo.headers.filter((h) => obj.headers.includes(h) && !(sameKey && h === woJoin)),
  );
  const leftName = (h: string) => (overlap.has(h) ? `${h}_x` : h);
  const rightName = (h: string) => (overlap.has(h) ? `${h}_y` : h);

  const objByKey = new Map<string, Row[]>();
  for (const r of obj.rows) {
    const k = r[objJoin] ?? '';
    const list = objByKey.get(k);
    if (list) list.push(r);
    else objByKey.set(k, [r]);
  }

  const mergedHeaders: string[] = [];
  for (const h of wo.headers) mergedHeaders.push(leftName(h));
  for (const h of obj.headers) {
    if (sameKey && h === objJoin) continue;
    mergedHeaders.push(rightName(h));
  }

  const merged: Row[] = [];
  for (const wr of woFiltered) {
    const matches = objByKey.get(wr[woJoin] ?? '') ?? [null];
    for (const or of matches) {
      const row: Row = {};
      for (const h of wo.headers) row[leftName(h)] = wr[h] ?? '';
      for (const h of obj.headers) {
        if (sameKey && h === objJoin) continue;
        row[rightName(h)] = or ? (or[h] ?? '') : '';
      }
      merged.push(row);
    }
  }

  // 3. group by work order, aggregate every other column
  const aggCols = mergedHeaders.filter((c) => c !== woJoin);
  const aggSpec = aggCols.map((c) => {
    const base = baseColName(c).trim().toLowerCase();
    return { col: c, dedupe: !NO_DEDUPE_COLUMNS.has(base), collapseIfUniform: base !== 'quantity' };
  });

  const groupOrder: string[] = [];
  const groups = new Map<string, Row[]>();
  for (const r of merged) {
    const k = r[woJoin] ?? '';
    const g = groups.get(k);
    if (g) g.push(r);
    else {
      groups.set(k, [r]);
      groupOrder.push(k);
    }
  }
  groupOrder.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const groupedHeaders = [woJoin, ...aggCols];
  const grouped: Row[] = groupOrder.map((k) => {
    const rows = groups.get(k)!;
    const out: Row = { [woJoin]: k };
    for (const { col, dedupe, collapseIfUniform } of aggSpec) {
      out[col] = combineData(rows.map((r) => r[col] ?? ''), dedupe, collapseIfUniform);
    }
    return out;
  });
  stats.workOrdersOut = grouped.length;

  const has = (c: string) => groupedHeaders.includes(c);
  const colOf = (c: string): string[] | null => (has(c) ? grouped.map((r) => r[c] ?? '') : null);

  // 4. map to the fixed output schema
  const n = grouped.length;
  const fill = (v: string) => Array(n).fill(v);

  const cityCol = colOf('City') ?? fill('');
  const description = colOf('Description') ?? fill('');
  const disciplineCol =
    colOf('TDS Discip') ?? colOf('TDS Discipline') ?? fill('');
  const custOn = grouped.map((r) => r[woJoin] ?? '');

  const location = firstNonBlank(n, [
    colOf('Location'),
    colOf('Site_x') ?? colOf('Site'),
    colOf('Site_y'),
  ]);

  // Project Stage: City, else infer a known city name out of the Location text
  const knownCities = [
    ...new Set((colOf('City') ?? []).concat(obj.rows.map((r) => (r['City'] ?? '').trim())).filter(Boolean)),
  ].sort((a, b) => b.length - a.length);
  const inferCity = (loc: string): string => {
    const u = String(loc).toUpperCase();
    for (const c of knownCities) if (u.includes(c.toUpperCase())) return c;
    return '';
  };
  const projectStage = cityCol.map((c, i) => (c.trim() === '' ? inferCity(location[i]) : c));

  const record: Record<string, string[]> = {
    'Client': fill('Ventia'),
    'Project Name': fill('Ventia - RMS 2026/27'),
    'Project Stage': projectStage,
    'Task Identification': description,
    'Task Type': disciplineCol,
    'Cust ON': custOn,
    'Location': location,
    'Priority': fill('PM - Preventative Maintenance'),
    'Asset ID': colOf('Asset ID') ?? fill(''),
    'Barcode': colOf('Barcode') ?? fill(''),
    'Building': colOf('Building') ?? fill(''),
    'Level': colOf('Level') ?? fill(''),
    'Room': colOf('Room') ?? fill(''),
    'Quantity': colOf('Quantity') ?? fill(''),
    'Functional Location ID': colOf('Location ID') ?? fill(''),
    'Due Date': fill(dueDateVal),
  };

  const rows: Row[] = [];
  for (let i = 0; i < n; i++) {
    const row: Row = {};
    for (const col of OUTPUT_COLUMNS) row[col] = protectExcelFormula(record[col][i] ?? '');
    rows.push(row);
  }

  return { headers: OUTPUT_COLUMNS, rows, stats };
}

function firstNonBlank(n: number, cols: (string[] | null)[]): string[] {
  const out = Array(n).fill('');
  for (let i = 0; i < n; i++) {
    for (const c of cols) {
      if (!c) continue;
      const v = (c[i] ?? '').trim();
      if (v !== '' && out[i] === '') out[i] = v;
    }
  }
  return out;
}

const BOM = '﻿';

export function toCsv(headers: string[], rows: Row[]): string {
  const esc = (v: string) => {
    const s = v ?? '';
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(',')];
  for (const r of rows) lines.push(headers.map((h) => esc(r[h] ?? '')).join(','));
  return BOM + lines.join('\r\n') + '\r\n';
}
