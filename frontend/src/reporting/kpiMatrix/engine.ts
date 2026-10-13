// KPI engine. Ported from the spec's kpi.py.
//
// Every KPI row produces two independent percentages:
//   completionPct  -- did the work happen?   count / total
//   ontimePct      -- was it inside window?  ontimeCount / ontimePool
//
// Critical invariant (checked by reconcile()):
//   metrics 1-10  ->  comment counts sum to ontimeFailCount
//   metrics 11-14 ->  comment counts sum to failCount

import {
  CHECKLIST_PASS,
  COMPLIANCE_PASS,
  DEFAULT_CATEGORY,
  INVOICE_SLA_DAYS,
  ISSUES_FORM_NAME,
  JSA_NAME,
  KpiDef,
  KPIS,
  Metric,
  Tier,
} from './config';
import { KpiTaskRow } from './ingest';

export interface KpiResult {
  def: KpiDef;
  count: number;
  total: number;
  ontimeCount: number | null;
  ontimePool: number | null;
  comment: string;
  // derived
  failCount: number;
  ontimeFailCount: number | null;
  completionPct: number | null;
  ontimePct: number | null;
  scorePct: number | null;
  late: number;
  measurable: boolean;
  met: boolean;
  // A row AroFlo's own data cannot fill: it is left blank, and only an
  // uploaded CSV export fills it (KPIs 12–14 with live data).
  uploadOnly?: boolean;
}

const MS_DAY = 86_400_000;

function isTrue(v: boolean | null): boolean {
  return v === true;
}
function isFalse(v: boolean | null): boolean {
  return v === false;
}

interface Masks {
  count: (r: KpiTaskRow) => boolean;
  total: (r: KpiTaskRow) => boolean;
  ontimeCount: ((r: KpiTaskRow) => boolean) | null;
  ontimePool: ((r: KpiTaskRow) => boolean) | null;
  fail: (r: KpiTaskRow) => boolean; // rows whose failureCategory feeds the comment
}

function masksFor(tier: Tier | null, metric: Metric, now: Date): Masks {
  const nowMs = now.getTime();
  const completedPresent = (r: KpiTaskRow) => Boolean(r.completedAt);
  const matured = (r: KpiTaskRow) =>
    Boolean(r.completedAt) && r.completedAt!.getTime() + INVOICE_SLA_DAYS * MS_DAY < nowMs;

  if (metric === 'commenced' || metric === 'completed') {
    const inTier = (r: KpiTaskRow) => r.tier === tier;
    if (metric === 'commenced') {
      // The pool is every job whose start is decided either way (ingest
      // 5.2): started in time or late — or, with live data, still not
      // started after its time limit.
      return {
        count: (r) => inTier(r) && r.hasCommenced,
        total: inTier,
        ontimeCount: (r) => inTier(r) && isTrue(r.commencedOnTime),
        ontimePool: (r) => inTier(r) && r.commencedOnTime !== null,
        fail: (r) => inTier(r) && isFalse(r.commencedOnTime),
      };
    }
    // The pool is every job whose outcome is known: finished (on time or
    // not), or still open past its due date — late already (ingest 5.3).
    // Open and not yet due is in neither count.
    return {
      count: (r) => inTier(r) && completedPresent(r),
      total: inTier,
      ontimeCount: (r) => inTier(r) && isTrue(r.completedOnTime),
      ontimePool: (r) => inTier(r) && r.completedOnTime !== null,
      fail: (r) => inTier(r) && isFalse(r.completedOnTime),
    };
  }

  if (metric === 'overdue') {
    return {
      count: (r) => isTrue(r.isOverdue) && completedPresent(r),
      total: (r) => isTrue(r.isOverdue),
      ontimeCount: null,
      ontimePool: null,
      fail: (r) => isTrue(r.isOverdue) && !completedPresent(r),
    };
  }

  if (metric === 'invoice') {
    // Spec 7.3 defines count as `invoice_on_time is True` with no maturity
    // gate, but that lets count exceed total and breaks the 7.7 reconciliation
    // invariant. Gating count to matured rows keeps count <= total and makes
    // the comment counts sum to failCount. An immature completion is neither
    // pass nor fail yet.
    return {
      count: (r) => isTrue(r.invoiceOnTime) && matured(r),
      total: matured,
      ontimeCount: null,
      ontimePool: null,
      fail: (r) => isFalse(r.invoiceOnTime) && matured(r),
    };
  }

  if (metric === 'jsa') {
    const name = (r: KpiTaskRow) => r.checklistName === JSA_NAME;
    const passed = (r: KpiTaskRow) => CHECKLIST_PASS.has(r.checklistStatus);
    return {
      count: (r) => name(r) && passed(r) && completedPresent(r),
      total: (r) => name(r) && completedPresent(r),
      ontimeCount: null,
      ontimePool: null,
      fail: (r) => name(r) && completedPresent(r) && !passed(r),
    };
  }

  // issues
  const iname = (r: KpiTaskRow) => r.complianceFormName === ISSUES_FORM_NAME;
  const ipassed = (r: KpiTaskRow) => COMPLIANCE_PASS.has(r.complianceFormStatus);
  return {
    count: (r) => iname(r) && ipassed(r),
    total: iname,
    ontimeCount: null,
    ontimePool: null,
    fail: (r) => iname(r) && !ipassed(r),
  };
}

