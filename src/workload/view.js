// What the Workloads page shows for one day, worked out from what is stored
// for it (src/workload/store.js). Nothing here asks AroFlo for anything.
//
// The rule, as confirmed (2026-10-14):
//   - a job is a worker's for the day it is BOOKED to them in AroFlo's calendar;
//   - it is COMPLETED on the day it is actually finished — so a job booked
//     on Monday and finished on Tuesday is ongoing on Monday's page and
//     completed on Tuesday's.

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

// `today` is YYYY-MM-DD in the reports' time zone.
function buildWorkloadDay(store, day, { today }) {
  const stored = store.getDay(day);
  const describe = (taskId, fallbackName) => {
    const job = stored.jobs[taskId] || {};
    return {
      jobNumber: job.jobNumber || '',
      taskName: job.taskName || fallbackName || '',
      client: job.client || '',
      site: job.site || '',
      priority: job.priority || '',
      status: job.status || '',
    };
  };

  const jobs = linesOf(stored.bookings)
    .map((line) => {
      const done = stored.completed[line.taskId];
      return {
        worker: line.worker,
        ...describe(line.taskId, line.taskName),
        start: line.startAt || '',
        end: line.endAt || '',
        hours: Math.round(line.hours * 100) / 100,
        state: done ? 'completed' : 'ongoing',
        completedAt: done ? done.at : '',
      };
    })
    .sort((a, b) => byName(a.worker, b.worker) || a.start.localeCompare(b.start) || byName(a.jobNumber, b.jobNumber));

  const workers = [];
  for (const job of jobs) {
    let row = workers[workers.length - 1];
    if (!row || row.worker !== job.worker) {
      row = { worker: job.worker, booked: 0, completed: 0, ongoing: 0, hours: 0 };
      workers.push(row);
    }
    row.booked += 1;
    row[job.state] += 1;
    row.hours = Math.round((row.hours + job.hours) * 100) / 100;
  }

  // Finished on the day without being booked on it: done all the same, and
  // on nobody's list above. Credited, where it can be, to whoever it was
  // last booked to. One AroFlo pushed that has not yet been matched to a
  // booking or to AroFlo's own list is held back — nothing says whose
  // business unit it belongs to.
  const booked = new Set(stored.bookings.map((b) => b.taskId));
  const earlier = store.daysBefore(day, 7);
  const lastBookedTo = (taskId) => {
    for (const d of earlier) {
      const hit = (d.bookings || []).find((b) => b.taskId === taskId);
      if (hit) return hit.worker;
    }
    return '';
  };
  const notBooked = Object.entries(stored.completed)
    .filter(([taskId, done]) => !booked.has(taskId) && !done.unverified)
    .map(([taskId, done]) => ({ ...describe(taskId), completedAt: done.at, completedBy: done.by || '', lastBookedTo: lastBookedTo(taskId) }))
    .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));

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
      notBooked,
      totals: { workers: workers.length, booked: sum('booked'), completed: sum('completed'), ongoing: sum('ongoing'), completedNotBooked: notBooked.length },
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

module.exports = { buildWorkloadDay, linesOf };
