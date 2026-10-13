const config = require('./config');
const logger = require('./logger');
const { fetchZonePaged, sleep } = require('./zoneFetch');
const { normalizeTask, normalizeInvoice, normalizePayment } = require('./normalize');
const { normalizePriority } = require('./priorities');
const { fetchPayments } = require('./payments');
const { formatAroFloDate } = require('./aroflo/aroFloDates');

// The first day the reports cover: the 1st of the month, `lookbackMonths`
// before this one. Every dated zone below is asked for from this day on.
// It has to be asked — AroFlo answers a request with no date filter with
// just the last 30 days (Tasks: "datetimerequested > 30 days ago") and says
// nothing about having done so. That is how a report built on "every work
// order" ends up missing any job requested more than a month ago.
function coverageStart(now = new Date()) {
  return new Date(now.getFullYear(), now.getMonth() - config.lookbackMonths, 1);
}

// YYYY-MM-DD, the form AroFlo's Tasks and Invoices WHERE filters are known
// to take (aroflo_dash, against the real account).
function isoDay(d) {
  return formatAroFloDate(d).replace(/\//g, '-');
}

// Only the zones the Reports tab reads.
const ZONES = [
  // Each AroFlo account names its own priorities and a task carries only the
  // id, so this goes first: the Tasks pass below uses it to name them.
  { key: 'priorities', zone: 'Priorities', pluralKey: 'priorities', singularKey: 'priority', normalize: normalizePriority },
  // join=substatus,labour,notes: without an explicit join the v1 Tasks GET
  // returns `substatus`, `labours` and `tasknotes` as present-but-empty keys
  // (AroFlo still says status "0" — silent). substatus powers the breakdown
  // "Substatus" column and the delay reason; the earliest
  // `labours[].workdatetimestart` is normalizeTask's actualStartDate; the
  // notes are the delay reason's fallback (src/delayReason.js). Comma-joined
  // single value is the form confirmed working for multi-join (aroflo_dash,
  // which sent four). Each adds a nested array per task to the response —
  // bigger pages, not more requests.
  // The filter field is `daterequested`, although the same date comes back
  // named `requestdate`. Filtering on the response's name is not an error to
  // AroFlo: it drops the clause and applies its 30-day default — which the
  // client turns into a failure rather than accept (AroFloClient.checkEnvelope).
  {
    key: 'jobs',
    zone: 'Tasks',
    pluralKey: 'tasks',
    singularKey: 'task',
    normalize: normalizeTask,
    join: ['substatus,labour,notes'],
    where: () => [`and|daterequested|>=|${isoDay(coverageStart())}`],
  },
  {
    key: 'invoices',
    zone: 'Invoices',
    pluralKey: 'invoices',
    singularKey: 'invoice',
    normalize: normalizeInvoice,
    where: () => [`and|dateinvoiced|>=|${isoDay(coverageStart())}`],
  },
  {
    key: 'payments',
    zone: 'Payments',
    normalize: normalizePayment,
    // Payments needs its own fallback-on-rejected-WHERE fetch logic (see
    // src/payments.js) rather than the generic fetchZonePaged used by every
    // other zone here.
    customFetch: (client) => fetchPayments(client, coverageStart()),
  },
];

// Never use up AroFlo's daily request allowance. It is shared by everything
// that signs in as this API user, and reaching zero locks them all out until
// it resets. Once less than this share of the limit is left, a refresh only
// re-reads the priority list — one request, which is also how the cache sees
// that the allowance has come back.
const ALLOWANCE_RESERVE = 0.1;

class DashboardCache {
  constructor(client) {
    this.client = client;
    this.state = {};
    for (const zoneDef of ZONES) {
      // `warning` is for data that loaded but isn't all there (the page
      // limit was hit, a filter fell back); `error` for a load that failed.
      this.state[zoneDef.key] = { records: [], lastFetchedAt: null, error: null, warning: null, isRefreshing: false };
    }
    this.lastRefreshCompletedAt = null;
    // The first day covered by what is loaded, as AroFlo writes dates
    // (YYYY/MM/DD). Null until the first refresh.
    this.coverageFrom = null;
    this.isRefreshingAll = false;
  }

  async refreshZone(zoneDef) {
    this.state[zoneDef.key].isRefreshing = true;
    try {
      const fetched = zoneDef.customFetch ? await zoneDef.customFetch(this.client) : await fetchZonePaged(this.client, zoneDef);
      const raw = Array.isArray(fetched) ? fetched : fetched.records;
      // fetchZonePaged stops at the page limit without saying so in what it
      // returns; a full last page is the sign.
      const limit = config.maxPagesPerZone * config.pageSize;
      const warning =
        raw.length >= limit
          ? `only the first ${raw.length.toLocaleString('en-AU')} records were loaded (the page limit), so figures that depend on them may be short`
          : fetched.warning || null;
      // Only the Tasks normalizer takes the second argument.
      const priorities = new Map(this.state.priorities.records.map((p) => [p.priorityId, p]));
      this.state[zoneDef.key] = {
        records: raw.map((r) => zoneDef.normalize(r, priorities)),
        lastFetchedAt: new Date().toISOString(),
        error: null,
        warning,
        isRefreshing: false,
      };
      logger.info(`Refreshed ${zoneDef.zone}`, { count: raw.length });
      if (zoneDef.key === 'priorities') this.logPriorityLevels();
      if (zoneDef.key === 'jobs') this.logTaskPriorities(raw);
    } catch (err) {
      logger.error(`Failed to refresh ${zoneDef.zone}`, { error: err.message });
      this.state[zoneDef.key] = {
        ...this.state[zoneDef.key],
        error: err.message,
        isRefreshing: false,
      };
    }
  }

  // Which of AroFlo's priority names landed on which level of the P-scale.
  // Logged when the list changes: a renamed or new priority moves work
  // orders between report sections without any error.
  logPriorityLevels() {
    const levels = {};
    for (const p of this.state.priorities.records) {
      const level = p.code || 'not on the scale';
      levels[level] = [...new Set([...(levels[level] || []), p.name])].sort();
    }
    const summary = JSON.stringify(levels);
    if (!this.state.priorities.records.length || summary === this.lastPriorityLevels) return;
    this.lastPriorityLevels = summary;
    logger.info('AroFlo priorities by level', levels);
  }

  // How the work orders split by priority, and — for the ones the reports
  // show as "No priority" — whether AroFlo simply has none set on the job or
  // the job carries an id the priority list above didn't explain. Logged
  // when the set of priorities in use changes, not on every count change.
  //
  // For the jobs the API returned with no priority at all it also says whose
  // they are, gives a few job numbers to look up in AroFlo, and names any
  // other field on those records that looks like it holds a priority — the
  // evidence needed if AroFlo shows a priority on a job that arrives here
  // without one. `raw` is the zone's records as AroFlo sent them, in the
  // same order as the normalized ones.
  logTaskPriorities(raw) {
    const named = {};
    const unlisted = {};
    const none = { count: 0, byClient: {}, sampleJobNumbers: [], otherPriorityFields: {} };
    this.state.jobs.records.forEach((t, i) => {
      if (t.priorityLabel) {
        named[t.priorityLabel] = (named[t.priorityLabel] || 0) + 1;
        return;
      }
      if (t.priorityId) {
        unlisted[t.priorityId] = (unlisted[t.priorityId] || 0) + 1;
        return;
      }
      none.count += 1;
      const client = t.client || '(no client)';
      none.byClient[client] = (none.byClient[client] || 0) + 1;
      if (none.sampleJobNumbers.length < 10) none.sampleJobNumbers.push(t.jobNumber);
      for (const [field, value] of Object.entries(raw[i] || {})) {
        const filled = value && typeof value !== 'object' ? String(value).trim() : value && Object.keys(value).length;
        if (field !== 'priority' && /prior/i.test(field) && filled) {
          none.otherPriorityFields[field] = (none.otherPriorityFields[field] || 0) + 1;
        }
      }
    });
    const inUse = JSON.stringify([Object.keys(named).sort(), Object.keys(unlisted).sort(), Object.keys(none.byClient).sort()]);
    if (inUse === this.lastTaskPriorities) return;
    this.lastTaskPriorities = inUse;
    logger.info('Work orders by priority', { named, idNotInPriorityList: unlisted });
    if (none.count) logger.info('Work orders AroFlo returned with no priority', none);
  }

  allowanceIsLow() {
    const allowance = this.client.dailyAllowance;
    return Boolean(allowance) && allowance.remaining < allowance.limit * ALLOWANCE_RESERVE;
  }

  // Keeps what the zone already holds and says why it isn't being updated —
  // the report pages show a zone's error next to its data.
  pauseZone(zoneDef) {
    const { remaining, limit } = this.client.dailyAllowance;
    logger.warn(`Not refreshing ${zoneDef.zone} — AroFlo daily request allowance nearly used up`, { remaining, limit });
    this.state[zoneDef.key] = {
      ...this.state[zoneDef.key],
      error: `daily request allowance nearly used up — ${remaining} of ${limit} left, so refreshing is paused until it resets`,
    };
  }

  // Reads everything from AroFlo. Nothing calls this on a timer or at
  // startup: it runs only when someone presses Refresh (POST /api/refresh),
  // because the daily request allowance is shared with other tools.
  async refreshAll() {
    if (this.isRefreshingAll) {
      logger.warn('Refresh already in progress — skipping overlapping trigger');
      return;
    }
    this.isRefreshingAll = true;
    const requestsBefore = this.client.requestCount;
    const coverageFrom = formatAroFloDate(coverageStart());
    try {
      for (const zoneDef of ZONES) {
        if (zoneDef.key !== 'priorities' && this.allowanceIsLow()) {
          this.pauseZone(zoneDef);
          continue;
        }
        // Sequential on purpose — never fire all zones at once (see .env.example).
        // eslint-disable-next-line no-await-in-loop
        await this.refreshZone(zoneDef);
        // eslint-disable-next-line no-await-in-loop
        await sleep(config.interZoneDelayMs);
      }
      this.lastRefreshCompletedAt = new Date().toISOString();
      if (this.state.jobs.lastFetchedAt) this.coverageFrom = coverageFrom;
      // Logged, not shown on the page: what AroFlo says is left of the
      // daily allowance, and what this refresh took out of it.
      if (this.client.dailyAllowance) {
        logger.info('AroFlo requests left today', {
          ...this.client.dailyAllowance,
          usedByThisRefresh: this.client.requestCount - requestsBefore,
        });
      }
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
      zones[key] = {
        lastFetchedAt: s.lastFetchedAt,
        count: s.records.length,
        error: s.error,
        warning: s.warning,
        isRefreshing: s.isRefreshing,
      };
    }
    return {
      zones,
      lastRefreshCompletedAt: this.lastRefreshCompletedAt,
      coverageFrom: this.coverageFrom,
      lookbackMonths: config.lookbackMonths,
      isRefreshingAll: this.isRefreshingAll,
    };
  }
}

module.exports = { DashboardCache, ZONES };
