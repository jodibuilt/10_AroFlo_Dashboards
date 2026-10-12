const config = require('./config');
const logger = require('./logger');
const { fetchZonePaged, sleep } = require('./zoneFetch');
const { normalizeTask, normalizeInvoice, normalizePayment } = require('./normalize');
const { fetchPayments } = require('./payments');

// Only the three zones the Reports tab reads. All small enough on this
// account to fetch in full every refresh.
const ZONES = [
  // join=substatus,labour: without an explicit join the v1 Tasks GET returns
  // `substatus` and `labours` as present-but-empty keys (AroFlo still says
  // status "0" — silent). substatus powers the breakdown "Substatus" column;
  // the earliest `labours[].workdatetimestart` is normalizeTask's actualStartDate.
  // Comma-joined single value is the form confirmed working for multi-join
  // (aroflo_dash). Adds ~one nested array per task to the response.
  {
    key: 'jobs',
    zone: 'Tasks',
    pluralKey: 'tasks',
    singularKey: 'task',
    normalize: normalizeTask,
    join: ['substatus,labour'],
  },
  { key: 'invoices', zone: 'Invoices', pluralKey: 'invoices', singularKey: 'invoice', normalize: normalizeInvoice },
  {
    key: 'payments',
    zone: 'Payments',
    normalize: normalizePayment,
    // Payments needs its own fallback-on-rejected-WHERE fetch logic (see
    // src/payments.js) rather than the generic fetchZonePaged used by every
    // other zone here.
    customFetch: fetchPayments,
  },
];

class DashboardCache {
  constructor(client) {
    this.client = client;
    this.state = {};
    for (const zoneDef of ZONES) {
      this.state[zoneDef.key] = { records: [], lastFetchedAt: null, error: null, isRefreshing: false };
    }
    this.lastRefreshCompletedAt = null;
    this.isRefreshingAll = false;
  }

  async refreshZone(zoneDef) {
    this.state[zoneDef.key].isRefreshing = true;
    try {
      const raw = zoneDef.customFetch ? await zoneDef.customFetch(this.client) : await fetchZonePaged(this.client, zoneDef);
      this.state[zoneDef.key] = {
        records: raw.map(zoneDef.normalize),
        lastFetchedAt: new Date().toISOString(),
        error: null,
        isRefreshing: false,
      };
      logger.info(`Refreshed ${zoneDef.zone}`, { count: raw.length });
    } catch (err) {
      logger.error(`Failed to refresh ${zoneDef.zone}`, { error: err.message });
      this.state[zoneDef.key] = {
        ...this.state[zoneDef.key],
        error: err.message,
        isRefreshing: false,
      };
    }
  }

  async refreshAll() {
    if (this.isRefreshingAll) {
      logger.warn('Refresh already in progress — skipping overlapping trigger');
      return;
    }
    this.isRefreshingAll = true;
    try {
      for (const zoneDef of ZONES) {
        // Sequential on purpose — never fire all zones at once (see .env.example).
        // eslint-disable-next-line no-await-in-loop
        await this.refreshZone(zoneDef);
        // eslint-disable-next-line no-await-in-loop
        await sleep(config.interZoneDelayMs);
      }
      this.lastRefreshCompletedAt = new Date().toISOString();
    } finally {
      this.isRefreshingAll = false;
    }
  }

  get(key) {
    return this.state[key];
  }

  status() {
    const zones = {};
    for (const key of Object.keys(this.state)) {
      const s = this.state[key];
      zones[key] = { lastFetchedAt: s.lastFetchedAt, count: s.records.length, error: s.error, isRefreshing: s.isRefreshing };
    }
    return { zones, lastRefreshCompletedAt: this.lastRefreshCompletedAt, isRefreshingAll: this.isRefreshingAll };
  }

  startAutoRefresh() {
    this.refreshAll();
    setInterval(() => this.refreshAll(), config.refreshIntervalMinutes * 60 * 1000);
  }
}

module.exports = { DashboardCache, ZONES };
