require('dotenv').config();

function parseList(raw, fallback) {
  const list = (raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return list.length ? list : fallback;
}

function parseJson(raw, fallback) {
  if (!raw || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// Env var names are kept identical to test_all_aroflo's, so an existing .env
// (or set of App Service app settings) works here unchanged — this app just
// reads fewer of them.
const config = {
  port: Number(process.env.PORT || 4300),
  aroflo: {
    baseUrl: process.env.AROFLO_API_BASE_URL || 'https://api.aroflo.com/',
    secretKey: process.env.AROFLO_SECRET_KEY || '',
    uEncoded: process.env.AROFLO_UENCODED || '',
    pEncoded: process.env.AROFLO_PENCODED || '',
    orgEncoded: process.env.AROFLO_ORG_ENCODED || '',
    accept: process.env.AROFLO_ACCEPT || 'text/json',
    hostIp: process.env.AROFLO_HOST_IP || '',
  },
  // The business units the reports are for, by the name AroFlo gives them.
  // One login can see several; work orders and invoices owned by any other
  // are dropped as they are loaded (src/businessUnit.js). Names are compared
  // on letters and digits only, so "TTS - RMS" and "tts rms" are one name.
  // "*" = every business unit the login can see.
  businessUnits: parseList(process.env.AROFLO_BUSINESS_UNITS, ['TTS RMS']),
  // The Workloads page (src/workload/).
  workload: {
    // The secret AroFlo's Event Messages carry (?token=…) when they POST to
    // /webhooks/aroflo/…. Empty = that address answers 404 and the page
    // moves only on "Update now".
    webhookSecret: process.env.WORKLOAD_WEBHOOK_SECRET || '',
    // Shortest gap between presses of "Update now", across all users. Each
    // one spends two or three requests from the shared daily allowance.
    minUpdateIntervalSeconds: Number(process.env.WORKLOAD_MIN_UPDATE_INTERVAL_SECONDS || 20),
  },
  rateLimitPerSecond: Number(process.env.RATE_LIMIT_PER_SECOND || 1),
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 60),
  interZoneDelayMs: Number(process.env.INTER_ZONE_DELAY_MS || 750),
  pageSize: Number(process.env.PAGE_SIZE || 200),
  maxPagesPerZone: Number(process.env.MAX_PAGES_PER_ZONE || 25),
  minManualRefreshIntervalSeconds: Number(process.env.MIN_MANUAL_REFRESH_INTERVAL_SECONDS || 30),
  completedTaskStatuses: parseList(process.env.COMPLETED_TASK_STATUSES, ['completed', 'archived']).map((s) =>
    s.toLowerCase()
  ),
  closedInvoiceStatuses: parseList(process.env.CLOSED_INVOICE_STATUSES, ['processed', 'paid']).map((s) =>
    s.toLowerCase()
  ),
  logLevel: process.env.LOG_LEVEL || 'info',
  // The time zone the reports run on: what day "today" is (overdue, days
  // late, the month just started) and how times are shown. Fixed, so it
  // doesn't follow the server's own clock setting or each person's browser
  // (src/time.js). An IANA name.
  timeZone: process.env.REPORT_TIME_ZONE || 'Australia/Adelaide',
  db: {
    // Nav visibility + per-user Reports edits (src/db.js). Relative to the
    // project root unless absolute — on App Service point this at /home/data
    // so it survives redeploys.
    path: process.env.APP_DB_PATH || 'data/dashboards.sqlite',
  },
  auth: {
    dbPath: process.env.AUTH_DB_PATH || 'data/auth.sqlite',
    sessionTtlDays: Number(process.env.SESSION_TTL_DAYS || 30),
    cookieName: process.env.AUTH_COOKIE_NAME || 'af_session',
    // "true" once this is served over HTTPS (always, on App Service). A
    // secure cookie is silently dropped over plain HTTP, so leave it false
    // for local dev on http://localhost.
    cookieSecure: process.env.COOKIE_SECURE === 'true',
    adminUsername: process.env.ADMIN_USERNAME || '',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    adminDisplayName: process.env.ADMIN_DISPLAY_NAME || 'Admin',
  },
  // How far back the reports reach: work orders, invoices and payments are
  // loaded from the first day of the month this many months before the
  // current one. AroFlo has to be TOLD — asked for a zone without a date
  // filter it quietly returns only the last 30 days. Whole months, so a
  // month picked on the KPI Matrix is never half there.
  lookbackMonths: Number(process.env.REPORT_LOOKBACK_MONTHS || 2),
  kpi: {
    // {priorityid: name} — a FALLBACK only. Priority names are read live from
    // AroFlo's Priorities zone (src/priorities.js); this fills in for an id
    // that list doesn't return. The defaults are the test account's ids.
    priorityLabels: parseJson(process.env.KPI_PRIORITY_LABELS_JSON, {
      IydaKyMK: 'Emergency',
      IydaKywK: 'Urgent',
      IydaKy0K: 'Standard',
      IydKTyQK: 'After Hours',
    }),
    // The substatuses that mean a job is held up for a reason outside the
    // team's control — what "Delay Reason" reports for a late job
    // (src/delayReason.js). The first three are the TTS account's own,
    // confirmed for the earlier dashboard; "Sent to Procurement" is waiting
    // on materials too (confirmed 2026-10-12). Like the rest it is only a
    // reason on a job that is past due — a job sitting in procurement with
    // time in hand is not late. Matched without regard to case.
    delayReasonSubstatuses: parseList(process.env.KPI_DELAY_REASON_SUBSTATUSES, [
      'Non Access',
      'Materials Ordered',
      'On Hold/Materials Required',
      'Sent to Procurement',
    ]),
  },
  // Reporting Dashboard (ported from aroflo_dash). Its P1-P5/PM structure and
  // SLA percentages are aroflo_dash's own generic reporting convention kept
  // literal, but the priorityid->P-code MAPPING is account-specific.
  reporting: {
    // {AroFlo priority name: "P1"|"P2"|"P3"|"P4"|"P5"|"PM"} — only for names
    // that don't state their own level. "P2", "AP2", "PM" and "SM" are read
    // from the name itself (src/priorities.js) and need no entry here; an
    // entry here wins if there is one. The defaults cover the test account,
    // whose four priorities are plain words.
    priorityCodeMap: parseJson(process.env.KPI_PRIORITY_CODE_MAP_JSON, {
      Emergency: 'P1',
      Urgent: 'P2',
      Standard: 'P3',
      'After Hours': 'P4',
    }),
    // Literal aroflo_dash SLA percentages — generic numbers, not account
    // internals, safe to default (P5 deliberately has no target, same as source).
    priorityTargets: parseJson(process.env.KPI_REPORTING_PRIORITY_TARGETS_JSON, {
      P1: 98, P2: 95, P3: 90, P4: 90, PM: 90,
    }),
    // {realClientName: shortLabel}. The Reports page's client filter
    // additionally offers every OTHER real client name found in the loaded
    // data (see buildReportingClients in views.js).
    targetClients: parseJson(process.env.KPI_TARGET_CLIENTS_JSON, {
      Ventia: 'Ventia',
      'South Australian Housing Trust': 'SAHA',
    }),
    reportTitle: process.env.KPI_REPORT_TITLE || 'AroFlo Reporting Dashboard',
    reportSubtitle: process.env.KPI_REPORT_SUBTITLE || 'SAHA + Ventia work orders',
    // Invoicing report (ported from aroflo_dash's invoicing.py). "Submitted" =
    // an invoice that has left internal drafting. AroFlo's invoice statuses
    // are not started / pending approval / approved / in progress /
    // processed. Approved + processed are locked and count as submitted
    // (user-confirmed in aroflo_dash, 2026-07-14); in progress has gone to
    // the client, so it counts too, and is shown as in progress (confirmed
    // 2026-10-13).
    submittedInvoiceStatuses: parseList(process.env.KPI_SUBMITTED_INVOICE_STATUSES, ['approved', 'in progress', 'processed']).map(
      (s) => s.toLowerCase(),
    ),
    // Lifecycle order for the "Invoices by Status" table.
    invoiceStatusOrder: parseList(process.env.KPI_INVOICE_STATUS_ORDER, [
      'not started',
      'pending approval',
      'approved',
      'in progress',
      'processed',
    ]).map((s) => s.toLowerCase()),
  },
};

module.exports = config;
