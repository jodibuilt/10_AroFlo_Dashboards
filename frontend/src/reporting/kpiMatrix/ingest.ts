// CSV rows -> cleaned, dated, tier-joined, flag-annotated task rows.
// All timing flags are three-valued: true | false | null. null is never
// coerced to false.

import { parseCsv, CsvRow } from '../../lib/csv';
import { categoriseOne } from './categorise';
import {
  COMMENCED_STATUSES,
  COMMENCED_SUBSTATUSES,
  DESCRIPTION_COLUMN,
  INVOICE_SLA_DAYS,
  ISSUES_FORM_NAME,
  JSA_NAME,
  PRIORITY_MAP,
  SUBSTATUS_COLUMN,
  Tier,
} from './config';

export type Tri = boolean | null;

// The P-scale codes themselves, for rows that carry the level rather than the
// contract wording PRIORITY_MAP is keyed on — the live AroFlo feed does (the
// server reads the level off AroFlo's own priority name, so AP3 arrives as
// P3). Level 5 sits in the P4 (30-day) tier, like the AP5 wording there.
const CODE_TIERS: Record<string, [Tier, number]> = {
  P1: ['P1', 0],
  P2: ['P2', 3],
  P3: ['P3', 14],
  P4: ['P4', 30],
  P5: ['P4', 30],
  PM: ['PM', 30],
};

export interface KpiTaskRow {
  jobNumber: string;
  task: string;
  status: string;
  substatus: string;
  priority: string;
  tier: Tier | null;
  slaDays: number | null;

  requestedAt: Date | null;
  taskDueAt: Date | null;
  scheduleStartAt: Date | null;
  completedAt: Date | null;
  invoiceAt: Date | null;
  actualStartAt: Date | null; // straight copy of scheduleStartAt — deliberate indirection

  checklistName: string;
  checklistStatus: string;
  complianceFormName: string;
  complianceFormStatus: string;

  failureCategory: string;
  period: string | null; // YYYY-MM of requestedAt

  // derived
  slaDueAt: Date | null;
  commencedOnTime: Tri;
  completedOnTime: Tri;
  hasCommenced: boolean;
  invoiceOnTime: Tri;
  isOverdue: Tri;
  taskIsLate: boolean;
  taskEvaluable: boolean;
}

export interface Diagnostics {
  rowsLoaded: number;
  rowsAfterDedup: number;
  duplicatesRemoved: number;
  duplicateJobNumbers: number;
  rowsNullTier: number;
  unmappedPriorities: string[];
  checklistNames: string[];
  complianceFormNames: string[];
  rowsWithCompletion: number;
  rowsWithScheduleStart: number;
  completedOnlyExport: boolean;
  looksOpenTasks: boolean;
  hasDescriptionColumn: boolean;
  jsaNameMatches: number;
  issuesNameMatches: number;
  missingColumns: string[];
}

// --------------------------------------------------------------------------
// Date parsing
// --------------------------------------------------------------------------

const MONTHS_12H = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)$/i;
const TIME_24H = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

function parseTimeParts(time: string): [number, number, number] {
  const t = time.trim();
  const m12 = MONTHS_12H.exec(t);
  if (m12) {
    let h = Number(m12[1]) % 12;
    if (m12[4].toLowerCase() === 'pm') h += 12;
    return [h, Number(m12[2]), Number(m12[3] || 0)];
  }
  const m24 = TIME_24H.exec(t);
  if (m24) return [Number(m24[1]), Number(m24[2]), Number(m24[3] || 0)];
  return [0, 0, 0];
}

// date: "d/m/Y" (Australian, dayfirst) or "Y/m/d" / "Y-m-d". time: optional.
export function parseDateTime(date: string | null | undefined, time?: string | null): Date | null {
  if (!date || !date.trim()) return null;
  const d = date.trim();
  let year: number, month: number, day: number;

  const iso = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(d);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(d);
  if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (dmy) {
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
  } else {
    return null;
  }
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const [h, mi, s] = time && time.trim() ? parseTimeParts(time) : [0, 0, 0];
  const dt = new Date(year, month - 1, day, h, mi, s, 0);
  return isNaN(dt.getTime()) ? null : dt;
}

