const config = require('../config');
const { fetchZonePaged } = require('../zoneFetch');
const { normalizeTask } = require('../normalize');
const { businessUnitScope, plain, EVERY_UNIT } = require('../businessUnit');
const { AroFloAuthError, AroFloRateLimitError } = require('../aroflo/errors');

// Reads one day's workload from AroFlo:
//   - every booking in the calendar that day (Schedules) — those that start
//     on it, and those that started earlier and run into it;
//   - each booked job as it stands now (Tasks, by id, with its substatus):
//     its number, client, site, priority, status, and so whether it is done;
//   - the jobs finished that day, booked or not (Tasks, by completion date).
// About five requests for a day of sixty-odd jobs, against the forty-nine
// of a full Refresh — which is why the Workloads page has its own "Update
// now" and neither uses nor needs Refresh.
//
// Nothing booked that day is dropped without a word: a booking the page
// doesn't count (leave, equipment, another business unit's job) is kept,
// with why, and listed on the page apart from the rest.
//
// Seen on the TTS account (2026-10-14): a Schedules record carries `org`,
// `scheduledto`, `scheduletype`, `ishidden`; `startdate =` and Tasks
// `datecompleted >=` are filters AroFlo honours, and so is asking for
// several task ids at once. Every read writes what it found to the log
// (`check`, logged as "Workload check"): counts and field names.

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

function tally(values) {
  const counts = {};
  for (const v of values) counts[v || '(blank)'] = (counts[v || '(blank)'] || 0) + 1;
  return counts;
}

// "2026/10/14 07:30:00" or "2026-10-14T07:30" -> "2026/10/14".
const dayPart = (value) => clean(value).slice(0, 10).replace(/-/g, '/');

// One Schedules record. The page counts a booking that puts a JOB
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
    // Hidden on AroFlo's calendar: a follow-up, not counted (whyNotCounted).
    hidden: clean(raw.ishidden).toLowerCase() === 'true',
    // The business unit the booking itself names. Not trusted on its own:
    // the job's own is what decides (see readDay).
    bookingUnit: clean(raw.org && raw.org.orgname),
  };
}

// Why a booking isn't one of a person's jobs, or '' if it is.
function whyNotCounted(b) {
  if (b.kind !== 'task') return 'Not a job (leave, a meeting…)';
  if (b.toType && b.toType !== 'user') return 'Booked to equipment, not a person';
  if (!b.worker) return 'Booked to nobody';
  return '';
}

// A booking hidden on AroFlo's calendar is one of two things. AroFlo hides
// a job's bookings once the job is finished — seen on the TTS account
// (2026-10-15): every booking of a finished job read back hidden, none of
// the bookings still shown had a finished job, and two of Blake's went from
// shown to hidden the morning he completed them. Those are real work and
// count. A hidden booking on a job that is still open is the office
// following something up with the tradie (2026-10-14: "dont count those
// tagged as hidden as they are not actual jobs sometimes we just need to
// follow up something from the tradie") — not counted.
const HIDDEN_REASON = 'Hidden in AroFlo, job not finished — a follow-up, not a job';

const notReadable = (err) => /not available in the/i.test(String(err && err.message));

// Bookings that started before the day and are still running on it: a job
// booked across several days is on the calendar for each of them. Asked for
// with a filter on the end date; if AroFlo doesn't know it, it says so and
// only the bookings starting on the day are counted. Two pages at most —
// more than that means the filter isn't doing what it should.
//
// AroFlo can also take the filter and not apply it: on the TTS account
// (2026-10-14) it sent two full pages of which not one booking ran into the
// day. Once that has been seen (`honoured` false, remembered by the caller)
// the question isn't asked again — two requests an update for nothing.
async function readRunningInto(client, aroDay, honoured) {
  if (honoured === false) return { records: [], asked: false, complete: false, skipped: true };
  const where = [`and|startdate|<|${aroDay}`, `and|enddate|>=|${aroDay}`];
  const records = [];
  try {
    for (let page = 1; page <= 2; page++) {
      // eslint-disable-next-line no-await-in-loop
      const data = await client.getZone('Schedules', { where, page, pageSize: config.pageSize });
      const batch = client.extractRecords(data, 'schedules', 'schedule');
      records.push(...batch);
      if (batch.length < config.pageSize) return { records, asked: true, complete: true };
    }
    return { records, asked: true, complete: false };
  } catch (err) {
    if (!notReadable(err)) throw err;
    return { records: [], asked: false, complete: false, refused: err.message };
  }
}

