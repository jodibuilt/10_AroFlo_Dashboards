const config = require('../config');
const { fetchZonePaged } = require('../zoneFetch');
const { normalizePriority } = require('../priorities');
const { plain, EVERY_UNIT } = require('../businessUnit');
const { zonedNow, dayOf } = require('../time');
const { openWorkloadStore } = require('./store');
const { readDay, readEarlierDays } = require('./read');
const { buildWorkloadDay } = require('./view');

// The Workloads page: how many jobs each field worker is booked for on a
// day, and how many of them are done.
//
// AroFlo is asked for a day when someone presses "Update now" on the page
// (update), or when the page is first opened on a new day (loadIfNew) —
// never on a timer, like everything else here: the daily request allowance
// is shared with other tools. What keeps the page live in between is AroFlo
// itself: its Event Messages POST to this app the moment a job is completed
// (receive), which costs no requests at all.

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

// A job as last read is still with the office to invoice, or finished.
function stillDone(job) {
  if (!job) return true; // nothing says otherwise
  return [job.substatus, job.status].some((v) => plain(v).includes('invoic')) || config.completedTaskStatuses.includes(String(job.status || '').toLowerCase());
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
        // Today is read by itself this often (startAutoUpdate); 0 = never.
        autoUpdateMinutes: config.workload.autoUpdateMinutes,
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
      const { remaining = '?', limit = '?' } = client.dailyAllowance || {};
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
      // What earlier updates learnt about jobs — what to show for one that
      // can't be read this time. Which ids today's bookings name isn't known
      // until they are read, so the reader is handed a lookup.
      const knownJobs = { get: (taskId) => store.getJobs([taskId]).get(taskId) };
      const read = await readDay(client, {
        day,
        today: today(),
        priorities,
        knownJobs,
        loadedJobs,
        otherUnitJobs,
        completedFilter: settings.getSetting('workload_completed_filter', null),
        severalIds: settings.getSetting('workload_several_ids', null),
        runningFilter: settings.getSetting('workload_running_filter', null),
      });
      if (read.completedFilter) settings.setSetting('workload_completed_filter', read.completedFilter);
      if (read.severalIds !== null) settings.setSetting('workload_several_ids', read.severalIds);
      // False once AroFlo has been seen ignoring the running-into-the-day filter (read.js).
      if (read.runningFilter !== null) settings.setSetting('workload_running_filter', read.runningFilter);
      store.saveJobs(read.learnt);
      // The day's own calendar, kept with the others (it is read again on a later day).
      store.saveSchedule(day, read.bookings, today());

      // The days before, for the "Not done yet" tab. If that fails, the day
      // itself, read above, is still kept, and the page says why.
      let earlier;
      try {
        earlier = await readEarlierDays(client, {
          day,
          today: today(),
          days: config.workload.backlogDays,
          schedules: store,
          knownJobs,
          fresh: new Set(read.freshIds),
          priorities,
          several: settings.getSetting('workload_several_ids', null),
          stop: () => cache.allowanceIsLow(),
        });
      } catch (err) {
        logger.warn('Could not read the earlier days for Not done yet', { day, error: err.message });
        earlier = { learnt: {}, severalIds: null, notes: [`Earlier days could not be read this time (${err.message}), so Not done yet is as of the last update.`], check: { error: err.message } };
      }
      if (earlier.severalIds !== null) settings.setSetting('workload_several_ids', earlier.severalIds);
      store.saveJobs(earlier.learnt);
      const requests = client.requestCount - requestsBefore;

      // Kept from before, where this read is silent and nothing says the job
      // has gone back to being open:
      //   - what AroFlo pushed (its own list can lag a moment behind);
      //   - "ready for invoicing" seen on an earlier update of this day —
      //     a substatus has no date, so a day gone by can't be told it again.
      // A pushed completion for a job neither booked that day nor on
      // AroFlo's list stays unconfirmed (see view.js).
      const previous = store.getDay(day);
      const booked = new Set(read.bookings.map((b) => b.taskId));
      const completed = { ...read.completed };
      for (const [taskId, done] of Object.entries(previous.completed)) {
        if (completed[taskId] || read.openAgain.includes(taskId)) continue;
        if (done.source === 'webhook') completed[taskId] = { ...done, unverified: !booked.has(taskId) };
        else if (done.how === 'invoicing' && day !== today() && stillDone(read.jobs[taskId])) completed[taskId] = done;
      }
      store.saveDay({
        day,
        bookingsFetchedAt: new Date().toISOString(),
        requests,
        notes: [...read.notes, ...earlier.notes],
        businessUnits: read.businessUnits,
        bookings: read.bookings,
        notCounted: read.notCounted,
        completed,
        jobs: { ...previous.jobs, ...read.jobs },
        calendarChangedAt: null,
      });
      logger.info('Workload check', { ...read.check, earlierDays: earlier.check, requests });
      if (client.dailyAllowance) logger.info('AroFlo requests left today', { ...client.dailyAllowance, usedByThisWorkloadUpdate: requests });
    } catch (err) {
      state.lastError = { day, message: err.message };
      logger.error('Failed to update the workload', { day, error: err.message });
    } finally {
      state.updating = null;
    }
  }

  // The first time the page is opened on a new day, that day is read by
  // itself (2026-10-15: Jodi chose this — "no need to update now when the
  // dash is open since the webhooks are triggering the change"). AroFlo's
  // messages bring completions but not the calendar, so the calendar has to
  // be read once a day; this does it when someone first looks, never on a
  // timer. Today only; once per day while the server runs, so an update that
  // fails isn't retried on every open; and never past the usual guards
  // (one update at a time, the gap between them, the daily allowance).
  const triedToday = new Set();
  function loadIfNew(day) {
    if (day !== today() || triedToday.has(day) || store.getDay(day).bookingsFetchedAt || refusal()) return false;
    triedToday.add(day);
    update(day); // marks itself as running at once, and catches its own errors
    return true;
  }

  // Every so often (config.workload.autoUpdateMinutes), today is read by
  // itself, as if someone had pressed "Update now" — which, with AroFlo's
  // webhooks switched off (2026-10-19), is how completions reach the page
  // between presses. A turn is skipped, not queued, when the usual guards say
  // no: an update running, the gap since the last one, the daily allowance.
  // Each read is ten to fifteen requests from the shared allowance.
  let autoTimer = null;
  function startAutoUpdate(minutes = config.workload.autoUpdateMinutes) {
    if (!minutes || autoTimer) return false;
    autoTimer = setInterval(() => {
      // Nothing thrown here may escape: in a timer it would stop the server.
      try {
        const day = today();
        const refused = refusal();
        if (refused) {
          logger.info('Workload auto-update skipped', { day, reason: refused.message });
          return;
        }
        update(day); // catches and records its own errors
      } catch (err) {
        logger.error('Workload auto-update failed to start', { error: err.message });
      }
    }, minutes * 60 * 1000);
    autoTimer.unref();
    return true;
  }
  function stopAutoUpdate() {
    clearInterval(autoTimer);
    autoTimer = null;
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
          ? { jobNumber: loaded.jobNumber, customerOrderNumber: loaded.customerOrderNumber || '', taskName: loaded.taskName, client: loaded.client, site: loaded.locationName || '', priority: loaded.priorityLabel || '', status: loaded.status }
          : onRecord || { jobNumber: clean(payload.jobnumber), customerOrderNumber: clean(payload.custon), taskName: clean(payload.task), client: '', site: '', priority: '', status: '' };
      }
      store.saveDay(stored);
      // And on the job's own record, which the "Not done yet" tab goes by.
      if (recorded) store.saveJobs({ [taskId]: { ...recorded, status: 'Completed', completedDate: asAroFlo(when).slice(0, 10), completedAt: asAroFlo(when) } });
      // What became of it, so the log answers "did it show?" (job numbers aren't secret).
      logger.info('Event message applied', {
        kind,
        day: dayOf(when),
        job: clean(payload.jobnumber) || (recorded && recorded.jobNumber) || '',
        onThatDaysCalendar: booked,
        knownJob: Boolean(loaded || onRecord),
        // Not yet matched to anything of ours: kept, shown once an update confirms it.
        heldBack: stored.completed[taskId].unverified,
        // The page shows the day once someone has pressed Update now for it.
        dayLoaded: Boolean(stored.bookingsFetchedAt),
      });
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

  return { view, update, loadIfNew, refusal, receive, startAutoUpdate, stopAutoUpdate, today, store };
}

module.exports = { createWorkload, instantOf };
