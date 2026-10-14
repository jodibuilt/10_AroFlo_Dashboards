const config = require('../config');
const { fetchZonePaged } = require('../zoneFetch');
const { normalizePriority } = require('../priorities');
const { plain, EVERY_UNIT } = require('../businessUnit');
const { zonedNow, dayOf } = require('../time');
const { openWorkloadStore } = require('./store');
const { readDay } = require('./read');
const { buildWorkloadDay } = require('./view');

// The Workloads page: how many jobs each field worker is booked for on a
// day, and how many of them are done.
//
// AroFlo is asked for a day only when someone presses "Update now" on the
// page (update) — never on a timer, like everything else here: the daily
// request allowance is shared with other tools. What keeps the page live in
// between is AroFlo itself: its Event Messages can POST to this app the
// moment a job is completed or the calendar changes (receive), which costs
// no requests at all.

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());
const pad = (n) => String(n).padStart(2, '0');

// A wall-clock Date as AroFlo writes one: "2026/10/14 14:35:00".
const asAroFlo = (d) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

// When an Event Message says it happened. AroFlo stamps them in UTC, as
// "YYYY/MM/DD HH:mm:ss"; anything unreadable is taken as "just now".
function instantOf(timestampUtc) {
  const m = /^(\d{4})[/-](\d{2})[/-](\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(clean(timestampUtc));
  if (!m) return new Date();
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] || 0)));
}