// The first and last day among some dates, for the log.
const span = (dates) => {
  const days = dates.map(dayPart).filter(Boolean).sort();
  return days.length ? [days[0], days[days.length - 1]] : [];
};

async function readBookings(client, aroDay, runningHonoured) {
  const starting = await fetchZonePaged(client, {
    zone: 'Schedules',
    pluralKey: 'schedules',
    singularKey: 'schedule',
    where: () => [`and|startdate|=|${aroDay}`],
  });
  const running = await readRunningInto(client, aroDay, runningHonoured);
  const seen = new Set();
  const all = [];
  for (const raw of [...starting, ...running.records]) {
    const b = bookingOf(raw);
    const key = b.scheduleId || JSON.stringify(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    all.push(b);
  }
  // On the calendar that day: starts on it, or started earlier and ends on
  // it or later. If none of what came back reads as that day, the dates are
  // in a form this doesn't know — keep everything and let the log say so,
  // rather than show an empty day.
  const covers = (b) => dayPart(b.startAt) === aroDay || (dayPart(b.startAt) < aroDay && dayPart(b.endAt) >= aroDay);
  const onTheDay = all.filter(covers);
  const dated = onTheDay.length > 0 || all.length === 0;
  const day = dated ? onTheDay : all;

  // Whether AroFlo applied the running-into filter: everything it sent runs
  // into the day. Nothing sent says nothing either way.
  const runningAll = running.records.map(bookingOf);
  const runningCovering = runningAll.filter(covers);
  const honoured = running.refused ? false : running.asked && runningAll.length ? runningCovering.length === runningAll.length : runningHonoured;

  const why = whyNotCounted;
  return {
    bookings: day.filter((b) => !why(b)),
    others: day.filter((b) => why(b)).map((b) => ({ ...b, reason: why(b) })),
    dated,
    running,
    runningHonoured: honoured === undefined ? null : honoured,
    check: {
      received: starting.length,
      runningIntoTheDay: running.asked ? runningCovering.length : running.refused ? 'filter refused' : running.skipped ? 'not asked: AroFlo ignored the filter before' : 0,
      // What the running-into question brought back, by date only.
      runningFilter: running.asked
        ? { received: runningAll.length, runningIntoTheDay: runningCovering.length, applied: honoured, starts: span(runningAll.map((b) => b.startAt)), ends: span(runningAll.map((b) => b.endAt)) }
        : null,
      onTheDay: onTheDay.length,
      fields: starting[0] ? Object.keys(starting[0]).sort() : [],
      bookedTo: tally(day.map((b) => b.toType)),
      bookedFor: tally(day.map((b) => b.kind)),
      hidden: day.filter((b) => b.hidden).length,
      people: new Set(day.filter((b) => !why(b)).map((b) => b.workerId || b.worker)).size,
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
      const raw = await fetchZonePaged(client, { zone: 'Tasks', pluralKey: 'tasks', singularKey: 'task', where: () => [`and|${name}|>=|${day}`], join: ['substatus'] });
      return { filter: name, refused, tasks: raw.map((r) => normalizeTask(r, priorities)) };
    } catch (err) {
      if (!notReadable(err)) throw err;
      refused.push(name);
    }
  }
  return { filter: null, refused, tasks: null };
}

// Each job, as it stands now. Asked for by id, several to a request ("this
// id OR that id …"), with its substatus — without `join=substatus` AroFlo
// sends it empty. Nothing else is joined: with each job's labour as well,
// a request for 25 jobs took longer than AroFlo's 30 seconds on the TTS
// account (2026-10-15).
//
// Whether AroFlo takes several ids at once is judged by what comes back —
// exactly the jobs asked for, and more than one of them — and remembered by
// the caller (`several`: true, false, or null for not yet known). If it
// doesn't, they are asked for one at a time, and only so many per update.
// A request that fails doesn't stop the rest: what it asked for is left as
// last read, and the error said.
const IDS_PER_REQUEST = 25;
const ONE_AT_A_TIME_PER_UPDATE = 15;

async function readJobsById(client, ids, priorities, several) {
  const found = new Map();
  let mode = several;
  let error = null;
  const ask = async (chunk) => {
    const where = chunk.map((id, i) => `${i === 0 ? 'and' : 'or'}|taskid|=|${id}`);
    const data = await client.getZone('Tasks', { where, join: ['substatus'], page: 1, pageSize: config.pageSize });
    const wanted = new Set(chunk);
    const raw = client.extractRecords(data, 'tasks', 'task');
    const mine = raw.filter((r) => wanted.has(clean(r.taskid)));
    return { mine, exact: mine.length === raw.length };
  };
  // One request; a failure is noted and the next one tried. AroFlo saying
  // "too many requests" (on the live site, 2026-10-14: "Exceeded Secondary
  // Daily Rate Limit") stops the asking — what was read is kept, and the
  // rest is read next time. A login AroFlo turns away fails the update: no
  // further request would get past it.
  let limited = false;
  const tryAsk = async (chunk) => {
    if (limited) return null;
    try {
      return await ask(chunk);
    } catch (err) {
      if (err instanceof AroFloAuthError) throw err;
      if (err instanceof AroFloRateLimitError) limited = true;
      error = err.message;
      return null;
    }
  };
  if (mode !== false) {
    for (let i = 0; i < ids.length && !limited; i += IDS_PER_REQUEST) {
      const chunk = ids.slice(i, i + IDS_PER_REQUEST);
      // eslint-disable-next-line no-await-in-loop
      const got = await tryAsk(chunk);
      if (!got) continue;
      for (const r of got.mine) found.set(clean(r.taskid), normalizeTask(r, priorities));
      if (chunk.length > 1) {
        mode = got.exact && got.mine.length > 1;
        if (!mode) break;
      }
    }
  }
  if (mode === false) {
    const left = ids.filter((id) => !found.has(id));
    for (const id of left.slice(0, ONE_AT_A_TIME_PER_UPDATE)) {
      // eslint-disable-next-line no-await-in-loop
      const got = await tryAsk([id]);
      for (const r of got ? got.mine : []) found.set(clean(r.taskid), normalizeTask(r, priorities));
    }
    return { found, several: mode, error, waiting: Math.max(0, left.length - ONE_AT_A_TIME_PER_UPDATE) };
  }
  return { found, several: mode, error, waiting: 0 };
}

const isFinished = (task) => config.completedTaskStatuses.includes(String(task.status || '').toLowerCase());

// Done as far as the field is concerned: the job is with the office to be
// invoiced — its substatus (or status) says "invoic…", as in AroFlo's
// "Ready for Invoicing" (confirmed 2026-10-14: "the invoiced status counts
// as completed too").
const isForInvoicing = (task) => [task.substatus, task.status].some((v) => plain(v).includes('invoic'));

// What a booking's unit is called when all that is known is that its job
// was left out of the loaded work orders as somebody else's.
const ANOTHER_UNIT = '(another business unit)';

// What the page shows of a job, from a Tasks record — and when it was
// finished, if it has been, which the "Not done yet" tab goes by.
const describe = (t) => ({
  jobNumber: t.jobNumber || '',
  // The customer's order number (AroFlo's `custon`): what the page shows as the job.
  customerOrderNumber: t.customerOrderNumber || '',
  taskName: t.taskName || '',
  client: t.client || '',
  site: t.locationName || '',
  priority: t.priorityLabel || '',
  status: t.status || '',
  substatus: t.substatus || '',
  businessUnit: t.businessUnit || '',
  completedDate: dayPart(t.completedDate),
  completedAt: t.completedDateTime || t.completedDate || '',
});

// Whether a job, as last read (`describe`'s shape), was done by the end of
// `aroDay`: finished (Completed / Archived) on that day or before it, or
// with the office to be invoiced — a substatus has no date, so that is
// taken as done whenever it is seen.
function doneBy(job, aroDay) {
  if (!job) return false;
  if (isFinished(job)) return !job.completedDate || job.completedDate <= aroDay;
  return isForInvoicing(job);
}

// Whether a booked job counts as done on `aroDay`, and how:
//   'completed'  finished (Completed / Archived) on that day;
//   'earlier'    finished on an earlier day — still on the calendar, but done;
//   'invoicing'  with the office to be invoiced (only known as of now, so
//                only counted for today);
//   null         not done — or finished on a later day than this one.
function doneOn(task, aroDay, isToday) {
  if (!task) return null;
  const finishedOn = dayPart(task.completedDate);
  if (isFinished(task) && finishedOn) {
    if (finishedOn === aroDay) return { how: 'completed', at: task.completedDateTime || task.completedDate };
    if (finishedOn < aroDay) return { how: 'earlier', at: task.completedDate };
    return null;
  }
  if (isForInvoicing(task) && isToday) return { how: 'invoicing', at: '' };
  return null;
}

// `day` is YYYY-MM-DD, in the reports' time zone; `today` likewise.
// `knownJobs` is what earlier updates learnt about jobs, by task id, in the
// shape `describe` gives — used only if a job can't be read now.
// `loadedJobs` is the work orders the last Refresh loaded, by task id, if
// there has been one — likewise a fallback.
// `otherUnitJobs` is the task ids that Refresh left out as another business
// unit's.
// `completedFilter`, `severalIds` and `runningFilter` are what earlier reads
// found AroFlo accepts; null until known.
async function readDay(
  client,
  {
    day,
    today = day,
    priorities = new Map(),
    knownJobs = new Map(),
    loadedJobs = new Map(),
    otherUnitJobs = new Set(),
    completedFilter = null,
    severalIds = null,
    runningFilter = null,
    wanted = config.businessUnits,
  },
) {
  const requestsBefore = client.requestCount;
  const aroDay = day.replace(/-/g, '/');
  const isToday = day === today;
  const everyUnit = wanted.includes(EVERY_UNIT);
  const wantedPlain = new Set(wanted.map(plain));
  const notes = [];

  const schedule = await readBookings(client, aroDay, runningFilter);
  if (!schedule.dated) notes.push('The dates on AroFlo’s bookings could not be read, so every booking it sent for this day is shown.');
  // Said only when the filter works and there really were that many.
  if (schedule.running.asked && !schedule.running.complete && schedule.runningHonoured) {
    notes.push('AroFlo sent more bookings running into this day from earlier days than expected; only the first 400 were looked at.');
  }

  // ---- each booked job, as it stands now ----
  // Jobs nothing is known about go first: if AroFlo only gives them one at
  // a time and not all fit in this update, those are the ones to read.
  // A job already known to be another business unit's isn't read again:
  // its own unit is on record (`unitOf` below), and that is all that matters.
  const knownOf = (id) => (knownJobs.get(id) || loadedJobs.get(id) ? 1 : 0);
  const knownElsewhere = (id) => {
    const known = knownJobs.get(id);
    return Boolean(known && known.businessUnit) && !everyUnit && !wantedPlain.has(plain(known.businessUnit));
  };
  const bookedIds = [...new Set(schedule.bookings.map((b) => b.taskId))].filter((id) => !otherUnitJobs.has(id) && !knownElsewhere(id)).sort((a, b) => knownOf(a) - knownOf(b));
  const lookup = await readJobsById(client, bookedIds, priorities, severalIds);
  const now = (taskId) => lookup.found.get(taskId) || loadedJobs.get(taskId) || null;
  const detail = (taskId) => {
    const t = now(taskId);
    return t ? describe(t) : knownJobs.get(taskId) || null;
  };

  // ---- whose bookings ----
  // The job's own business unit decides. A booking names one too, but it
  // can be the unit of whoever made the booking rather than of the work, so
  // it is only used when the job's can't be read.
  const unitOf = (b) => (detail(b.taskId) || {}).businessUnit || (otherUnitJobs.has(b.taskId) ? ANOTHER_UNIT : '') || b.bookingUnit;
  const isOurs = (unit) => everyUnit || wantedPlain.has(plain(unit));
  const withUnit = schedule.bookings.map((b) => ({ ...b, unit: unitOf(b) }));
  const kept = withUnit.filter((b) => !b.unit || isOurs(b.unit));
  const elsewhere = withUnit.filter((b) => b.unit && !isOurs(b.unit));
  // Other units' work is simply not on the page (confirmed 2026-10-14: "no
  // need to show other business units and no need to explain"). What was
  // left out, and what couldn't be told, is in the log only.
  const unknown = kept.filter((b) => !b.unit).length;
  const businessUnits = {
    reportsAreFor: wanted,
    received: tally(withUnit.map((b) => b.unit || '(not known)')),
    kept: kept.length,
    leftOut: elsewhere.length,
    limited: !everyUnit && unknown === 0,
  };

  // ---- finished that day, booked or not ----
  const since = await readCompletedSince(client, day, priorities, completedFilter);
  let finishedElsewhere = [];
  if (since.tasks) {
    const onTheDay = since.tasks.filter((t) => dayPart(t.completedDate) === aroDay && isFinished(t));
    const scope = businessUnitScope(onTheDay, wanted);
    finishedElsewhere = onTheDay.filter(scope.keep);
    if (scope.warning) notes.push(`Completed jobs: ${scope.warning}.`);
  } else {
    finishedElsewhere = [...loadedJobs.values()].filter((t) => dayPart(t.completedDate) === aroDay && isFinished(t));
    notes.push('AroFlo would not say which jobs were completed on a given day, so jobs finished without being booked are as of the last Refresh on the report pages.');
  }

  // ---- hidden bookings: real work if the job is finished, a follow-up if not ----
  // (HIDDEN_REASON.) Finished as of now, whenever that was: on a day gone
  // by, a job finished since is still that day's work, not yet done.
  const finishedThatDay = new Set(finishedElsewhere.map((t) => t.taskId));
  const jobFinished = (taskId) => {
    const t = now(taskId) || (finishedThatDay.has(taskId) ? { status: 'Completed' } : null) || knownJobs.get(taskId) || null;
    return Boolean(t && (isFinished(t) || isForInvoicing(t)));
  };
  const counted = kept.filter((b) => !b.hidden || jobFinished(b.taskId));
  const followUps = kept.filter((b) => b.hidden && !jobFinished(b.taskId));

  // ---- what is known about each job, and which are done ----
  const jobs = {};
  const completed = {};
  for (const b of counted) {
    jobs[b.taskId] = detail(b.taskId) || { ...describe({}), taskName: b.taskName };
    const done = doneOn(now(b.taskId), aroDay, isToday);
    if (done) completed[b.taskId] = { at: done.at, how: done.how, by: '', source: 'aroflo' };
  }
  for (const t of finishedElsewhere) {
    if (!jobs[t.taskId]) jobs[t.taskId] = describe(t);
    if (!completed[t.taskId]) completed[t.taskId] = { at: t.completedDateTime || t.completedDate, how: 'completed', by: '', source: 'aroflo' };
  }
  // Re-opened since: carries a completion date for the day, open now.
  const openAgain = [...lookup.found.values()].filter((t) => dayPart(t.completedDate) === aroDay && !isFinished(t)).map((t) => t.taskId);

  const stillUnknown = [...new Set(counted.map((b) => b.taskId))].filter((id) => !detail(id)).length;
  if (stillUnknown) {
    const what = `The job number, client, site and priority of ${stillUnknown} booked job${stillUnknown === 1 ? '' : 's'}`;
    if (lookup.error) notes.push(`${what} could not be read from AroFlo (${lookup.error}), so only the name is shown.`);
    else if (lookup.waiting) notes.push(`${what} are still to be read — AroFlo gives them one at a time. Press Update now again to read more.`);
    else notes.push(`${what} did not come back from AroFlo, so only the name is shown.`);
  }

  // On the calendar that day and not a person's job (leave, equipment, a
  // follow-up), with why — so nothing of ours on the calendar goes missing
  // without a word. Other business units' bookings are not listed at all.
  const notCounted = [
    ...schedule.others.map((b) => ({ ...pickBooking(b), jobNumber: '', reason: b.reason })),
    ...followUps.map((b) => ({ ...pickBooking(b), jobNumber: (detail(b.taskId) || {}).jobNumber || '', customerOrderNumber: (detail(b.taskId) || {}).customerOrderNumber || '', reason: HIDDEN_REASON })),
  ];

  const bookedTasks = [...new Set(counted.map((b) => b.taskId))];
  const doneHow = tally(bookedTasks.map((id) => (completed[id] ? completed[id].how : 'not done')));
  return {
    bookings: counted.map(pickBooking),
    notCounted,
    completed,
    jobs,
    // Everything learnt about jobs this time, for the caller to keep.
    learnt: { ...Object.fromEntries([...lookup.found].map(([id, t]) => [id, describe(t)])), ...jobs },
    // The jobs read from AroFlo just now — no need to read them again for the earlier days.
    freshIds: [...lookup.found.keys(), ...finishedElsewhere.map((t) => t.taskId)],
    notes,
    businessUnits,
    openAgain,
    completedFilter: since.filter,
    severalIds: lookup.several,
    runningFilter: schedule.runningHonoured,
    requests: client.requestCount - requestsBefore,
    // For the log: what AroFlo sent, in counts and field names.
    check: {
      day,
      requests: client.requestCount - requestsBefore,
      schedules: schedule.check,
      businessUnits,
      // Where the booking's own unit and its job's disagree — the reason the
      // job's is the one used.
      bookingUnitDiffersFromJob: withUnit.filter((b) => b.bookingUnit && (detail(b.taskId) || {}).businessUnit && plain(b.bookingUnit) !== plain(detail(b.taskId).businessUnit)).length,
      otherUnitsBookings: elsewhere.length,
      bookingsWhoseUnitIsUnknown: unknown,
      notCounted: tally(notCounted.map((b) => b.reason)),
      // Hidden bookings: on a finished job (counted) or an open one (a follow-up).
      hidden: { onFinishedJobs: counted.filter((b) => b.hidden).length, followUps: followUps.length },
      jobs: {
        booked: bookedTasks.length,
        readNow: lookup.found.size,
        severalIdsAtOnce: lookup.several,
        lookupError: lookup.error,
        stillWithoutDetails: stillUnknown,
        done: doneHow,
        substatuses: tally(bookedTasks.map((id) => (detail(id) || {}).substatus || '')),
      },
      completed: {
        askedBy: since.filter || 'no filter worked',
        refused: since.refused,
        received: since.tasks ? since.tasks.length : null,
        finishedOnTheDay: finishedElsewhere.length,
        reopened: openAgain.length,
      },
    },
  };
}

// What is kept of a booking.
function pickBooking({ scheduleId, workerId, worker, taskId, taskName, startAt, endAt, hours, hidden }) {
  return { scheduleId, workerId, worker, taskId, taskName, startAt, endAt, hours, hidden: Boolean(hidden) };
}

// A YYYY-MM-DD day moved by some days, by the calendar.
const pad2 = (n) => String(n).padStart(2, '0');
function shiftDay(day, by) {
  const [y, m, d] = day.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + by));
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

