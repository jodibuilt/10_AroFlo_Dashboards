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
// client, site and priority. A booking gives only the job's id and name, so
// these are read from AroFlo the first time a job turns up — and kept, so
// that is the only time.
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
    before: db.prepare('SELECT data_json FROM workload_days WHERE day < $day ORDER BY day DESC LIMIT $limit'),
    getJob: db.prepare('SELECT data_json FROM workload_jobs WHERE task_id = $taskId'),
    putJob: db.prepare(`
      INSERT INTO workload_jobs (task_id, data_json, updated_at) VALUES ($taskId, $json, $at)
      ON CONFLICT(task_id) DO UPDATE SET data_json = excluded.data_json, updated_at = excluded.updated_at
    `),
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

    // The most recent stored days before `day`, newest first.
    daysBefore(day, limit = 7) {
      return stmts.before.all({ day, limit }).map(parse).filter(Boolean);
    },

    // What is on record for these task ids, as a Map; ids nothing is known
    // about are simply not in it.
    getJobs(taskIds) {
      const jobs = new Map();
      for (const taskId of taskIds) {
        const row = stmts.getJob.get({ taskId });
        const job = row && parse(row);
        if (job) jobs.set(taskId, job);
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
  };
}

module.exports = { openWorkloadStore, emptyDay };
