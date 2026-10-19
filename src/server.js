const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const config = require('./config');
const logger = require('./logger');
const AroFloClient = require('./aroflo/AroFloClient');
const { DashboardCache } = require('./cache');
const {
  buildReportingKpis,
  buildReportingClients,
  buildOverdueAgeing,
  buildInvoicingReport,
  buildKpiMatrixTasks,
} = require('./views');
const { logDataCheck } = require('./dataCheck');
const { openDb: openAuthDb } = require('./auth/db');
const { seedFirstAdmin } = require('./auth/seed');
const { createAuthRouter } = require('./auth/routes');
const { requireAuthApi, requireAdmin } = require('./auth/middleware');
const { createLoginThrottle } = require('./loginThrottle');
const { openDb: openAppDb } = require('./db');
const { createWorkload } = require('./workload');
const { sameSecret } = require('./workload/token');

const authDb = openAuthDb();
seedFirstAdmin(authDb);

// Nav visibility + per-user Reports edits. Nothing else is stored locally —
// every number on the Reports tab is read from AroFlo through the cache.
const appDb = openAppDb();

const client = new AroFloClient({
  baseUrl: config.aroflo.baseUrl,
  secretKey: config.aroflo.secretKey,
  uEncoded: config.aroflo.uEncoded,
  pEncoded: config.aroflo.pEncoded,
  orgEncoded: config.aroflo.orgEncoded,
  accept: config.aroflo.accept,
  hostIp: config.aroflo.hostIp,
  rateLimitPerSecond: config.rateLimitPerSecond,
  rateLimitPerMinute: config.rateLimitPerMinute,
  logger,
});

const cache = new DashboardCache(client);

// The Workloads page keeps its days in the app database, and reads AroFlo
// through the same client — so it is read-only and counted the same way.
const workload = createWorkload({ client, cache, db: appDb.raw, settings: appDb, logger });

let lastManualRefreshAt = 0;

// The UI is the built React app (frontend/ -> vite build). It's a single-
// page app that gates itself client-side (App.tsx fetches /auth/me and
// renders LoginView when signed out): every real gate is on the /api and
// /auth routes below, and the static shell itself carries no data.
const frontendDistDir = path.join(__dirname, '..', 'frontend', 'dist');
const app = express();
// On App Service every request arrives through Azure's own proxy. Trusting
// that one hop makes req.ip the caller's address rather than the proxy's —
// which is what the sign-in limit below counts by, and what the log records
// against a rejected sign-in.
app.set('trust proxy', 1);
app.disable('x-powered-by');
// Headers that cost nothing and close off the cheap attacks on a page that
// is on the public internet: no guessing a file's type, no showing these
// pages inside someone else's frame, no leaking the address to other sites,
// and — once it is served over HTTPS (COOKIE_SECURE) — HTTPS only from then
// on.
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'same-origin');
  if (config.auth.cookieSecure) res.set('Strict-Transport-Security', 'max-age=31536000');
  next();
});
// App Service on Linux doesn't compress responses itself, and the Reports
// bundle (Plotly) is ~6 MB raw / ~1.8 MB gzipped.
app.use(compression());
app.use(cookieParser());
app.use(express.json());

// Unauthenticated liveness probe for App Service's health check. Says only
// that the process is up — no data, no cache state.
app.get('/healthz', (req, res) => res.json({ ok: true }));

// Ten wrong sign-ins from one address in fifteen minutes and that address
// waits (src/loginThrottle.js).
app.post('/auth/login', createLoginThrottle().middleware);
app.use('/auth', createAuthRouter(authDb));
// Vite content-hashes everything under assets/, so those can be cached
// forever; index.html (and the admin page) are revalidated on every load.
app.use('/assets', express.static(path.join(frontendDistDir, 'assets'), { immutable: true, maxAge: '1y' }));
app.use(express.static(frontendDistDir, { index: 'index.html' }));

const requireApiAuth = requireAuthApi(authDb);
app.get('/api/status', requireApiAuth, (req, res) => res.json(cache.status()));

// Navigation visibility — which sidebar tabs / tool sub-tabs an admin has
// hidden. Everyone reads it (the sidebar needs it to render); only an admin
// can change it. `subTabs` keys are namespaced, e.g. "tools:wo-consolidator".
const NAV_HIDDEN_DEFAULT = { tabs: [], subTabs: [] };
app.get('/api/settings/nav', requireApiAuth, (req, res) => {
  res.json(appDb.getSetting('nav_hidden', NAV_HIDDEN_DEFAULT));
});
app.put('/api/settings/nav', requireApiAuth, requireAdmin, (req, res) => {
  const body = req.body || {};
  const clean = (v) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && x.length < 80))] : []);
  const next = { tabs: clean(body.tabs), subTabs: clean(body.subTabs) };
  appDb.setSetting('nav_hidden', next);
  logger.info('Navigation visibility updated', { by: req.user.username, ...next });
  res.json(next);
});

// Reporting Dashboard (ported from aroflo_dash).
app.get('/api/reporting/config', requireApiAuth, (req, res) => {
  res.json({
    priorityCodeMap: config.reporting.priorityCodeMap,
    priorityTargets: config.reporting.priorityTargets,
    targetClients: config.reporting.targetClients,
    reportTitle: config.reporting.reportTitle,
    reportSubtitle: config.reporting.reportSubtitle,
    // The pages work out "today" and show times in this zone too, rather
    // than in whatever each person's browser is set to.
    timeZone: config.timeZone,
  });
});
app.get('/api/reporting/clients', requireApiAuth, (req, res) => res.json(buildReportingClients(cache)));
app.get('/api/reporting/kpis', requireApiAuth, (req, res) => {
  const { dateFrom, dateTo, view } = req.query;
  res.json(buildReportingKpis(cache, { dateFrom, dateTo, view }));
});
app.get('/api/reporting/overdue-ageing', requireApiAuth, (req, res) => {
  res.json(buildOverdueAgeing(cache, { view: req.query.view }));
});
app.get('/api/reporting/invoicing', requireApiAuth, (req, res) => {
  const { view, dateFrom, dateTo } = req.query;
  res.json(buildInvoicingReport(cache, { view, dateFrom, dateTo }));
});
app.get('/api/reporting/kpi-matrix', requireApiAuth, (req, res) => res.json(buildKpiMatrixTasks(cache)));

