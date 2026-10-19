// What the Workloads page shows for one day, worked out from what is stored
// for it (src/workload/store.js). Nothing here asks AroFlo for anything.
//
// The rule, as confirmed (2026-10-14: "the logic is simple. take all that is
// scheduled today and then log all that is finished"):
//   - a job is a worker's for the day it is SCHEDULED to them in AroFlo's
//     calendar — whose it is comes from the calendar, nothing else;
//   - a booking hidden on the calendar counts when its job is finished
//     (AroFlo hides a finished job's bookings) and not when the job is
//     still open (a follow-up with the tradie) — see HIDDEN_REASON in read.js;
//   - only an actual job with a job number counts, and not one raised
//     against our own company (whyNotAJob) — those are listed apart, with why;
//   - a job scheduled to two people counts, and is listed, for each;
//   - it is done on the day it is actually finished — so a job booked on
//     Monday and finished on Tuesday is still to do on Monday's page;
//     "Ready for Invoicing" counts as done, and so does a job finished on an
//     earlier day that is still on the calendar.
//
// And a second list, "Not done yet" ("show all scheduled to that person that
// they have not done yet from today backwards to previous days and how many
// of those pending ones they finished today"): every job scheduled to
// someone over the last few weeks, up to and including the day, that isn't
// done — each the job of whoever it was most recently scheduled to, so a job
// moved from one person to another is the second one's — and the ones
// carried over from earlier days that were finished on the day.
const config = require('../config');
const { plain, EVERY_UNIT } = require('../businessUnit');
const { doneBy, isFinished, isForInvoicing, shiftDay, HIDDEN_REASON } = require('./read');

// Why a job booked to someone isn't one of their jobs, or '' if it is
// (2026-10-19, Jodi): only an actual job with a job number counts, and not
// one raised against our own company — that is internal. A customer order
// number is not needed: a real job can lack one ("this is an actual job"),
// and the page then shows its job number instead. `records` is what is on
// record about the job, from wherever it was learnt. A job AroFlo hasn't
// told us about yet (not read — "too many requests", say) is left as it
// was: counted, shown by name.
const NO_JOB_NUMBER = 'No job number';
const INTERNAL = 'Internal job — the client is our own company';

function whyNotAJob(records, internalClients = config.workload.internalClients) {
  const known = records.filter((r) => r && !r.unread);
  if (!known.length) return '';
  const first = (key) => (known.find((r) => r[key]) || {})[key] || '';
  if (!first('jobNumber')) return NO_JOB_NUMBER;
  const client = plain(first('client'));
  if (client && internalClients.some((name) => plain(name) && client.startsWith(plain(name)))) return INTERNAL;
  return '';
}

// One line per worker per job: a job booked to one person twice in a day
// (morning and afternoon) is one job for them, with the hours added up; a
// job booked to two people is a job for each.
function linesOf(bookings) {
  const lines = new Map();
  for (const b of bookings) {
    const key = `${b.workerId || b.worker}|${b.taskId}`;
    const line = lines.get(key);
    if (!line) {
      lines.set(key, { worker: b.worker, taskId: b.taskId, taskName: b.taskName, startAt: b.startAt, endAt: b.endAt, hours: b.hours || 0 });
      continue;
    }
    line.hours += b.hours || 0;
    if (b.startAt && (!line.startAt || b.startAt < line.startAt)) line.startAt = b.startAt;
    if (b.endAt && b.endAt > line.endAt) line.endAt = b.endAt;
  }
  return [...lines.values()];
}

const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
const round2 = (n) => Math.round(n * 100) / 100;
// "2026/10/14 07:30:00" or "2026-10-14" -> "2026/10/14".
const dayPart = (value) => String(value || '').slice(0, 10).replace(/-/g, '/');

// Whole days from one YYYY-MM-DD to another.
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

