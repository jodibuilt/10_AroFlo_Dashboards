const logger = require('./logger');
const { invoiceClientBucket } = require('./views');

// After each refresh: one log entry describing what actually came back from
// AroFlo, so "are the dashboards right?" can be answered from facts instead
// of assumed. Everything here is a count or a date range — the things that,
// when wrong, are wrong silently:
//   - the period covered (AroFlo narrows an unfiltered request to 30 days);
//   - statuses in use (a status the app doesn't know as "completed" changes
//     every completion and overdue figure);
//   - whether work orders carry the dates the KPIs are worked out from;
//   - whether payments actually link to the invoices held (if they don't,
//     every invoice reads as unpaid);
//   - how invoices fall into the client groups (a client name that differs
//     from the configured one lands in Projects/Other).

function tally(records, pick) {
  const counts = {};
  for (const r of records) {
    const key = pick(r) || '(blank)';
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function span(records, pick) {
  const values = records.map(pick).filter(Boolean).sort();
  return values.length ? `${values[0]} to ${values[values.length - 1]}` : 'none';
}

const having = (records, pick) => records.filter((r) => pick(r)).length;

function logDataCheck(cache) {
  const jobs = cache.get('jobs').records;
  const invoices = cache.get('invoices').records;
  const payments = cache.get('payments').records;

  const invoiceIds = new Set(invoices.map((i) => i.invoiceId));
  const linked = payments.filter((p) => p.invoiceId);
  const paidInvoiceIds = new Set(linked.filter((p) => invoiceIds.has(p.invoiceId)).map((p) => p.invoiceId));

  logger.info('Data check', {
    coveredFrom: cache.coverageFrom,
    workOrders: {
      count: jobs.length,
      requested: span(jobs, (t) => t.requestDate),
      statuses: tally(jobs, (t) => t.status),
      // The candidates for KPI_DELAY_REASON_SUBSTATUSES: which of these mean
      // "waiting on materials" or "couldn't get access" is a business call.
      substatuses: tally(jobs, (t) => t.substatus),
      withDueDate: having(jobs, (t) => t.dueDate),
      withCompletedDate: having(jobs, (t) => t.completedDate),
      withLabourLogged: having(jobs, (t) => t.actualStartDate),
      // One raw value, to confirm its format is the one the KPI Matrix reads.
      labourStartLooksLike: (jobs.find((t) => t.actualStartDate) || {}).actualStartDate || null,
      withoutJobNumber: jobs.length - having(jobs, (t) => t.jobNumber),
      withoutClient: jobs.length - having(jobs, (t) => t.client),
    },
    invoices: {
      count: invoices.length,
      invoiced: span(invoices, (i) => i.dateInvoiced),
      withoutInvoiceDate: invoices.length - having(invoices, (i) => i.dateInvoiced),
      statuses: tally(invoices, (i) => i.status),
      byClientGroup: tally(invoices, (i) => invoiceClientBucket(i.client)),
    },
    payments: {
      count: payments.length,
      paid: span(payments, (p) => p.datePaid),
      linkedToAnInvoice: linked.length,
      invoicesHeldWithAPayment: paidInvoiceIds.size,
    },
    notes: Object.fromEntries(
      ['jobs', 'invoices', 'payments']
        .map((key) => [key, cache.get(key).error || cache.get(key).warning])
        .filter(([, note]) => note),
    ),
  });
}

module.exports = { logDataCheck };