app.get('/api/dashboard-edits/:stateKey', requireApiAuth, (req, res) => {
  const { view, dateFrom, dateTo } = req.query;
  if (!view || !dateFrom || !dateTo) {
    res.status(400).json({ error: 'view, dateFrom, and dateTo query params are required' });
    return;
  }
  const payload = appDb.getDashboardEdit({
    username: req.user.username,
    view,
    dateFrom,
    dateTo,
    stateKey: req.params.stateKey,
  });
  res.json({ payload });
});
app.put('/api/dashboard-edits/:stateKey', requireApiAuth, (req, res) => {
  const { view, dateFrom, dateTo } = req.query;
  if (!view || !dateFrom || !dateTo) {
    res.status(400).json({ error: 'view, dateFrom, and dateTo query params are required' });
    return;
  }
  appDb.saveDashboardEdit({
    username: req.user.username,
    view,
    dateFrom,
    dateTo,
    stateKey: req.params.stateKey,
    payload: req.body,
  });
  res.json({ saved: true });
});
app.delete('/api/dashboard-edits/:stateKey', requireApiAuth, (req, res) => {
  const { view, dateFrom, dateTo } = req.query;
  if (!view || !dateFrom || !dateTo) {
    res.status(400).json({ error: 'view, dateFrom, and dateTo query params are required' });
    return;
  }
  appDb.deleteDashboardEdit({
    username: req.user.username,
    view,
    dateFrom,
    dateTo,
    stateKey: req.params.stateKey,
  });
  res.json({ deleted: true });
});

app.post('/api/refresh', requireApiAuth, async (req, res) => {
  const elapsedSeconds = (Date.now() - lastManualRefreshAt) / 1000;
  if (elapsedSeconds < config.minManualRefreshIntervalSeconds) {
    res.status(429).json({
      error: `Please wait ${Math.ceil(config.minManualRefreshIntervalSeconds - elapsedSeconds)}s before refreshing again.`,
    });
    return;
  }
  lastManualRefreshAt = Date.now();
  res.json({ started: true });
  cache.refreshAll().then(() => logDataCheck(cache));
});

// Workloads: jobs booked to each field worker on a day, and how many are
// done. A day is YYYY-MM-DD in the reports' time zone; today if none given.
const WORKLOAD_DAY = /^\d{4}-\d{2}-\d{2}$/;
function workloadDay(req, res) {
  const day = req.query.day || workload.today();
  if (!WORKLOAD_DAY.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
    res.status(400).json({ error: 'day must be a date, YYYY-MM-DD' });
    return null;
  }
  return day;
}
// Opening the page on a new day also reads that day, once (loadIfNew in
// src/workload/index.js); after that it only reads AroFlo when someone
// presses "Update now".
app.get('/api/workload', requireApiAuth, (req, res) => {
  const day = workloadDay(req, res);
  if (!day) return;
  workload.loadIfNew(day);
  res.json(workload.view(day));
});
// Someone pressing "Update now". Answers straight away; the page watches GET
// /api/workload for it to finish.
app.post('/api/workload/update', requireApiAuth, (req, res) => {
  const day = workloadDay(req, res);
  if (!day) return;
  const refused = workload.refusal();
  if (refused) {
    res.status(refused.status).json({ error: refused.message });
    return;
  }
  res.json({ started: true });
  workload.update(day);
});

// AroFlo's Event Messages arrive here: no session, so the secret in the
// address is the only thing that lets one in. Switched off (404) until
// WORKLOAD_WEBHOOK_SECRET is set. Answered at once — AroFlo isn't kept
// waiting on what is done with it.
app.post('/webhooks/aroflo/:kind', (req, res) => {
  if (!config.workload.webhookSecret) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (!sameSecret(req.query.token, config.workload.webhookSecret)) {
    logger.warn('Rejected event message: missing or wrong token', { ip: req.ip, kind: req.params.kind });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  res.json({ received: true });
  try {
    workload.receive(req.params.kind, req.body);
  } catch (err) {
    logger.error('Could not take in an event message', { kind: req.params.kind, error: err.message });
  }
});

// SPA fallback: any GET that isn't /api or /auth gets the app shell;
// unmatched /api or /auth paths still fall through to Express's normal 404
// instead of an HTML page.
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/auth')) {
    next();
    return;
  }
  res.sendFile(path.join(frontendDistDir, 'index.html'));
});

// Nothing is fetched from AroFlo here, or on a timer: the reports stay empty
// until someone presses Refresh (POST /api/refresh above). AroFlo's daily
// request allowance is shared with other tools, so this app only spends it
// when asked to.
app.listen(config.port, () => {
  logger.info(`AroFlo Dashboards listening on http://localhost:${config.port} — AroFlo data loads when someone presses Refresh`);
});

function shutdown() {
  logger.info('AroFlo Dashboards shutting down');
  authDb.close();
  appDb.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
// App Service stops the container with SIGTERM on restart/redeploy.
process.on('SIGTERM', shutdown);