function commentFor(rows: KpiTaskRow[], fail: (r: KpiTaskRow) => boolean): string {
  const counts = new Map<string, number>();
  for (const r of rows) {
    if (!fail(r)) continue;
    const cat = r.failureCategory || DEFAULT_CATEGORY;
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  if (counts.size === 0) return '';
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat, n]) => `${n} ${cat}`)
    .join(', ');
}

function pct(num: number, den: number | null): number | null {
  if (den === null || den === 0) return null;
  return (100 * num) / den;
}

export function computeKpiResult(rows: KpiTaskRow[], def: KpiDef, now: Date): KpiResult {
  const m = masksFor(def.tier, def.metric, now);
  const count = rows.filter(m.count).length;
  const total = rows.filter(m.total).length;
  const ontimeCount = m.ontimeCount ? rows.filter(m.ontimeCount).length : null;
  const ontimePool = m.ontimePool ? rows.filter(m.ontimePool).length : null;
  const comment = commentFor(rows, m.fail);

  const failCount = total - count;
  const ontimeFailCount = ontimePool === null || ontimeCount === null ? null : ontimePool - ontimeCount;
  const completionPct = pct(count, total);
  const ontimePct = ontimeCount === null ? null : pct(ontimeCount, ontimePool);
  const isSla = def.metric === 'commenced' || def.metric === 'completed';
  const scorePct = isSla ? ontimePct : completionPct;
  const late = ontimeFailCount !== null ? ontimeFailCount : failCount;
  const measurable = scorePct !== null;
  const met = measurable && (scorePct as number) >= def.target;

  return {
    def,
    count,
    total,
    ontimeCount,
    ontimePool,
    comment,
    failCount,
    ontimeFailCount,
    completionPct,
    ontimePct,
    scorePct,
    late,
    measurable,
    met,
  };
}

export function computeKpis(rows: KpiTaskRow[], now: Date = new Date()): KpiResult[] {
  return KPIS.map((def) => computeKpiResult(rows, def, now));
}

export function reconcile(rows: KpiTaskRow[], results: KpiResult[], now: Date = new Date()): string[] {
  const problems: string[] = [];
  for (const res of results) {
    const m = masksFor(res.def.tier, res.def.metric, now);
    const commentRows = rows.filter(m.fail).length;
    const isSla = res.def.metric === 'commenced' || res.def.metric === 'completed';
    const target = isSla ? res.ontimeFailCount : res.failCount;
    if (target !== null && commentRows !== target) {
      problems.push(
        `KPI ${res.def.id} (${res.def.name}): comment rows ${commentRows} != ` +
          `${isSla ? 'ontimeFailCount' : 'failCount'} ${target}`,
      );
    }
    if (res.count > res.total) problems.push(`KPI ${res.def.id} (${res.def.name}): count ${res.count} > total ${res.total}`);
    if (res.ontimePool !== null && res.ontimeCount !== null && res.ontimeCount > res.ontimePool) {
      problems.push(`KPI ${res.def.id} (${res.def.name}): ontimeCount ${res.ontimeCount} > ontimePool ${res.ontimePool}`);
    }
  }
  return problems;
}

