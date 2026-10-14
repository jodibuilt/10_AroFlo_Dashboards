const config = require('../config');
const { fetchZonePaged } = require('../zoneFetch');
const { normalizeTask } = require('../normalize');
const { businessUnitScope, plain, EVERY_UNIT } = require('../businessUnit');

// Reads one day's workload from AroFlo: who is booked to which job
// (Schedules), which jobs were finished that day (Tasks), and — for a booked
// job seen for the first time — what the job is (Tasks, by id). Two requests
// on a day whose jobs are already known, a few more the first time, against
// the forty-nine of a full Refresh: which is why the Workloads page has its
// own "Update now" and neither uses nor needs Refresh.
//
// The first run against the TTS account (2026-10-14) confirmed the bookings:
// a Schedules record carries `org` (its business unit), `scheduledto` and
// `scheduletype`, and `startdate =` and `datecompleted >=` are filters AroFlo
// honours. What every later read finds is written to the log (`check`,
// logged as "Workload check"): counts and field names, no one's details.

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

function tally(values) {
  const counts = {};
  for (const v of values) counts[v || '(blank)'] = (counts[v || '(blank)'] || 0) + 1;
  return counts;
}

// "2026/10/14 07:30:00" or "2026-10-14T07:30" -> "2026/10/14".
const dayPart = (value) => clean(value).slice(0, 10).replace(/-/g, '/');

// One Schedules record. A booking this page counts is one that puts a JOB
// (scheduletype.type "task", whose typeid is the task's id) in front of a
// PERSON (scheduledto.scheduledtotype "user"). AroFlo also has bookings with
// no job ("adhoc": leave, meetings) and bookings of assets.
function bookingOf(raw) {
  const to = raw.scheduledto || {};
  const what = raw.scheduletype || {};
  const hours = Number(raw.hours);
  return {
    scheduleId: clean(raw.scheduleid),
    toType: clean(to.scheduledtotype).toLowerCase(),
    workerId: clean(to.scheduledtoid),
    worker: clean(to.scheduledtoname),
    kind: clean(what.type).toLowerCase(),
    taskId: clean(what.type).toLowerCase() === 'task' ? clean(what.typeid) : '',
    taskName: clean(what.typename),
    startAt: clean(raw.startdatetime) || clean(raw.startdate),
    endAt: clean(raw.enddatetime) || clean(raw.enddate),
    hours: Number.isFinite(hours) ? hours : 0,
    // The business unit, if the booking itself names one.
    businessUnit: clean(raw.org && raw.org.orgname),
  };
}

async function readBookings(client, aroDay) {
  const raw = await fetchZonePaged(client, {
    zone: 'Schedules',
    pluralKey: 'schedules',
    singularKey: 'schedule',
    where: () => [`and|startdate|=|${aroDay}`],
  });
  const all = raw.map(bookingOf);
  // The filter is trusted but checked: only bookings that start on the day.
  // If none of what came back reads as that day, the dates are in a form
  // this doesn't know — keep them and let the log say so, rather than show
  // an empty day.
  const onTheDay = all.filter((b) => dayPart(b.startAt) === aroDay);
  const dated = onTheDay.length > 0 || all.length === 0;
  const candidates = dated ? onTheDay : all;
  const bookings = candidates.filter((b) => b.taskId && b.worker && (!b.toType || b.toType === 'user'));
  return {
    bookings,
    dated,
    check: {
      received: all.length,
      onTheDay: onTheDay.length,
      fields: raw[0] ? Object.keys(raw[0]).sort() : [],
      bookedTo: tally(all.map((b) => b.toType)),
      bookedFor: tally(all.map((b) => b.kind)),
      // Not acted on: recorded so it can be seen whether these ever vary.
      hidden: tally(raw.map((r) => clean(r.ishidden))),
      nameTheirBusinessUnit: all.filter((b) => b.businessUnit).length,
      jobsBookedToPeople: bookings.length,
      people: new Set(bookings.map((b) => b.workerId || b.worker)).size,
    },
  };
}

