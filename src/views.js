const config = require('./config');
const { parseAroFloDateTime } = require('./aroflo/aroFloDates');
const { daysBetween, isPastDate } = require('./normalize');
const kpi = require('./kpi');
const { delayReasonFor } = require('./delayReason');

const REPORTING_BREAKDOWN_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
const REPORTING_PM_PRIORITIES = ['P5', 'PM'];
const NO_PRIORITY = 'No priority';

// The order priorities are listed in wherever they are listed: up the scale,
// P1 to P4, then P5 and PM — not by how many jobs each has. A priority with
// no level on the scale comes after those, by name, and "No priority" last.
const PRIORITY_SCALE = [...REPORTING_BREAKDOWN_PRIORITIES, ...REPORTING_PM_PRIORITIES];
function comparePriorities(a, b) {
  const rank = (p) => {
    const onScale = PRIORITY_SCALE.indexOf(p);
    if (onScale !== -1) return onScale;
    return p === NO_PRIORITY ? PRIORITY_SCALE.length + 1 : PRIORITY_SCALE.length;
  };
  return rank(a) - rank(b) || String(a).localeCompare(String(b));
}

// Several clients can be picked at once: they arrive as one `view` value,
// joined with this (frontend: reporting/components/ClientMultiSelect.tsx).
const VIEW_SEPARATOR = '||';

function viewParts(view) {
  return String(view || '')
    .split(VIEW_SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);
}

// The work-order reports' client filter: 'overall' is everyone, anything
// else is the real client names to keep.
function tasksInView(tasks, view) {
  const clients = viewParts(view).filter((name) => name !== 'overall');
  return clients.length ? tasks.filter((t) => clients.includes(t.client)) : tasks;
}

// Not yet Completed / Archived (COMPLETED_TASK_STATUSES).
function isOpen(task) {
  return !config.completedTaskStatuses.includes(String(task.status || '').toLowerCase());
}