// --------------------------------------------------------------------------
// Presentation helpers
// --------------------------------------------------------------------------

export function fmtPct(v: number | null): string {
  return v === null ? 'N/A' : `${Math.round(v)}%`;
}

// Jobs in a Commenced or Completed row that are neither on time nor late
// yet: still inside their time limit. They are a figure of their own and in
// neither side of On time %. Null for the rows that have no such idea.
export function inProgressCount(r: KpiResult): number | null {
  return r.ontimePool === null ? null : r.total - r.ontimePool;
}

// What a row shows in each of its figure columns. A row only an uploaded
// export can fill is blank throughout rather than reading 0 or N/A.
export function matrixCells(r: KpiResult): { pct: string; ontimePct: string; count: string; late: string; inProgress: string } {
  if (r.uploadOnly) return { pct: '', ontimePct: '', count: '', late: '', inProgress: '' };
  const isSla = r.def.metric === 'commenced' || r.def.metric === 'completed';
  const inProgress = inProgressCount(r);
  return {
    pct: fmtPct(r.completionPct),
    ontimePct: isSla ? fmtPct(r.ontimePct) : '',
    count: String(r.count),
    late: String(r.late),
    inProgress: inProgress === null ? '' : String(inProgress),
  };
}

export interface LateJob {
  jobNumber: string;
  task: string;
  tier: string;
  requested: Date | null;
  completed: Date | null;
  daysLate: number;
  category: string;
  // Which deadline it missed: its due date ('finishing'), or only its time
  // limit to be started ('starting').
  lateFor: 'finishing' | 'starting';
}

export interface LateJobOptions {
  // Live data: deadlines are by the day and nothing records when a job was
  // started. Days late are then whole calendar days — the Days Late of the
  // Work Orders page — and a job late to be started is measured up to now.
  byDay?: boolean;
}

// The calendar day a date falls on, as a count of days: the difference of
// two is the days between them, whatever the times of day or daylight saving.
function dayNumber(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_DAY;
}

export function lateJobs(rows: KpiTaskRow[], now: Date = new Date(), options: LateJobOptions = {}): LateJob[] {
  return rows
    .filter((r) => r.taskIsLate)
    .map((r) => {
      // Days late are counted from the deadline that was missed. A job late
      // to finish is measured from its due date; one that was only late to
      // be started, from its time limit for starting — measuring that
      // against a due date still ahead would give days late below zero.
      const finishing = r.completedOnTime === false;
      const end = finishing ? r.completedAt ?? now : options.byDay ? now : r.actualStartAt ?? now;
      const due = finishing ? r.taskDueAt : r.slaDueAt;
      // A job that is late is never shown as 0 days late: finished twenty
      // minutes after its due day ended is a day late by the day, and a
      // tenth of one by the clock.
      let daysLate = 0;
      if (due) {
        daysLate = options.byDay
          ? Math.max(1, dayNumber(end) - dayNumber(due))
          : Math.max(0.1, Math.round(((end.getTime() - due.getTime()) / MS_DAY) * 10) / 10);
      }
      return {
        jobNumber: r.jobNumber,
        task: r.task,
        tier: r.tier ?? '',
        requested: r.requestedAt,
        completed: r.completedAt,
        daysLate,
        category: r.failureCategory,
        lateFor: finishing ? ('finishing' as const) : ('starting' as const),
      };
    })
    .sort((a, b) => b.daysLate - a.daysLate);
}
