const { parseAroFloDateTime } = require('./aroflo/aroFloDates');
const config = require('./config');
const { resolvePriority } = require('./priorities');
const { zonedNow } = require('./time');

function safeParseDate(value) {
  if (!value || !String(value).trim()) return null;
  try {
    return parseAroFloDateTime(value);
  } catch {
    return null;
  }
}

// "Today" here and below is the day in the reports' time zone (src/time.js),
// whatever this machine's clock is set to.
function isPastDate(dateStr) {
  const d = safeParseDate(dateStr);
  if (!d) return false;
  const today = zonedNow();
  today.setHours(0, 0, 0, 0);
  return d.getTime() < today.getTime();
}

function daysBetween(date, reference = zonedNow()) {
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

// The staff notes on a task as one line of plain text, oldest first. Only
// there when the Tasks fetch asks for `join=notes` (src/cache.js) — without
// it AroFlo sends `tasknotes: []` for every task. Read for a late job's
// likely delay reason (src/delayReason.js); never sent to the browser.
function flattenNotes(raw) {
  const notes = Array.isArray(raw.tasknotes) ? raw.tasknotes.filter((n) => n && typeof n === 'object') : [];
  const posted = (n) => `${cleanStr(n.dateposted)} ${cleanStr(n.timeposted)}`;
  return notes
    .slice()
    .sort((a, b) => posted(a).localeCompare(posted(b)))
    .map((n) =>
      String(cleanStr(n.content))
        .replace(/<[^>]*>/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join(' | ');
}

// Tasks.client is {clientid, clientname} but Invoices.client is
// {orgid, orgname} — a real inconsistency in AroFlo's own v1 schema, not a
// normalization bug here.
//
// `priorities` is the account's own priority list by id (src/priorities.js),
// used to put a name and a P-scale level to the id the task carries.
function normalizeTask(raw, priorities = new Map()) {
  const status = cleanStr(raw.status);
  const dueDate = cleanStr(raw.duedate) || null;
  const isComplete = config.completedTaskStatuses.includes(status.toLowerCase());
  const overdue = isPastDate(dueDate) && !isComplete;
  const priorityId = cleanStr(raw.priority);
  const priority = resolvePriority(priorityId, priorities);
  return {
    taskId: raw.taskid,
    jobNumber: cleanStr(raw.jobnumber),
    customerOrderNumber: cleanStr(raw.custon),
    taskName: cleanStr(raw.taskname),
    client: cleanStr(raw.client?.clientname),
    // The business unit that owns the job. The reports keep only the ones
    // they are for (src/businessUnit.js).
    businessUnit: cleanStr(raw.org?.orgname),
    status,
    substatus: cleanStr(raw.substatus?.substatus),
    dueDate,
    overdue,
    // KPI/compliance fields (src/kpi.js). requiredCompletedDate is the same
    // raw field as dueDate above — kept as a separate named field to match
    // aroflo_dash's own vocabulary (required_completed_date), which the KPI
    // module's logic was ported from.
    priorityId,
    // priorityLabel is what AroFlo calls the priority ("AP1"); priorityCode
    // is the level it is reported under ("P1"), or null if it has none; and
    // priorityLevel is the level its own name states, which differs only
    // for AP5: level "P5", reported as "P4".
    priorityLabel: priority.label,
    priorityCode: priority.code,
    priorityLevel: priority.level,
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
    notes: flattenNotes(raw),
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
    // `org` is the business unit that raised it; `client`, above, who it is to.
    businessUnit: cleanStr(raw.org?.orgname),
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
