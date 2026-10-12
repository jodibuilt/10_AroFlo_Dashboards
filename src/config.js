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
  rateLimitPerSecond: Number(process.env.RATE_LIMIT_PER_SECOND || 1),
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 60),
  refreshIntervalMinutes: Number(process.env.REFRESH_INTERVAL_MINUTES || 10),
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
  payments: {
    lookbackDays: Number(process.env.PAYMENTS_LOOKBACK_DAYS || 180),
  },
  kpi: {
    // Safe to pre-fill — this account's OWN confirmed priorityid values
    // (from this session's own recon), not borrowed from any other org.
    priorityLabels: parseJson(process.env.KPI_PRIORITY_LABELS_JSON, {
      IydaKyMK: 'Emergency',
      IydaKywK: 'Urgent',
      IydaKy0K: 'Standard',
      IydKTyQK: 'After Hours',
    }),
    // A business decision, not a technical unknown — ships empty.
    delayReasonSubstatuses: parseList(process.env.KPI_DELAY_REASON_SUBSTATUSES, []),
  },
  // Reporting Dashboard (ported from aroflo_dash). Its P1-P5/PM structure and
  // SLA percentages are aroflo_dash's own generic reporting convention kept
  // literal, but the priorityid->P-code MAPPING is account-specific.
  reporting: {
    // {ourPriorityLabel: "P1"|"P2"|"P3"|"P4"|"P5"|"PM"} — this account's own
    // 4 real priorities (Emergency/Urgent/Standard/After Hours, confirmed
    // live via the Priorities zone) mapped onto aroflo_dash's P-scale in
    // severity order. No 5th priority exists on this account for "PM"
    // (Preventative Maintenance), so PM is deliberately left unmapped; the
    // Reports page's PM tab shows its normal empty state rather than a
    // guessed value.
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
    // an invoice that has left internal drafting. AroFlo's real invoice
    // statuses are not started / pending approval / approved / processed;
    // approved + processed are locked and count as submitted (user-confirmed
    // in aroflo_dash, 2026-07-14).
    submittedInvoiceStatuses: parseList(process.env.KPI_SUBMITTED_INVOICE_STATUSES, ['approved', 'processed']).map(
      (s) => s.toLowerCase(),
    ),
    // Lifecycle order for the "Invoices by Status" table.
    invoiceStatusOrder: parseList(process.env.KPI_INVOICE_STATUS_ORDER, [
      'not started',
      'pending approval',
      'approved',
      'processed',
    ]).map((s) => s.toLowerCase()),
  },
};

module.exports = config;
