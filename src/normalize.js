const { parseAroFloDateTime } = require('./aroflo/aroFloDates');
const config = require('./config');

function safeParseDate(value) {
  if (!value || !String(value).trim()) return null;
  try {
    return parseAroFloDateTime(value);
  } catch {
    return null;
  }
}

function isPastDate(dateStr) {
  const d = safeParseDate(dateStr);
  if (!d) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

function daysBetween(date, reference = new Date()) {
  if (!date) return null;
  const msPerDay = 24 * 60 * 60 * 1000;
  const a = new Date(date);
  a.setHours(0, 0, 0, 0);
  const b = new Date(reference);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / msPerDay);
}

function numOrNull(v) {
  if (v === undefined || v === null || v === '' || (typeof v === 'string' && !v.trim())) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

function cleanStr(v) {
  return typeof v === 'string' ? v.trim() : v || '';
}

// Earliest logged Labour start for a task — AroFlo's most literal "work
// started" signal (ported from aroflo_dash's _actual_start_date). Only
// populated when the Tasks fetch requests `join=labour` (see src/cache.js);
// blank otherwise, same "blank without an explicit join" behaviour AroFlo
// applies to substatus. Returns the raw AroFlo datetime string or null.
function earliestLabourStart(raw) {
  const labours = Array.isArray(raw.labours) ? raw.labours : [];
  const starts = labours
    .map((l) => cleanStr(l && l.workdatetimestart))
    .filter(Boolean)
    .sort();
  return starts.length ? starts[0] : null;
}

// Tasks.client is {clientid, clientname} but Invoices.client is
// {orgid, orgname} — a real inconsistency in AroFlo's own v1 schema, not a
// normalization bug here.
function normalizeTask(raw) {
  const status = cleanStr(raw.status);
  const dueDate = cleanStr(raw.duedate) || null;
  const isComplete = config.completedTaskStatuses.includes(status.toLowerCase());
  const overdue = isPastDate(dueDate) && !isComplete;
  return {
    taskId: raw.taskid,
    jobNumber: cleanStr(raw.jobnumber),
    customerOrderNumber: cleanStr(raw.custon),
    taskName: cleanStr(raw.taskname),
    client: cleanStr(raw.client?.clientname),
    status,
    substatus: cleanStr(raw.substatus?.substatus),
    dueDate,
    overdue,
    // KPI/compliance fields (src/kpi.js). requiredCompletedDate is the same
    // raw field as dueDate above — kept as a separate named field to match
    // aroflo_dash's own vocabulary (required_completed_date), which the KPI
    // module's logic was ported from.
    priorityId: cleanStr(raw.priority),
    priorityLabel: config.kpi.priorityLabels[cleanStr(raw.priority)] || null,
    requestDate: cleanStr(raw.requestdate) || null,
    actualStartDate: earliestLabourStart(raw),
    completedDate: cleanStr(raw.completeddate) || null,
    requiredCompletedDate: dueDate,
    locationName: cleanStr(raw.tasklocation?.locationname) || null,
    // KPI Compliance Matrix, live mode (views.buildKpiMatrixTasks): the
    // date-times behind the dates above — a blank one comes back as " " —
    // and the description its failure categoriser reads.
    requestDateTime: cleanStr(raw.requestdatetime) || null,
    dueDateTime: cleanStr(raw.duedatetime) || null,
    completedDateTime: cleanStr(raw.completeddatetime) || null,
    description: cleanStr(raw.description),
  };
}

function normalizeInvoice(raw) {
  const status = cleanStr(raw.status);
  const dueDate = cleanStr(raw.duedate) || null;
  const isClosed = config.closedInvoiceStatuses.includes(status.toLowerCase());
  const overdue = isPastDate(dueDate) && !isClosed;
  return {
    invoiceId: raw.invoiceid,
    invoiceNumber: cleanStr(raw.invoicenumber),
    client: cleanStr(raw.client?.orgname),
    status,
    deliveryStatus: cleanStr(raw.deliverystatus),
    dateInvoiced: cleanStr(raw.dateinvoiced) || null,
    dueDate,
    overdue,
    totalEx: numOrNull(raw.totalex),
    totalInc: numOrNull(raw.totalinc),
  };
}

// Payment-to-invoice linking shape (linkedto.linkedtotype/linkedtoid) is
// unconfirmed on THIS account — the Payments zone exists and `datepaid` is
// a valid WHERE field, but this account has zero real payment records to
// check the shape against. Field names below match a different AroFlo
// account's confirmed live behavior (same v1 API version) — a reasonable
// bet, not a confirmed fact.
function normalizePayment(raw) {
  const linkedTo = raw.linkedto || {};
  return {
    paymentId: raw.paymentid,
    invoiceId: cleanStr(linkedTo.linkedtotype).toLowerCase() === 'invoice' ? linkedTo.linkedtoid : null,
    amount: numOrNull(raw.amount),
    datePaid: cleanStr(raw.datepaid) || null,
    status: cleanStr(raw.status),
  };
}

module.exports = {
  isPastDate,
  daysBetween,
  normalizeTask,
  normalizeInvoice,
  normalizePayment,
};