function endOfDay(dt: Date): Date {
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate(), 23, 59, 59, 0);
}
function addDays(dt: Date, days: number): Date {
  return new Date(dt.getFullYear(), dt.getMonth(), dt.getDate() + days, dt.getHours(), dt.getMinutes(), dt.getSeconds(), 0);
}
function blank(v: string | undefined): string {
  return (v ?? '').trim();
}
function periodOf(dt: Date | null): string | null {
  if (!dt) return null;
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`;
}

// --------------------------------------------------------------------------
// Build
// --------------------------------------------------------------------------

export function buildDataset(csvText: string, now: Date = new Date()): { rows: KpiTaskRow[]; diag: Diagnostics } {
  const { headers, rows } = parseCsv(csvText);
  return buildDatasetFromRows(headers, rows, now);
}

// The same pipeline for rows that didn't come from a CSV file: the live
// AroFlo feed arrives already keyed by the export's column names
// (services/reportingKpiMatrix.ts).
export function buildDatasetFromRows(
  headers: string[],
  raw: CsvRow[],
  now: Date = new Date(),
): { rows: KpiTaskRow[]; diag: Diagnostics } {
  const headerSet = new Set(headers);
  const hasDescription = headerSet.has(DESCRIPTION_COLUMN);

  const diag: Diagnostics = {
    rowsLoaded: raw.length,
    rowsAfterDedup: 0,
    duplicatesRemoved: 0,
    duplicateJobNumbers: 0,
    rowsNullTier: 0,
    unmappedPriorities: [],
    checklistNames: [],
    complianceFormNames: [],
    rowsWithCompletion: 0,
    rowsWithScheduleStart: 0,
    completedOnlyExport: false,
    looksOpenTasks: false,
    hasDescriptionColumn: hasDescription,
    jsaNameMatches: 0,
    issuesNameMatches: 0,
    missingColumns: ['Jobnumber', 'Priority', 'Requested Date'].filter((c) => !headerSet.has(c)),
  };

  // dedup by Jobnumber, keep first
  const seen = new Set<string>();
  const dupJobNumbers = new Set<string>();
  const deduped: CsvRow[] = [];
  for (const r of raw) {
    const jn = blank(r.Jobnumber);
    if (jn && seen.has(jn)) {
      dupJobNumbers.add(jn);
      diag.duplicatesRemoved++;
      continue;
    }
    if (jn) seen.add(jn);
    deduped.push(r);
  }
  diag.rowsAfterDedup = deduped.length;
  diag.duplicateJobNumbers = dupJobNumbers.size;

  const unmapped = new Set<string>();
  const checklistNames = new Set<string>();
  const complianceFormNames = new Set<string>();

  const rows: KpiTaskRow[] = deduped.map((r) => {
    const priority = blank(r.Priority);
    const mapped = PRIORITY_MAP[priority] ?? CODE_TIERS[priority];
    const tier = mapped ? mapped[0] : null;
    const slaDays = mapped ? mapped[1] : null;
    if (!tier) {
      diag.rowsNullTier++;
      if (priority) unmapped.add(priority);
    }

    const requestedAt = parseDateTime(r['Requested Date'], r['Requested Time']);
    const taskDueAt = parseDateTime(r['Task Due Date'], r['Task Due Time']);
    const scheduleStartAt = parseDateTime(r['Schedule Start Date'], r['Schedule Start Time']);
    const completedAt = parseDateTime(r['Completed Date'], r['Completed Time']);
    const invoiceAt = parseDateTime(r['Last Invoice Date']);

    const checklistName = blank(r['Checklist Name']);
    const complianceFormName = blank(r['Compliance Form Name']);
    if (checklistName) checklistNames.add(checklistName);
    if (complianceFormName) complianceFormNames.add(complianceFormName);
    if (checklistName === JSA_NAME) diag.jsaNameMatches++;
    if (complianceFormName === ISSUES_FORM_NAME) diag.issuesNameMatches++;
    if (completedAt) diag.rowsWithCompletion++;
    if (scheduleStartAt) diag.rowsWithScheduleStart++;

    const row: KpiTaskRow = {
      jobNumber: blank(r.Jobnumber),
      task: blank(r.Task),
      status: blank(r.Status),
      substatus: blank(r[SUBSTATUS_COLUMN]),
      priority,
      tier,
      slaDays,
      requestedAt,
      taskDueAt,
      scheduleStartAt,
      completedAt,
      invoiceAt,
      actualStartAt: scheduleStartAt, // deliberate straight copy
      checklistName,
      checklistStatus: blank(r['Checklist Status']),
      complianceFormName,
      complianceFormStatus: blank(r['Compliance Form Status']),
      failureCategory: hasDescription ? categoriseOne(r[DESCRIPTION_COLUMN]) : 'reason not recorded',
      period: periodOf(requestedAt),
      slaDueAt: null,
      commencedOnTime: null,
      completedOnTime: null,
      hasCommenced: false,
      invoiceOnTime: null,
      isOverdue: null,
      taskIsLate: false,
      taskEvaluable: false,
    };

    addDerivedFlags(row, now);
    return row;
  });

  diag.unmappedPriorities = [...unmapped].sort();
  diag.checklistNames = [...checklistNames].sort();
  diag.complianceFormNames = [...complianceFormNames].sort();
  if (diag.rowsAfterDedup > 0) {
    const frac = diag.rowsWithCompletion / diag.rowsAfterDedup;
    diag.completedOnlyExport = frac >= 0.98;
    diag.looksOpenTasks = frac < 0.5;
  }

  return { rows, diag };
}

// --------------------------------------------------------------------------
// Derived flags (spec section 5)
// --------------------------------------------------------------------------

function computeSlaDue(row: KpiTaskRow): Date | null {
  const req = row.requestedAt;
  if (!req || !row.tier) return null;
  if (row.tier === 'P1') {
    return req.getHours() < 13 ? endOfDay(req) : endOfDay(addDays(req, 1));
  }
  if (row.slaDays === null) return null;
  return endOfDay(addDays(req, row.slaDays));
}

function addDerivedFlags(row: KpiTaskRow, now: Date): void {
  row.slaDueAt = computeSlaDue(row);

  // 5.2 commenced_on_time
  row.commencedOnTime =
    row.actualStartAt && row.slaDueAt ? row.actualStartAt.getTime() <= row.slaDueAt.getTime() : null;

  // 5.3 completed_on_time — against AroFlo's own Task Due Date. A job still
  // open after that date has missed it whenever it ends up finished, so it
  // is late now, not "not yet known" — the Work Orders page counts it as
  // overdue, and the two pages have to agree. Open and not yet due stays
  // null: undecided.
  if (!row.taskDueAt) row.completedOnTime = null;
  else if (row.completedAt) row.completedOnTime = row.completedAt.getTime() <= row.taskDueAt.getTime();
  else row.completedOnTime = row.taskDueAt.getTime() < now.getTime() ? false : null;

  // 5.4 has_commenced — never null
  row.hasCommenced =
    Boolean(row.completedAt) ||
    COMMENCED_STATUSES.has(row.status.toLowerCase()) ||
    COMMENCED_SUBSTATUSES.has(row.substatus.toLowerCase());

  // 5.5 invoice_on_time
  if (!row.completedAt) {
    row.invoiceOnTime = null;
  } else if (!row.invoiceAt) {
    row.invoiceOnTime = false; // completed but never invoiced = a failure
  } else {
    row.invoiceOnTime = row.invoiceAt.getTime() <= addDays(row.completedAt, INVOICE_SLA_DAYS).getTime();
  }

  // 5.6 is_overdue
  if (!row.slaDueAt) {
    row.isOverdue = null;
  } else if (!row.completedAt) {
    row.isOverdue = row.slaDueAt.getTime() < now.getTime();
  } else {
    row.isOverdue = row.completedAt.getTime() > row.slaDueAt.getTime();
  }

  // 5.7 task_is_late — started late, finished late, or open past its due date
  row.taskIsLate = (Boolean(row.actualStartAt) && row.commencedOnTime === false) || row.completedOnTime === false;

  // 5.8 task_evaluable — all four dates required
  row.taskEvaluable = Boolean(row.actualStartAt && row.completedAt && row.slaDueAt && row.taskDueAt);
}