// Ported from aroflo_dash. `view` is either the sentinel 'overall' (no client
// filter) or real client names to filter to (see tasksInView) — uniform for
// the literal Ventia/SAHA options and any other real client the frontend
// offers (see buildReportingClients below), so nothing here special-cases
// which.
function buildReportingKpis(cache, { dateFrom, dateTo, view }) {
  const { records, lastFetchedAt, error } = cache.get('jobs');
  const { priorityCodeMap, priorityTargets } = config.reporting;
  const delayReasonSubstatuses = config.kpi.delayReasonSubstatuses;
  const prioritiesState = cache.get('priorities');

  // requestDate is always zero-padded "YYYY/MM/DD" (AroFlo v1's own format —
  // see aroFloDates.js), which sorts correctly as a plain string; normalize
  // the incoming filter dates (typically "YYYY-MM-DD" from an HTML date
  // input) to match rather than requiring the caller get the separator right.
  const normalize = (s) => (s ? s.replace(/-/g, '/') : s);
  const from = normalize(dateFrom);
  const to = normalize(dateTo);

  const inRange = records.filter((t) => {
    if (!t.requestDate) return false;
    if (from && t.requestDate < from) return false;
    if (to && t.requestDate > to) return false;
    return true;
  });
  const scoped = tasksInView(inRange, view);
  // Only the Target KPI Compliance section and the P1-P4/PM breakdown tables
  // are priority-scale-specific (aroflo_dash's own General Statistics row is
  // computed from ALL tasks in scope, unfiltered by priority — see kpis.py's
  // compute_kpis taking the full df, while compute_priority_kpi_compliance/
  // build_breakdown_table take the P-coded one). A task whose priority has no
  // level on the scale (src/priorities.js) is DROPPED here, so this must not
  // feed the General Statistics KPIs. kpi.js reads the level from
  // priorityLabel, hence the swap.
  const pCoded = scoped.filter((t) => t.priorityCode).map((t) => ({ ...t, priorityLabel: t.priorityCode }));

  // Two things kpi.buildBreakdownTable's rows get before they go out:
  //
  // The delay reason, from the job's substatus or else its notes
  // (src/delayReason.js) — kpi.js's own only knows an exact substatus match.
  //
  // And the "Task ID" people know, which is AroFlo's job number. The
  // record's own `taskid` is an opaque internal code ("JidaLyxQPEciCg=="),
  // so the rows carry the job number in that field — the table on screen and
  // the Excel / PDF exports all print it as-is.
  const byTaskId = new Map(pCoded.map((t) => [t.taskId, t]));
  const finishRows = (rows) =>
    rows.map((r) => ({
      ...r,
      delayReason: delayReasonFor(byTaskId.get(r.taskId) || {}, r.daysLate),
      taskId: r.jobNumber || r.taskId,
    }));

  // test_all_aroflo fills this from its trigger engine's substatus history.
  // There is no engine here, so kpi.buildBreakdownTable works from each
  // task's CURRENT substatus — and finishRows above then replaces the delay
  // reason it comes up with.
  const breakdownOpts = { delayRelevantByTaskId: {}, delayReasonsOfInterest: delayReasonSubstatuses };

  return {
    summary: {
      ...kpi.computeKpis(scoped),
      // "Outstanding in the system": every loaded work order for these
      // clients that isn't finished, whatever period it was requested in.
      // `outstanding` above is only the ones requested inside the date range.
      openInSystem: tasksInView(records, view).filter(isOpen).length,
    },
    priorityCompliance: kpi.computePriorityKpiCompliance(pCoded, priorityTargets),
    breakdown: finishRows(
      kpi.buildBreakdownTable(pCoded, { priorities: REPORTING_BREAKDOWN_PRIORITIES, ascending: false, ...breakdownOpts }),
    ),
    pmBreakdown: finishRows(
      kpi.buildBreakdownTable(pCoded, { priorities: REPORTING_PM_PRIORITIES, ascending: false, ...breakdownOpts }),
    ),
    // Raw scoped tasks (NOT priority-filtered) for the frontend's own chart
    // aggregation (trend/status/client-comparison need every task; the
    // priority-volume chart only builds P-lanes for tasks whose priority has
    // a level — `priority` is null here for anything without one, same as
    // aroflo_dash's own P-scale charts simply not counting those rows).
    tasks: scoped.map((t) => ({
      taskId: t.taskId,
      client: t.client,
      status: t.status,
      priority: t.priorityCode || null,
      requestDate: t.requestDate,
      completedDate: t.completedDate,
    })),
    meta: {
      lastFetchedAt,
      error,
      // The page uses this to explain an empty P-scale section. Levels now
      // come from AroFlo's own priority names, so it only reads false when
      // there is neither that list nor a configured map to fall back on.
      priorityCodeMapConfigured: prioritiesState.records.length > 0 || Object.keys(priorityCodeMap).length > 0,
    },
  };
}

// Overdue / ageing work report. Every open task past its due date, right now
// — deliberately NOT filtered by the reporting date range (overdue is a "now"
// concept; requestDate could be months back), but it does honour the client
// `view` filter so it lines up with the rest of the Reports tab.
//
// "Past its due date" is worked out here, against today. normalizeTask's own
// `overdue` flag is the same test, but frozen at the moment the data was
// loaded — and with loading now manual, that can be days ago: a job that
// fell due since would be missing while the others' days-overdue kept
// counting up.
//
// It can only count what is loaded: an open job requested before the
// reports' first day (cache.coverageFrom) is not here.
const OVERDUE_BUCKETS = [
  { key: '0-7', label: '0–7 days', min: 0, max: 7 },
  { key: '8-14', label: '8–14 days', min: 8, max: 14 },
  { key: '15-30', label: '15–30 days', min: 15, max: 30 },
  { key: '30+', label: '30+ days', min: 31, max: Infinity },
];

function overdueBucketFor(days) {
  const b = OVERDUE_BUCKETS.find((x) => days >= x.min && days <= x.max);
  return (b || OVERDUE_BUCKETS[OVERDUE_BUCKETS.length - 1]).key;
}

function daysOverdueOf(dueDate, today) {
  try {
    return Math.max(daysBetween(parseAroFloDateTime(dueDate), today), 0);
  } catch {
    return null;
  }
}

