const config = require('./config');
const { parseAroFloDateTime } = require('./aroflo/aroFloDates');
const { daysBetween } = require('./normalize');
const kpi = require('./kpi');

const REPORTING_BREAKDOWN_PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
const REPORTING_PM_PRIORITIES = ['P5', 'PM'];

// Ported from aroflo_dash. `view` is either the sentinel 'overall' (no client
// filter) or a literal real client name to filter to — uniform for the
// literal Ventia/SAHA options and any other real client the frontend offers
// (see buildReportingClients below), so nothing here special-cases which.
function buildReportingKpis(cache, { dateFrom, dateTo, view }) {
  const { records, lastFetchedAt, error } = cache.get('jobs');
  const { priorityCodeMap, priorityTargets } = config.reporting;
  const delayReasonSubstatuses = config.kpi.delayReasonSubstatuses;

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
  const scoped = view && view !== 'overall' ? inRange.filter((t) => t.client === view) : inRange;
  // Only the Target KPI Compliance section and the P1-P4/PM breakdown tables
  // are priority-scale-specific (aroflo_dash's own General Statistics row is
  // computed from ALL tasks in scope, unfiltered by priority — see kpis.py's
  // compute_kpis taking the full df, while compute_priority_kpi_compliance/
  // build_breakdown_table take the P-coded one) — applyPriorityCodeMap DROPS
  // any task with no mapping, so it must not feed the General Statistics KPIs.
  const pCoded = kpi.applyPriorityCodeMap(scoped, priorityCodeMap);

  // test_all_aroflo fills this from its trigger engine's substatus history.
  // There is no engine here, so the breakdown's delay reason always falls
  // back to each task's CURRENT substatus (kpi.buildBreakdownTable).
  const breakdownOpts = { delayRelevantByTaskId: {}, delayReasonsOfInterest: delayReasonSubstatuses };

  return {
    summary: kpi.computeKpis(scoped),
    priorityCompliance: kpi.computePriorityKpiCompliance(pCoded, priorityTargets),
    breakdown: kpi.buildBreakdownTable(pCoded, { priorities: REPORTING_BREAKDOWN_PRIORITIES, ascending: false, ...breakdownOpts }),
    pmBreakdown: kpi.buildBreakdownTable(pCoded, { priorities: REPORTING_PM_PRIORITIES, ascending: false, ...breakdownOpts }),
    // Raw scoped tasks (NOT priority-filtered) for the frontend's own chart
    // aggregation (trend/status/client-comparison need every task; the
    // priority-volume chart only builds P-lanes for tasks whose priority did
    // map — `priority` is null here for anything unmapped, same as
    // aroflo_dash's own P-scale charts simply not counting those rows).
    tasks: scoped.map((t) => ({
      taskId: t.taskId,
      client: t.client,
      status: t.status,
      priority: priorityCodeMap[t.priorityLabel] || null,
      requestDate: t.requestDate,
      completedDate: t.completedDate,
    })),
    meta: {
      lastFetchedAt,
      error,
      priorityCodeMapConfigured: Object.keys(priorityCodeMap).length > 0,
    },
  };
}

// Overdue / ageing work report. Every open task past its due date, right now
// — deliberately NOT filtered by the reporting date range (overdue is a "now"
// concept; requestDate could be months back), but it does honour the client
// `view` filter so it lines up with the rest of the Reports tab. Uses the
// same `t.overdue` flag normalizeTask already computes
// (isPastDate(dueDate) && !completed).
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

  const scoped = view && view !== 'overall' ? records.filter((t) => t.client === view) : records;
  const overdue = scoped.filter((t) => t.overdue === true);

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

    const priority = t.priorityLabel || 'Unmapped';
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
      byPriority: [...byPriority.values()].sort((a, b) => b.total - a.total),
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
  const activeBuckets = INVOICE_VIEW_BUCKETS[view] || INVOICE_BUCKETS;

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
      // AroFlo's Payments zone only reliably returns ~the last 30 days; this
      // account currently returns 0 payment records at all. Surfaced in the UI.
      paymentsCoverFullRange: meta.paymentsRecordCount > 0 && !meta.paymentsError,
    },
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
};