// `cache` is the reports' DashboardCache: where a booked job's details come
// from, and what knows how much of the daily allowance is left.
// `db` is the app database's node:sqlite handle; `settings` its key/value
// store (src/db.js).
function createWorkload({ client, cache, db, settings, logger }) {
  const store = openWorkloadStore(db);
  const state = { updating: null, lastError: null, lastStartedAt: 0 };
  const today = () => dayOf(zonedNow());

  function view(day) {
    const built = buildWorkloadDay(store, day, { today: today() });
    return {
      ...built,
      meta: {
        ...built.meta,
        updating: state.updating === day,
        // The last update failed: the page keeps what it had and says why.
        error: state.lastError && state.lastError.day === day ? state.lastError.message : null,
        // AroFlo can push changes here; without it the page only moves on "Update now".
        pushEnabled: Boolean(config.workload.webhookSecret),
      },
    };
  }

  // Why an update can't start right now, or null.
  function refusal() {
    if (state.updating) return { status: 409, message: 'An update is already running.' };
    const waited = (Date.now() - state.lastStartedAt) / 1000;
    if (waited < config.workload.minUpdateIntervalSeconds) {
      return { status: 429, message: `Please wait ${Math.ceil(config.workload.minUpdateIntervalSeconds - waited)}s before updating again.` };
    }
    if (cache.allowanceIsLow()) {
      const { remaining, limit } = client.dailyAllowance;
      return { status: 429, message: `AroFlo's daily request allowance is nearly used up (${remaining} of ${limit} left), so updating is paused until it resets.` };
    }
    return null;
  }

  // A job carries only the id of its priority; the names are AroFlo's own
  // list. Refresh loads it (src/cache.js) — but this page must not depend
  // on anyone having pressed Refresh, so when it isn't there the list is
  // read here: one request, kept for as long as the server runs.
  let ownPriorities = null;
  async function priorityNames() {
    const loaded = cache.get('priorities').records;
    if (loaded.length) return new Map(loaded.map((p) => [p.priorityId, p]));
    if (!ownPriorities) {
      const raw = await fetchZonePaged(client, { zone: 'Priorities', pluralKey: 'priorities', singularKey: 'priority' });
      ownPriorities = new Map(raw.map(normalizePriority).map((p) => [p.priorityId, p]));
    }
    return ownPriorities;
  }

  // Reads the day's bookings and completions from AroFlo and stores them.
  async function update(day) {
    state.updating = day;
    state.lastStartedAt = Date.now();
    state.lastError = null;
    const requestsBefore = client.requestCount;
    try {
      const priorities = await priorityNames();
      const loadedJobs = new Map(cache.get('jobs').records.map((t) => [t.taskId, t]));
      const otherUnitJobs = new Set(cache.get('jobs').otherUnitTaskIds || []);
      // What earlier updates learnt about jobs: every id on record is a job
      // that needn't be asked for again. Which ids today's bookings name
      // isn't known until they are read, so the reader is handed a lookup.
      const knownJobs = { get: (taskId) => store.getJobs([taskId]).get(taskId) };
      const read = await readDay(client, {
        day,
        priorities,
        knownJobs,
        loadedJobs,
        otherUnitJobs,
        completedFilter: settings.getSetting('workload_completed_filter', null),
        severalIds: settings.getSetting('workload_several_ids', null),
      });
      if (read.completedFilter) settings.setSetting('workload_completed_filter', read.completedFilter);
      if (read.severalIds !== null) settings.setSetting('workload_several_ids', read.severalIds);
      store.saveJobs(read.learnt);
      const requests = client.requestCount - requestsBefore;

      // What AroFlo pushed is kept where its own list is silent — the list
      // can lag a moment behind the push — unless it now shows the job open
      // again. A pushed completion for a job that is neither booked today
      // nor on AroFlo's list stays unconfirmed (see view.js).
      const previous = store.getDay(day);
      const booked = new Set(read.bookings.map((b) => b.taskId));
      const completed = { ...read.completed };
      for (const [taskId, done] of Object.entries(previous.completed)) {
        if (done.source !== 'webhook' || completed[taskId] || read.openAgain.includes(taskId)) continue;
        completed[taskId] = { ...done, unverified: !booked.has(taskId) };
      }
      store.saveDay({
        day,
        bookingsFetchedAt: new Date().toISOString(),
        requests,
        notes: read.notes,
        businessUnits: read.businessUnits,
        bookings: read.bookings,
        completed,
        jobs: { ...previous.jobs, ...read.jobs },
        calendarChangedAt: null,
      });
      logger.info('Workload check', { ...read.check, requests });
      if (client.dailyAllowance) logger.info('AroFlo requests left today', { ...client.dailyAllowance, usedByThisWorkloadUpdate: requests });
    } catch (err) {
      state.lastError = { day, message: err.message };
      logger.error('Failed to update the workload', { day, error: err.message });
    } finally {
      state.updating = null;
    }
  }

  // An Event Message from AroFlo. `kind` is the last part of the address it
  // was sent to: "task-completed" or "schedule-changed". What arrives is
  // logged by its shape (field names, not values) whatever it is, because
  // the exact messages AroFlo sends for these events have yet to be seen.
  function receive(kind, body) {
    const payload = (body && typeof body.payload === 'object' && body.payload) || {};
    const ids = (typeof payload.api_related_ids === 'object' && payload.api_related_ids) || {};
    const taskId = clean(ids.taskid);
    logger.info('AroFlo event message', {
      kind,
      event: clean(body && body.eventname),
      at: clean(body && body.timestamputc),
      fields: Object.keys(payload).sort(),
      ids: Object.keys(ids).sort(),
    });

    if (kind === 'task-completed' && taskId) {
      const when = zonedNow(instantOf(body.timestamputc));
      const stored = store.getDay(dayOf(when));
      const booked = stored.bookings.some((b) => b.taskId === taskId);
      const loaded = cache.get('jobs').records.find((t) => t.taskId === taskId);
      // (The record also holds jobs looked up and found to be another unit's.)
      const recorded = store.getJobs([taskId]).get(taskId);
      const units = config.businessUnits;
      const onRecord = recorded && (units.includes(EVERY_UNIT) || !recorded.businessUnit || units.map(plain).includes(plain(recorded.businessUnit))) ? recorded : null;
      // Whose job it is can be told only if it is booked today, among the
      // loaded work orders, or one an earlier update looked up — all of
      // which are the reports' business units only.
      stored.completed[taskId] = { at: asAroFlo(when), by: clean(payload.currentuser), source: 'webhook', unverified: !booked && !loaded && !onRecord };
      if (!stored.jobs[taskId]) {
        stored.jobs[taskId] = loaded
          ? { jobNumber: loaded.jobNumber, taskName: loaded.taskName, client: loaded.client, site: loaded.locationName || '', priority: loaded.priorityLabel || '', status: loaded.status }
          : onRecord || { jobNumber: clean(payload.jobnumber), taskName: clean(payload.task), client: '', site: '', priority: '', status: '' };
      }
      store.saveDay(stored);
      return { applied: 'completed' };
    }

    if (kind === 'schedule-changed') {
      // The message doesn't say enough to redraw a day's bookings, and this
      // app doesn't call AroFlo unasked: the page is told the calendar has
      // moved on, and offers "Update now".
      const stored = store.getDay(today());
      if (stored.bookingsFetchedAt) {
        stored.calendarChangedAt = new Date().toISOString();
        store.saveDay(stored);
      }
      return { applied: 'calendar' };
    }
    return { applied: null };
  }

  return { view, update, refusal, receive, today, store };
}

module.exports = { createWorkload, instantOf };
