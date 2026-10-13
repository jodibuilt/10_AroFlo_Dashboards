// Shared by the tests. Settings are pinned here, before anything loads
// src/config.js, so the answers don't depend on what a local .env says
// (dotenv never overrides a variable that is already set).
Object.assign(process.env, {
  COMPLETED_TASK_STATUSES: 'Completed,Archived',
  CLOSED_INVOICE_STATUSES: 'processed,paid',
  KPI_PRIORITY_LABELS_JSON: '',
  KPI_PRIORITY_CODE_MAP_JSON: '',
  KPI_REPORTING_PRIORITY_TARGETS_JSON: '',
  KPI_TARGET_CLIENTS_JSON: '',
  KPI_DELAY_REASON_SUBSTATUSES: '',
  KPI_SUBMITTED_INVOICE_STATUSES: '',
  KPI_INVOICE_STATUS_ORDER: '',
  REPORT_LOOKBACK_MONTHS: '2',
  // Small pages and no pauses, so the AroFlo tests are quick.
  PAGE_SIZE: '5',
  MAX_PAGES_PER_ZONE: '3',
  INTER_ZONE_DELAY_MS: '0',
  LOG_LEVEL: 'error',
});

const { normalizeTask, normalizeInvoice, normalizePayment } = require('../src/normalize');
const { normalizePriority } = require('../src/priorities');
const { zonedNow } = require('../src/time');

const pad = (n) => String(n).padStart(2, '0');

// A date `offset` days from today, the way AroFlo writes one: YYYY/MM/DD.
// Today in Adelaide, as the reports take it — not this machine's today, or
// the tests would only pass on a machine set to Adelaide time.
function day(offset = 0) {
  const d = zonedNow();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

// The account's priority list, as the Priorities zone returns it.
const PRIORITIES = [
  ['id-p1', 'P1'],
  ['id-p2', 'P2'],
  ['id-p3', 'P3'],
  ['id-p4', 'P4'],
  ['id-ap1', 'AP1'],
  ['id-ap5', 'AP5'],
  ['id-pm', 'PM'],
  ['id-sm', 'SM'],
  ['id-phone', 'PHONECALL'],
].map(([priorityid, shortdescription]) => normalizePriority({ priorityid, shortdescription, description: shortdescription }));
const PRIORITY_MAP = new Map(PRIORITIES.map((p) => [p.priorityId, p]));

let nextJob = 1000;

// A raw Tasks-zone record, with AroFlo's own quirks: a blank date-time is a
// single space, a date-only due is midnight. `notes` are the note texts,
// oldest first.
function rawTask({ client = 'Ventia', priority = 'id-p3', status = 'In Progress', substatus = '', notes = [], requested = day(-3), due = null, completed = null, started = null, job } = {}) {
  const n = job ?? nextJob++;
  return {
    taskid: `internal-${n}==`,
    jobnumber: String(n),
    taskname: `Job ${n}`,
    status,
    substatus: { substatusid: '', substatus },
    tasknotes: notes.map((content, i) => ({ noteid: `n${i}`, dateposted: day(-20 + i), timeposted: '10:00:00', content })),
    priority,
    client: { clientid: 'c', clientname: client },
    tasklocation: { locationid: '', locationname: 'Site A' },
    requestdate: requested,
    requestdatetime: `${requested} 09:00:00`,
    duedate: due || '',
    duedatetime: due ? `${due} 00:00:00` : ' ',
    completeddate: completed || '',
    completeddatetime: completed ? `${completed} 15:00:00` : ' ',
    labours: started ? [{ workdatetimestart: `${started} 08:00:00` }] : [],
    description: '',
  };
}

const task = (fields) => normalizeTask(rawTask(fields), PRIORITY_MAP);

function invoice({ id, client = 'Ventia', status = 'Approved', invoiced = day(-2), inc = 110, ex = 100 }) {
  return normalizeInvoice({
    invoiceid: id,
    invoicenumber: `INV-${id}`,
    client: { orgid: 'o', orgname: client },
    status,
    deliverystatus: '',
    dateinvoiced: invoiced,
    duedate: day(28),
    totalex: String(ex),
    totalinc: String(inc),
  });
}

function payment({ id, invoiceId, amount, paid = day(-1) }) {
  return normalizePayment({ paymentid: id, linkedto: { linkedtotype: 'Invoice', linkedtoid: invoiceId }, amount: String(amount), datepaid: paid, status: 'Paid' });
}

// Stands in for the DashboardCache the report builders read from.
function cacheOf({ jobs = [], invoices = [], payments = [], priorities = PRIORITIES } = {}) {
  const zone = (records) => ({ records, lastFetchedAt: new Date().toISOString(), error: null, isRefreshing: false });
  const state = { jobs: zone(jobs), invoices: zone(invoices), payments: zone(payments), priorities: zone(priorities) };
  return { get: (key) => state[key] };
}

module.exports = { day, rawTask, task, invoice, payment, cacheOf, PRIORITY_MAP, now: zonedNow };
