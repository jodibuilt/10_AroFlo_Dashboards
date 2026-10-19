// What the Workloads page knows about each day, kept on disk so a restart or
// a deploy doesn't lose the day, and so past days stay viewable without
// asking AroFlo again. One row a day, as JSON:
//
//   bookings   who was booked to which job that day (AroFlo's Schedules zone)
//   completed  the jobs finished THAT day, by task id — from AroFlo's own
//              list, or pushed by AroFlo as it happened (src/workload/index.js)
//   jobs       what is known about each of those jobs (number, client, site…)
//
// It lives in the app's own database (APP_DB_PATH), beside the nav settings.
//
// Beside it, what has been learnt about each job, by task id: its number,
// client, site, priority, status and when it was finished — as of the last
// time it was read.
//
// And each day's calendar on its own (`workload_schedule_days`), for the
// "Not done yet" tab, which looks back over earlier days: who was booked to
// which job. A day's calendar is read once on a later day and then kept —
// it doesn't change once the day is over. `read_on` is the day (in the
// reports' time zone) it was read on.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS workload_days (
    day TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workload_jobs (
    task_id TEXT PRIMARY KEY,
    data_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS workload_schedule_days (
    day TEXT PRIMARY KEY,
    bookings_json TEXT NOT NULL,
    read_on TEXT NOT NULL,
    read_at TEXT NOT NULL
  );
`;

// A day nothing is known about yet. `bookingsFetchedAt` stays null until the
// bookings have been read from AroFlo — a day can hold completions AroFlo
// pushed before anyone has asked for its bookings.
function emptyDay(day) {
  return {
    day,
    bookingsFetchedAt: null,
    requests: 0,
    notes: [],
    businessUnits: null,
    bookings: [],
    // On the calendar that day but not counted, each with why.
    notCounted: [],
    completed: {},
    jobs: {},
    calendarChangedAt: null,
  };
}

// `db` is the app database's node:sqlite handle (src/db.js, `.raw`).
function openWorkloadStore(db) {
  db.exec(SCHEMA);
  const stmts = {
    get: db.prepare('SELECT data_json FROM workload_days WHERE day = $day'),
    put: db.prepare(`
      INSERT INTO workload_days (day, data_json, updated_at) VALUES ($day, $json, $at)
      ON CONFLICT(day) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
    `),
    // Many at once: the ids as a JSON array (the page asks about a month of calendars' worth).
    getJobs: db.prepare('SELECT task_id, data_json FROM workload_jobs WHERE task_id IN (SELECT value FROM json_each($ids))'),
    putJob: db.prepare(`
      INSERT INTO workload_jobs (task_id, data_json, updated_at) VALUES ($taskId, $json, $at)
      ON CONFLICT(task_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
    `),
    getSchedule: db.prepare('SELECT day, bookings_json, read_on FROM workload_schedule_days WHERE day = $day'),
    putSchedule: db.prepare(`
      INSERT INTO workload_schedule_days (day, bookings_json, read_on, read_at) VALUES ($day, $json, $readOn, $at)
      ON CONFLICT(day) DO UPDATE SET bookings_json = excluded.bookings_json, read_on = excluded.read_on, read_at = excluded.read_at
    `),
    schedules: db.prepare('SELECT day, bookings_json, read_on FROM workload_schedule_days WHERE day >= $from AND day <= $to ORDER BY day'),
  };
  const scheduleOf = (row) => {
    try {
      return { day: row.day, bookings: JSON.parse(row.bookings_json), readOn: row.read_on };
    } catch {
      return null;
    }
  };
  const parse = (row) => {
    try {
      return JSON.parse(row.data_json);
    } catch {
      return null;
    }
  };

  return {
    getDay(day) {
      const row = stmts.get.get({ day });
      return { ...emptyDay(day), ...((row && parse(row)) || {}) };
    },

    saveDay(data) {
      stmts.put.run({ day: data.day, json: JSON.stringify(data), at: new Date().toISOString() });
    },

    // What is on record for these task ids, as a Map; ids nothing is known
    // about are simply not in it.
    getJobs(taskIds) {
      const jobs = new Map();
      const ids = [...new Set(taskIds)].filter(Boolean);
      if (!ids.length) return jobs;
      for (const row of stmts.getJobs.all({ ids: JSON.stringify(ids) })) {
        const job = parse(row);
        if (job) jobs.set(row.task_id, job);
      }
      return jobs;
    },

    // `jobs` is { taskId: details }. Only jobs with a number are worth
    // keeping: one known by name alone still has to be looked up.
    saveJobs(jobs) {
      const at = new Date().toISOString();
      for (const [taskId, job] of Object.entries(jobs)) {
        if (job && job.jobNumber) stmts.putJob.run({ taskId, json: JSON.stringify(job), at });
      }
    },

    // One day's calendar (YYYY-MM-DD): { day, bookings, readOn }, or null.
    getSchedule(day) {
      const row = stmts.getSchedule.get({ day });
      return row ? scheduleOf(row) : null;
    },

    saveSchedule(day, bookings, readOn) {
      stmts.putSchedule.run({ day, json: JSON.stringify(bookings), readOn, at: new Date().toISOString() });
    },

    // The calendars kept for `from` to `to` (both YYYY-MM-DD, inclusive), oldest first.
    schedules(from, to) {
      return stmts.schedules.all({ from, to }).map(scheduleOf).filter(Boolean);
    },
  };
}

module.exports = { openWorkloadStore, emptyDay };