// The Tasks zone filters on a field's own filter name, which is not always
// the name the field comes back under (`daterequested` filters what arrives
// as `requestdate` — src/cache.js). `datecompleted` is the one the TTS
// account took; the other is kept as a fallback. A name AroFlo doesn't know
// is refused loudly (AroFloClient.checkEnvelope), never quietly ignored, and
// the one that works is remembered by the caller.
const COMPLETED_FILTERS = ['datecompleted', 'completeddate'];

async function readCompletedSince(client, day, priorities, preferred) {
  const names = preferred ? [preferred, ...COMPLETED_FILTERS.filter((n) => n !== preferred)] : COMPLETED_FILTERS;
  const refused = [];
  for (const name of names) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const raw = await fetchZonePaged(client, { zone: 'Tasks', pluralKey: 'tasks', singularKey: 'task', where: () => [`and|${name}|>=|${day}`] });
      return { filter: name, refused, tasks: raw.map((r) => normalizeTask(r, priorities)) };
    } catch (err) {
      if (!/not available in the/i.test(String(err.message))) throw err;
      refused.push(name);
    }
  }
  return { filter: null, refused, tasks: null };
}

// A booking says which job by its id and its name, nothing else: the job
// number, client, site and priority are on the job. Jobs not already known
// are asked for by id, several to a request ("this id OR that id …").
//
// Whether AroFlo takes several ids at once is judged by what comes back —
// exactly the jobs asked for, and more than one of them — and remembered by
// the caller (`several`: true, false, or null for not yet known). If it
// doesn't, they are asked for one at a time, and only so many per update:
// the rest fill in on the next ones, and the page says how many are waiting.
const IDS_PER_REQUEST = 25;
const ONE_AT_A_TIME_PER_UPDATE = 15;

async function readJobsById(client, ids, priorities, several) {
  const found = new Map();
  let mode = several;
  const ask = async (chunk) => {
    const where = chunk.map((id, i) => `${i === 0 ? 'and' : 'or'}|taskid|=|${id}`);
    const data = await client.getZone('Tasks', { where, page: 1, pageSize: config.pageSize });
    const wanted = new Set(chunk);
    const raw = client.extractRecords(data, 'tasks', 'task');
    const mine = raw.filter((r) => wanted.has(clean(r.taskid)));
    return { mine, exact: mine.length === raw.length };
  };
  try {
    if (mode !== false) {
      for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
        const chunk = ids.slice(i, i + IDS_PER_REQUEST);
        // eslint-disable-next-line no-await-in-loop
        const { mine, exact } = await ask(chunk);
        for (const r of mine) found.set(clean(r.taskid), normalizeTask(r, priorities));
        if (chunk.length > 1) {
          mode = exact && mine.length > 1;
          if (!mode) break;
        }
      }
    }
    if (mode === false) {
      const left = ids.filter((id) => !found.has(id));
      for (const id of left.slice(0, ONE_AT_A_TIME_PER_UPDATE)) {
        // eslint-disable-next-line no-await-in-loop
        const { mine } = await ask([id]);
        for (const r of mine) found.set(clean(r.taskid), normalizeTask(r, priorities));
      }
      // Not asked for this time round.
      return { found, several: mode, error: null, waiting: Math.max(0, left.length - ONE_AT_A_TIME_PER_UPDATE) };
    }
  } catch (err) {
    // The bookings and completions are still good without the job details.
    return { found, several: mode, error: err.message, waiting: 0 };
  }
  return { found, several: mode, error: null, waiting: 0 };
}

const isFinished = (task) => config.completedTaskStatuses.includes(String(task.status || '').toLowerCase());

// What a booking's unit is called when all that is known is that its job
// was left out of the loaded work orders as somebody else's.
const ANOTHER_UNIT = '(another business unit)';