function buildOverdueAgeing(cache, { view } = {}) {
  const { records, lastFetchedAt, error } = cache.get('jobs');
  const today = new Date();

  const scoped = tasksInView(records, view);
  const overdue = scoped.filter((t) => isOpen(t) && isPastDate(t.dueDate));

  const zeroBuckets = () => Object.fromEntries(OVERDUE_BUCKETS.map((b) => [b.key, 0]));
  const bucketCounts = zeroBuckets();
  const byPriority = new Map();
  const byClient = new Map();
  const bySite = new Map();
  const rows = [];

  for (const t of overdue) {
    const days = daysOverdueOf(t.requiredCompletedDate, today);
    const bucket = days === null ? null : overdueBucketFor(days);
    if (bucket) bucketCounts[bucket] += 1;

    // Grouped by level where the priority has one, so P1 and AP1 count
    // together; anything off the scale keeps the name AroFlo gives it. Each
    // row also carries that name as-is, for the table.
    const priorityName = t.priorityLabel || NO_PRIORITY;
    const priority = t.priorityCode || priorityName;
    const client = t.client || 'Unknown';
    const site = t.locationName || 'Unknown';

    if (!byPriority.has(priority)) byPriority.set(priority, { priority, total: 0, ...zeroBuckets() });
    const pr = byPriority.get(priority);
    pr.total += 1;
    if (bucket) pr[bucket] += 1;

    byClient.set(client, (byClient.get(client) || 0) + 1);
    bySite.set(site, (bySite.get(site) || 0) + 1);

    rows.push({
      taskId: t.taskId,
      jobNumber: t.jobNumber,
      taskName: t.taskName,
      client,
      priority,
      priorityName,
      site,
      dueDate: t.requiredCompletedDate,
      daysOverdue: days,
      status: t.status,
    });
  }

  rows.sort((a, b) => (b.daysOverdue || 0) - (a.daysOverdue || 0));

  return {
    data: {
      total: overdue.length,
      oldestDays: rows.length ? rows[0].daysOverdue : null,
      buckets: OVERDUE_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: bucketCounts[b.key] })),
      byPriority: [...byPriority.values()].sort((a, b) => comparePriorities(a.priority, b.priority)),
      byClient: [...byClient.entries()].map(([client, total]) => ({ client, total })).sort((a, b) => b.total - a.total),
      bySite: [...bySite.entries()].map(([site, total]) => ({ site, total })).sort((a, b) => b.total - a.total),
      rows,
    },
    meta: { lastFetchedAt, error, today: today.toISOString().slice(0, 10), view: view || 'overall' },
  };
}

// --------------------------------------------------------------------------
// Invoicing report (ported from aroflo_dash's invoicing.py + app.py
// render_invoicing_page). A second report, separate from the work-order KPIs:
// how much has been invoiced / paid / is outstanding, split by client bucket.
//
// Client bucketing is DELIBERATELY different from the work-order report: that
// one hard-filters to just SAHA + Ventia, this one keeps every client and
// sorts each into Ventia / SAHA / Projects-Other (the catch-all). Nothing is
// dropped.
// --------------------------------------------------------------------------

const INVOICE_BUCKETS = ['Ventia', 'SAHA', 'Projects/Other'];

const _BUCKET_BY_CLIENT_NAME = Object.fromEntries(
  Object.entries(config.reporting.targetClients)
    .filter(([, short]) => short === 'Ventia' || short === 'SAHA')
    .map(([full, short]) => [full, short]),
);

function invoiceClientBucket(name) {
  return _BUCKET_BY_CLIENT_NAME[name] || 'Projects/Other';
}

const INVOICE_VIEW_BUCKETS = {
  all: INVOICE_BUCKETS,
  Ventia: ['Ventia'],
  SAHA: ['SAHA'],
  others: ['Projects/Other'],
};

