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
const { openDb: openAuthDb } = require('./auth/db');
const { seedFirstAdmin } = require('./auth/seed');
const { createAuthRouter } = require('./auth/routes');
const { requireAuthApi, requireAdmin } = require('./auth/middleware');
const { openDb: openAppDb } = require('./db');

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

let lastManualRefreshAt = 0;

// The UI is the built React app (frontend/ -> vite build). It's a single-
// page app that gates itself client-side (App.tsx fetches /auth/me and
// renders LoginView when signed out): every real gate is on the /api and
// /auth routes below, and the static shell itself carries no data.
const frontendDistDir = path.join(__dirname, '..', 'frontend', 'dist');
const app = express();
// App Service on Linux doesn't compress responses itself, and the Reports
// bundle (Plotly) is ~6 MB raw / ~1.8 MB gzipped.
app.use(compression());
app.use(cookieParser());
app.use(express.json());

// Unauthenticated liveness probe for App Service's health check. Says only
// that the process is up — no data, no cache state.
app.get('/healthz', (req, res) => res.json({ ok: true }));

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
  cache.refreshAll();
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

app.listen(config.port, () => {
  logger.info(`AroFlo Dashboards listening on http://localhost:${config.port}`);
  cache.startAutoRefresh();
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