// `today` is YYYY-MM-DD in the reports' time zone.
function buildWorkloadDay(store, day, { today, backlogDays = config.workload.backlogDays, wanted = config.businessUnits } = {}) {
  const stored = store.getDay(day);
  const aroDay = day.replace(/-/g, '/');
  const describe = (job, fallbackName) => ({
    jobNumber: (job && job.jobNumber) || '',
    customerOrderNumber: (job && job.customerOrderNumber) || '',
    taskName: (job && job.taskName) || fallbackName || '',
    client: (job && job.client) || '',
    site: (job && job.site) || '',
    priority: (job && job.priority) || '',
    status: (job && job.status) || '',
    substatus: (job && job.substatus) || '',
  });

  // ---------- the calendars: the day's, and the days' before it ----------
  const everyUnit = wanted.includes(EVERY_UNIT);
  const wantedPlain = new Set(wanted.map(plain));
  const from = shiftDay(day, -backlogDays);
  const calendars = store.schedules(from, shiftDay(day, -1));
  const onTheDay = stored.bookingsFetchedAt ? stored.bookings : (store.getSchedule(day) || { bookings: [] }).bookings;
  const records = store.getJobs([...new Set([...calendars.flatMap((c) => c.bookings), ...onTheDay].map((b) => b.taskId))]);
  const jobOf = (taskId) => records.get(taskId) || stored.jobs[taskId] || null;
  // For a job with nothing on record about its status: the first day an
  // earlier day's own update found it done.
  const doneOnRecord = new Map();
  for (const { day: d } of calendars) {
    for (const [taskId, done] of Object.entries(store.getDay(d).completed || {})) {
      if (done.unverified) continue;
      const on = dayPart(done.at) || d.replace(/-/g, '/');
      if (!doneOnRecord.has(taskId) || on < doneOnRecord.get(taskId)) doneOnRecord.set(taskId, on);
    }
  }
  // Finished as of now, whenever that was — what decides whether a hidden booking counts.
  const finishedNow = (taskId) => {
    const job = jobOf(taskId);
    if (stored.completed[taskId]) return true;
    if (job && job.status) return isFinished(job) || isForInvoicing(job);
    return doneOnRecord.has(taskId);
  };
  const counts = (b) => !b.hidden || finishedNow(b.taskId);
  // Internal, or without a job number (whyNotAJob).
  const whyNot = (taskId) => whyNotAJob([stored.jobs[taskId], records.get(taskId)]);
  // The day's own record first; the customer order number from wherever it is known.
  const recordOf = (taskId) => {
    const job = stored.jobs[taskId] || records.get(taskId);
    if (!job || job.customerOrderNumber) return job;
    return { ...job, customerOrderNumber: (records.get(taskId) || {}).customerOrderNumber || '' };
  };

  // ---------- scheduled that day ----------
  // (A day stored before the hidden rule holds hidden follow-ups among its bookings: left out here too.)
  const scheduled = stored.bookings.filter((b) => counts(b) && !whyNot(b.taskId));
  const jobs = linesOf(scheduled)
    .map((line) => {
      const done = stored.completed[line.taskId];
      return {
        worker: line.worker,
        ...describe(recordOf(line.taskId), line.taskName),
        start: line.startAt || '',
        end: line.endAt || '',
        hours: round2(line.hours),
        state: done ? 'completed' : 'ongoing',
        // completed (that day), earlier (on a day before), invoicing (with the office to invoice).
        doneHow: done ? done.how || 'completed' : '',
        completedAt: done ? done.at : '',
      };
    })
    .sort((a, b) => byName(a.worker, b.worker) || a.start.localeCompare(b.start) || byName(a.jobNumber, b.jobNumber));

  // ---------- not done yet: the day and the days before it ----------
  // Each job: on which days it was scheduled, and to whom.
  const byTask = new Map();
  for (const { day: d, bookings } of [...calendars, { day, bookings: onTheDay }]) {
    for (const b of bookings) {
      if (!b.taskId || !b.worker || !counts(b)) continue;
      const entry = byTask.get(b.taskId) || { taskName: b.taskName, days: new Map() };
      entry.days.set(d, new Set([...(entry.days.get(d) || []), b.worker]));
      byTask.set(b.taskId, entry);
    }
  }
  const ours = (job) => !job || !job.businessUnit || everyUnit || wantedPlain.has(plain(job.businessUnit));

  const backlogJobs = [];
  for (const [taskId, { taskName, days }] of byTask) {
    const job = jobOf(taskId);
    if (!ours(job) || whyNot(taskId)) continue;
    const scheduledOn = [...days.keys()].sort();
    const last = scheduledOn[scheduledOn.length - 1];
    const carried = scheduledOn[0] < day;
    // On the day's own calendar, done is what the day's update worked out.
    const doneThatDay = last === day && stored.bookingsFetchedAt ? Boolean(stored.completed[taskId]) : false;
    const finishedOnDay = Boolean(stored.completed[taskId] && stored.completed[taskId].how !== 'earlier') || Boolean(job && isFinished(job) && job.completedDate === aroDay);
    const statusKnown = Boolean(job && job.status);
    const done = doneThatDay || finishedOnDay || (statusKnown ? doneBy(job, aroDay) : (doneOnRecord.get(taskId) || '9999') <= aroDay);
    let state;
    if (!done) state = 'open';
    else if (finishedOnDay && carried) state = 'finished';
    else continue;
    // Whoever it was most recently scheduled to; each of them, if two.
    for (const worker of days.get(last)) {
      const theirs = scheduledOn.filter((d) => days.get(d).has(worker));
      backlogJobs.push({
        worker,
        ...describe(job, taskName),
        scheduledDays: theirs,
        firstScheduled: theirs[0],
        lastScheduled: last,
        onDay: last === day,
        daysWaiting: daysBetween(theirs[0], day),
        state,
        completedAt: state === 'finished' ? (stored.completed[taskId] && stored.completed[taskId].at) || (job && job.completedAt) || '' : '',
        // Never read from AroFlo yet: shown by name, as open.
        unread: !job || !job.jobNumber,
      });
    }
  }
  backlogJobs.sort((a, b) => byName(a.worker, b.worker) || Number(a.state === 'finished') - Number(b.state === 'finished') || a.firstScheduled.localeCompare(b.firstScheduled) || byName(a.jobNumber, b.jobNumber));

  // ---------- by worker ----------
  const rows = new Map();
  const rowOf = (worker) => {
    if (!rows.has(worker)) rows.set(worker, { worker, booked: 0, done: 0, open: 0, hours: 0, notDone: 0, notDoneOnDay: 0, notDoneEarlier: 0, finishedFromEarlier: 0, oldest: '', finishedInAll: 0 });
    return rows.get(worker);
  };
  const finishedBy = new Map();
  const finish = (worker, key) => finishedBy.set(worker, new Set([...(finishedBy.get(worker) || []), key]));
  for (const j of jobs) {
    const row = rowOf(j.worker);
    row.booked += 1;
    if (j.state === 'completed') {
      row.done += 1;
      // Finished in all is what was finished ON the day: not a job finished on an earlier day that is still on the calendar.
      if (j.doneHow !== 'earlier') finish(j.worker, `${j.jobNumber}|${j.taskName}`);
    } else row.open += 1;
    row.hours = round2(row.hours + j.hours);
  }
  for (const j of backlogJobs) {
    const row = rowOf(j.worker);
    if (j.state === 'open') {
      row.notDone += 1;
      row[j.onDay ? 'notDoneOnDay' : 'notDoneEarlier'] += 1;
      if (!row.oldest || j.firstScheduled < row.oldest) row.oldest = j.firstScheduled;
    } else {
      row.finishedFromEarlier += 1;
      finish(j.worker, `${j.jobNumber}|${j.taskName}`);
    }
  }
  for (const [worker, keys] of finishedBy) rowOf(worker).finishedInAll = keys.size;
  const workers = [...rows.values()].sort((a, b) => byName(a.worker, b.worker));

  // Finished on the day and on nobody's calendar in all that time. Done all
  // the same, so listed. One AroFlo pushed that has not been matched to a
  // booking or to AroFlo's own list is held back: nothing says whose
  // business unit it belongs to.
  const notBooked = Object.entries(stored.completed)
    .filter(([taskId, done]) => !byTask.has(taskId) && !done.unverified && !whyNot(taskId))
    .map(([taskId, done]) => ({ ...describe(stored.jobs[taskId]), completedAt: done.at, completedBy: done.by || '' }))
    .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));

  // On the calendar that day and not counted, each with why.
  const notCounted = [
    ...(stored.notCounted || []),
    ...stored.bookings.filter((b) => !counts(b)).map((b) => ({ ...b, reason: HIDDEN_REASON })),
    ...stored.bookings.filter((b) => counts(b) && whyNot(b.taskId)).map((b) => ({ ...b, reason: whyNot(b.taskId) })),
  ]
    .map((b) => ({ worker: b.worker, jobNumber: b.jobNumber || (jobOf(b.taskId) || {}).jobNumber || '', customerOrderNumber: b.customerOrderNumber || (jobOf(b.taskId) || {}).customerOrderNumber || '', taskName: b.taskName, start: b.startAt || '', end: b.endAt || '', reason: b.reason }))
    .sort((a, b) => byName(a.worker, b.worker) || a.start.localeCompare(b.start));

  const sum = (key) => workers.reduce((n, w) => n + w[key], 0);
  return {
    data: {
      day,
      today,
      // Past days read "not finished that day"; a day still to come has nothing to finish yet.
      when: day < today ? 'past' : day > today ? 'future' : 'today',
      loaded: Boolean(stored.bookingsFetchedAt),
      workers,
      jobs,
      backlog: {
        // The first day looked at, and how many of the days up to the day have a calendar on record.
        from,
        days: backlogDays,
        calendarsKept: calendars.length,
        jobs: backlogJobs,
      },
      notBooked,
      notCounted,
      totals: {
        workers: workers.filter((w) => w.booked).length,
        booked: sum('booked'),
        done: sum('done'),
        open: sum('open'),
        notDone: sum('notDone'),
        notDoneOnDay: sum('notDoneOnDay'),
        notDoneEarlier: sum('notDoneEarlier'),
        finishedFromEarlier: sum('finishedFromEarlier'),
        finishedInAll: sum('finishedInAll'),
        finishedNotBooked: notBooked.length,
        notCounted: notCounted.length,
      },
    },
    meta: {
      fetchedAt: stored.bookingsFetchedAt,
      requests: stored.requests,
      notes: stored.notes,
      businessUnits: stored.businessUnits,
      // Set when AroFlo says the calendar changed after the bookings were read.
      calendarChangedAt: stored.calendarChangedAt,
    },
  };
}

module.exports = { buildWorkloadDay, linesOf, whyNotAJob, NO_JOB_NUMBER, INTERNAL };