function titleCase(s) {
  return String(s || '')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

function _invoicesWithPayments(cache) {
  const invoicesState = cache.get('invoices');
  const paymentsState = cache.get('payments');
  const paidByInvoiceId = new Map();
  for (const p of paymentsState.records) {
    if (!p.invoiceId || p.amount === null) continue;
    paidByInvoiceId.set(p.invoiceId, (paidByInvoiceId.get(p.invoiceId) || 0) + p.amount);
  }
  const submitted = new Set(config.reporting.submittedInvoiceStatuses);
  const rows = invoicesState.records.map((inv) => {
    const amountPaid = paidByInvoiceId.get(inv.invoiceId) || 0;
    const isPaid = amountPaid > 0 && inv.totalInc !== null && amountPaid >= inv.totalInc - 0.01;
    return {
      ...inv,
      amountPaid,
      isPaid,
      isSubmitted: submitted.has(String(inv.status || '').toLowerCase()),
      clientBucket: invoiceClientBucket(inv.client),
    };
  });
  return {
    rows,
    meta: {
      lastFetchedAt: invoicesState.lastFetchedAt,
      error: invoicesState.error,
      paymentsError: paymentsState.error,
      // Loaded, but not all of it — see DashboardCache.refreshZone.
      paymentsWarning: paymentsState.warning || null,
      paymentsLastFetchedAt: paymentsState.lastFetchedAt,
      paymentsRecordCount: paymentsState.records.length,
    },
  };
}

function _sum(rows, key) {
  return Math.round(rows.reduce((s, r) => s + (Number(r[key]) || 0), 0) * 100) / 100;
}

function buildInvoicingReport(cache, { view, dateFrom, dateTo } = {}) {
  const { rows: allRows, meta } = _invoicesWithPayments(cache);

  const norm = (s) => (s ? String(s).replace(/-/g, '/') : s);
  const from = norm(dateFrom);
  const to = norm(dateTo);
  // One or more of the bucket views above; nothing recognised means all.
  const picked = viewParts(view).flatMap((v) => INVOICE_VIEW_BUCKETS[v] || []);
  const activeBuckets = picked.length ? INVOICE_BUCKETS.filter((b) => picked.includes(b)) : INVOICE_BUCKETS;

  const inRange = allRows.filter((r) => {
    if (from && (!r.dateInvoiced || r.dateInvoiced < from)) return false;
    if (to && (!r.dateInvoiced || r.dateInvoiced > to)) return false;
    return activeBuckets.includes(r.clientBucket);
  });
  const submitted = inRange.filter((r) => r.isSubmitted);
  const paid = submitted.filter((r) => r.isPaid);
  const unpaid = submitted.filter((r) => !r.isPaid);

  const kpis = {
    submittedCount: submitted.length,
    submittedTotalInc: _sum(submitted, 'totalInc'),
    submittedTotalEx: _sum(submitted, 'totalEx'),
    paidCount: paid.length,
    paidTotalInc: _sum(paid, 'totalInc'),
    unpaidCount: unpaid.length,
    unpaidTotalInc: _sum(unpaid, 'totalInc'),
  };

  // By client bucket (submitted only) + Total row
  const byClient = activeBuckets.map((bucket) => {
    const sub = submitted.filter((r) => r.clientBucket === bucket);
    const sp = sub.filter((r) => r.isPaid);
    const su = sub.filter((r) => !r.isPaid);
    return {
      client: bucket,
      submittedCount: sub.length,
      totalInc: _sum(sub, 'totalInc'),
      totalEx: _sum(sub, 'totalEx'),
      paidCount: sp.length,
      paidValue: _sum(sp, 'totalInc'),
      unpaidCount: su.length,
      unpaidValue: _sum(su, 'totalInc'),
    };
  });
  byClient.push({
    client: 'Total',
    submittedCount: byClient.reduce((s, r) => s + r.submittedCount, 0),
    totalInc: _sum(byClient, 'totalInc'),
    totalEx: _sum(byClient, 'totalEx'),
    paidCount: byClient.reduce((s, r) => s + r.paidCount, 0),
    paidValue: _sum(byClient, 'paidValue'),
    unpaidCount: byClient.reduce((s, r) => s + r.unpaidCount, 0),
    unpaidValue: _sum(byClient, 'unpaidValue'),
  });

  // By status x client bucket (EVERY invoice in range, drafts included)
  const knownStatuses = config.reporting.invoiceStatusOrder;
  const seenUnknown = [
    ...new Set(inRange.map((r) => String(r.status || '').toLowerCase()).filter((s) => s && !knownStatuses.includes(s))),
  ].sort();
  const statuses = [...knownStatuses, ...seenUnknown];
  const multiBucket = activeBuckets.length > 1;

  const byStatus = [];
  for (const status of statuses) {
    const statusRows = inRange.filter((r) => String(r.status || '').toLowerCase() === status);
    const perBucket = activeBuckets.map((bucket) => {
      const sub = statusRows.filter((r) => r.clientBucket === bucket);
      return {
        status: titleCase(status),
        client: bucket,
        count: sub.length,
        totalInc: _sum(sub, 'totalInc'),
        totalEx: _sum(sub, 'totalEx'),
      };
    });
    byStatus.push(...perBucket);
    if (multiBucket) {
      byStatus.push({
        status: titleCase(status),
        client: 'Subtotal',
        count: perBucket.reduce((s, r) => s + r.count, 0),
        totalInc: _sum(perBucket, 'totalInc'),
        totalEx: _sum(perBucket, 'totalEx'),
      });
    }
  }
  const totalSource = multiBucket ? byStatus.filter((r) => r.client === 'Subtotal') : byStatus;
  byStatus.push({
    status: 'Total',
    client: '',
    count: totalSource.reduce((s, r) => s + r.count, 0),
    totalInc: _sum(totalSource, 'totalInc'),
    totalEx: _sum(totalSource, 'totalEx'),
  });

  // Flat invoice list, sorted by date invoiced
  const invoiceList = [...inRange]
    .sort((a, b) => (a.dateInvoiced || '').localeCompare(b.dateInvoiced || ''))
    .map((r) => ({
      invoiceNumber: r.invoiceNumber,
      client: r.client,
      clientBucket: r.clientBucket,
      status: titleCase(r.status),
      dateInvoiced: r.dateInvoiced,
      dueDate: r.dueDate,
      totalInc: r.totalInc,
      totalEx: r.totalEx,
      paid: r.isPaid ? 'Yes' : 'No',
    }));

  return {
    data: { kpis, byClient, byStatus, invoiceList, buckets: activeBuckets },
    meta: {
      ...meta,
      view: view || 'all',
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      // True only when the payments behind "Paid" are all there: loaded,
      // without an error, and not cut short or narrowed (paymentsWarning).
      // The page says which when it isn't.
      paymentsCoverFullRange: meta.paymentsRecordCount > 0 && !meta.paymentsError && !meta.paymentsWarning,
    },
  };
}

// Task rows for the KPI Compliance Matrix's live mode. The matrix is computed
// in the browser (frontend/src/reporting/kpiMatrix) by the same engine that
// reads an uploaded CSV export, so this only hands over the fields that
// export carries — every task, unfiltered: the matrix does its own month /
// tier / client filtering. Not here because AroFlo's API doesn't expose
// them: a task's invoice date, checklists and compliance forms (KPIs 12-14).
function buildKpiMatrixTasks(cache) {
  const { records, lastFetchedAt, error } = cache.get('jobs');
  // The matrix has to call the same jobs late that the Work Orders page calls
  // overdue (kpi.isOverdue), so it is handed "finished" and "due" the way
  // that page reads them:
  //   - finished is what the status says (COMPLETED_TASK_STATUSES). A
  //     reopened job can still carry the date it was first completed; it is
  //     open, and goes over as open.
  //   - a finished job with no completed date can't be judged against its
  //     due date — Work Orders leaves it out of Overdue — so it goes over
  //     with no due date, rather than looking like an open job run past it.
  return {
    data: records.map((t) => {
      const open = isOpen(t);
      const completedAt = open ? null : t.completedDateTime || t.completedDate || null;
      return {
        jobNumber: t.jobNumber,
        taskName: t.taskName,
        client: t.client,
        status: t.status,
        substatus: t.substatus,
        // The matrix tiers on the P-scale, so it gets the level. A priority
        // without one goes over under its AroFlo name (or bare id), so the
        // matrix's diagnostics can say what it is instead of silently dropping it.
        priority: t.priorityCode || t.priorityLabel || t.priorityId,
        requestedAt: t.requestDateTime || t.requestDate,
        dueAt: !open && !completedAt ? null : t.dueDateTime || t.dueDate,
        startedAt: t.actualStartDate,
        completedAt,
        description: t.description,
      };
    }),
    meta: { lastFetchedAt, error },
  };
}

// Distinct real client names present in the loaded task set — powers the
// Reports page's "add other clients" filter options alongside the literal
// Ventia/SAHA entries from config.reporting.targetClients.
function buildReportingClients(cache) {
  const { records } = cache.get('jobs');
  const names = new Set(records.map((t) => t.client).filter(Boolean));
  return { data: [...names].sort((a, b) => a.localeCompare(b)) };
}

module.exports = {
  buildReportingKpis,
  buildReportingClients,
  buildOverdueAgeing,
  buildInvoicingReport,
  buildKpiMatrixTasks,
  invoiceClientBucket,
};