// One day's calendar, for the "Not done yet" tab: every booking of a job to
// a person that starts on the day, hidden ones too (marked, so they can be
// left out where they are counted).
async function readScheduleDay(client, day) {
  const aroDay = day.replace(/-/g, '/');
  const raw = await fetchZonePaged(client, { zone: 'Schedules', pluralKey: 'schedules', singularKey: 'schedule', where: () => [`and|startdate|=|${aroDay}`] });
  return raw
    .map(bookingOf)
    .filter((b) => b.kind === 'task' && (!b.toType || b.toType === 'user') && b.worker && b.taskId)
    .map(pickBooking);
}

// For the "Not done yet" tab (2026-10-14: "show all scheduled to that person
// that they have not done yet from today backwards to previous days and how
// many of those pending ones they finished today"): the calendars of the
// `days` days before `day`, and each job on them as it stands now.
//
// A day's calendar is read once on a later day and kept (`schedules`, the
// store): it doesn't change once the day is over. A job already known to be
// finished — with the date — isn't read again either; nor is one this
// update has just read (`fresh`). The rest are read 25 to a request. So
// the first update reads about a month of calendars; after that it is the
// day just gone and the jobs still open.
//
// `stop` says when to stop reading (the daily allowance running low);
// whatever wasn't read is said in a note, and read next time.
async function readEarlierDays(client, { day, today, days, schedules, knownJobs, fresh = new Set(), priorities = new Map(), several = null, stop = () => false, wanted = config.businessUnits }) {
  const requestsBefore = client.requestCount;
  const notes = [];
  const kept = [];
  const daysRead = [];
  let stopped = false;
  for (let i = days; i >= 1; i--) {
    const d = shiftDay(day, -i);
    let calendar = schedules.getSchedule(d);
    // Read on the day itself (or before): it may have changed since.
    if (!calendar || calendar.readOn <= d) {
      if (stopped || stop()) {
        stopped = true;
        if (calendar) kept.push(calendar);
        continue;
      }
      let bookings;
      try {
        // eslint-disable-next-line no-await-in-loop
        bookings = await readScheduleDay(client, d);
      } catch (err) {
        // The day itself is read; the earlier ones wait for the next update.
        notes.push(`Earlier days’ calendars stopped being read (${err.message}).`);
        stopped = true;
        if (calendar) kept.push(calendar);
        continue;
      }
      schedules.saveSchedule(d, bookings, today);
      calendar = { day: d, bookings, readOn: today };
      daysRead.push(d);
    }
    kept.push(calendar);
  }
  const missing = days - kept.length;
  if (missing) notes.push(`The calendar of ${missing} earlier day${missing === 1 ? '' : 's'} is still to be read, so Not done yet may be missing some jobs. Press Update now again later.`);

  // The jobs on them, as they stand now — unless already known finished, or
  // another business unit's (never shown, so its status doesn't matter), or
  // just read. Not the jobs of hidden bookings: one of those only counts if
  // the job was finished on the day (HIDDEN_REASON), and the day's own list
  // of completed jobs, read just now, already says which those are.
  const settled = (id) => {
    const known = knownJobs.get(id);
    if (!known) return false;
    if (known.completedDate && isFinished(known)) return true;
    return Boolean(known.businessUnit) && !wanted.includes(EVERY_UNIT) && !wanted.map(plain).includes(plain(known.businessUnit));
  };
  const ids = [...new Set(kept.flatMap((c) => c.bookings.filter((b) => !b.hidden).map((b) => b.taskId)))].filter((id) => !fresh.has(id) && !settled(id));
  let lookup = { found: new Map(), several, error: null, waiting: 0 };
  if (ids.length && !stopped && !stop()) lookup = await readJobsById(client, ids, priorities, several);
  else if (ids.length) notes.push(`${ids.length} job${ids.length === 1 ? '' : 's'} from earlier days could not be checked this time, so they show as last read.`);
  if (lookup.error) notes.push(`Some jobs from earlier days could not be read from AroFlo (${lookup.error}), so they show as last read.`);
  if (lookup.waiting) notes.push(`${lookup.waiting} jobs from earlier days are still to be checked — AroFlo gives them one at a time. Press Update now again to check more.`);

  const found = [...lookup.found.values()];
  return {
    learnt: Object.fromEntries(found.map((t) => [t.taskId, describe(t)])),
    severalIds: lookup.several,
    notes,
    requests: client.requestCount - requestsBefore,
    check: { days, daysRead: daysRead.length, daysKept: kept.length, jobsOnThem: new Set(kept.flatMap((c) => c.bookings.map((b) => b.taskId))).size, jobsRead: lookup.found.size, jobsToRead: ids.length },
  };
}

module.exports = {
  readDay,
  readEarlierDays,
  readScheduleDay,
  bookingOf,
  doneOn,
  doneBy,
  isFinished,
  isForInvoicing,
  shiftDay,
  whyNotCounted,
  HIDDEN_REASON,
  COMPLETED_FILTERS,
  IDS_PER_REQUEST,
  ONE_AT_A_TIME_PER_UPDATE,
};