// What the page shows of a job, from a Tasks record.
const describe = (t) => ({
  jobNumber: t.jobNumber || '',
  taskName: t.taskName || '',
  client: t.client || '',
  site: t.locationName || '',
  priority: t.priorityLabel || '',
  status: t.status || '',
  businessUnit: t.businessUnit || '',
});

// `day` is YYYY-MM-DD, in the reports' time zone.
// `knownJobs` is what earlier updates learnt about jobs, by task id, in the
// shape `describe` gives — so a job is looked up once, not every time.
// `loadedJobs` is the work orders the last Refresh loaded, by task id, if
// there has been one: free details for whatever is among them.
// `otherUnitJobs` is the task ids that Refresh left out as another business
// unit's: a booking for one of those is known not to be ours.
// `completedFilter` and `severalIds` are what earlier reads found AroFlo
// accepts (see above); null until known.
async function readDay(
  client,
  { day, priorities = new Map(), knownJobs = new Map(), loadedJobs = new Map(), otherUnitJobs = new Set(), completedFilter = null, severalIds = null, wanted = config.businessUnits },
) {
  const requestsBefore = client.requestCount;
  const aroDay = day.replace(/-/g, '/');
  const names = wanted.join(' + ');
  const everyUnit = wanted.includes(EVERY_UNIT);
  const notes = [];

  const schedule = await readBookings(client, aroDay);
  if (!schedule.dated) notes.push('The dates on AroFlo’s bookings could not be read, so every booking it sent for this day is shown.');

  // ---- finished that day ----
  const since = await readCompletedSince(client, day, priorities, completedFilter);
  let finished;
  let openAgain = [];
  const recent = new Map();
  if (since.tasks) {
    for (const t of since.tasks) recent.set(t.taskId, t);
    const onTheDay = since.tasks.filter((t) => dayPart(t.completedDate) === aroDay);
    // Carries a completion date but is open: it was reopened.
    openAgain = onTheDay.filter((t) => !isFinished(t)).map((t) => t.taskId);
    const done = onTheDay.filter(isFinished);
    const scope = businessUnitScope(done, wanted);
    finished = done.filter(scope.keep);
    if (scope.warning) notes.push(`Completed jobs: ${scope.warning}.`);
  } else {
    finished = [...loadedJobs.values()].filter((t) => dayPart(t.completedDate) === aroDay && isFinished(t));
    notes.push(
      'AroFlo would not say which jobs were completed on a given day, so completions are as of the last Refresh on the report pages — not as of now.',
    );
  }

  // ---- whose bookings, and what the jobs are ----
  // The freshest thing known about a job: today's read, then one made for
  // it below, then the last Refresh, then what an earlier update kept.
  const byId = new Map();
  const detail = (taskId) => {
    const t = recent.get(taskId) || byId.get(taskId) || loadedJobs.get(taskId);
    return t ? describe(t) : knownJobs.get(taskId) || null;
  };
  const withoutDetails = (bookings) => [...new Set(bookings.map((b) => b.taskId))].filter((id) => !detail(id));

  const namesItsUnit = schedule.bookings.some((b) => b.businessUnit);
  let kept;
  let businessUnits;
  let lookup;
  if (namesItsUnit) {
    // The bookings name their own business unit: limit them by it, strictly,
    // and only then spend requests on the jobs that are left.
    const scope = businessUnitScope(schedule.bookings, wanted);
    kept = schedule.bookings.filter(scope.keep);
    businessUnits = scope.summary;
    if (scope.warning) notes.push(`Bookings: ${scope.warning}.`);
    lookup = await readJobsById(client, withoutDetails(kept), priorities, severalIds);
    for (const [id, t] of lookup.found) byId.set(id, t);
  } else {
    // They don't, so a booking's unit is only known through its job: look
    // the unknown jobs up first, then drop the bookings known to be another
    // unit's. One whose job still can't be found can't be told either way,
    // and is kept — said on the page, not hidden.
    lookup = await readJobsById(client, withoutDetails(schedule.bookings).filter((id) => !otherUnitJobs.has(id)), priorities, severalIds);
    for (const [id, t] of lookup.found) byId.set(id, t);
    const unitOf = (b) => (detail(b.taskId) || {}).businessUnit || (otherUnitJobs.has(b.taskId) ? ANOTHER_UNIT : '');
    const bookings = schedule.bookings.map((b) => ({ ...b, businessUnit: unitOf(b) }));
    const wantedPlain = new Set(wanted.map(plain));
    kept = bookings.filter((b) => everyUnit || !b.businessUnit || wantedPlain.has(plain(b.businessUnit)));
    const unknown = kept.filter((b) => !b.businessUnit).length;
    businessUnits = {
      reportsAreFor: wanted,
      received: tally(bookings.map((b) => b.businessUnit || '(not known)')),
      kept: kept.length,
      leftOut: bookings.length - kept.length,
      limited: !everyUnit && unknown === 0,
    };
    if (!everyUnit && unknown) {
      notes.push(
        `AroFlo’s bookings do not say which business unit they belong to, and ${unknown} of the ${kept.length} are for jobs whose details could not be read, so they could not be checked against ${names} and are included.`,
      );
    }
  }

  // ---- what is known about each job ----
  const jobs = {};
  const bookedTasks = [...new Set(kept.map((b) => b.taskId))];
  for (const b of kept) jobs[b.taskId] = detail(b.taskId) || { ...describe({}), taskName: b.taskName };
  const completed = {};
  for (const t of finished) {
    jobs[t.taskId] = describe(t);
    completed[t.taskId] = { at: t.completedDateTime || t.completedDate, by: '', source: 'aroflo' };
  }
  const stillUnknown = bookedTasks.filter((id) => !detail(id)).length;
  if (stillUnknown) {
    const what = `The job number, client, site and priority of ${stillUnknown} booked job${stillUnknown === 1 ? '' : 's'}`;
    if (lookup.error) notes.push(`${what} could not be read from AroFlo (${lookup.error}), so only the name is shown.`);
    else if (lookup.waiting) notes.push(`${what} are still to be read — AroFlo gives them one at a time. Press Update now again to read more.`);
    else notes.push(`${what} did not come back from AroFlo, so only the name is shown.`);
  }

  return {
    bookings: kept.map(({ scheduleId, workerId, worker, taskId, taskName, startAt, endAt, hours }) => ({ scheduleId, workerId, worker, taskId, taskName, startAt, endAt, hours })),
    completed,
    jobs,
    // Everything learnt about jobs this time, for the caller to keep —
    // including jobs looked up only to find they are another unit's, so
    // that they aren't looked up again tomorrow.
    learnt: { ...Object.fromEntries([...byId].map(([id, t]) => [id, describe(t)])), ...jobs },
    notes,
    businessUnits,
    openAgain,
    completedFilter: since.filter,
    severalIds: lookup.several,
    requests: client.requestCount - requestsBefore,
    // For the log: what AroFlo sent, in counts and field names.
    check: {
      day,
      requests: client.requestCount - requestsBefore,
      schedules: schedule.check,
      businessUnits,
      completed: {
        askedBy: since.filter || 'no filter worked',
        refused: since.refused,
        received: since.tasks ? since.tasks.length : null,
        finishedOnTheDay: finished.length,
        reopened: openAgain.length,
        ofTheBookedJobs: bookedTasks.filter((id) => completed[id]).length,
      },
      jobs: {
        booked: bookedTasks.length,
        lookedUpNow: lookup.found.size,
        severalIdsAtOnce: lookup.several,
        lookupError: lookup.error,
        alreadyKnown: bookedTasks.filter((id) => !recent.get(id) && !byId.get(id) && (loadedJobs.get(id) || knownJobs.get(id))).length,
        stillWithoutDetails: stillUnknown,
      },
    },
  };
}

module.exports = { readDay, bookingOf, COMPLETED_FILTERS, IDS_PER_REQUEST, ONE_AT_A_TIME_PER_UPDATE };
