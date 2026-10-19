// The Workloads page: jobs booked to each field worker on a day, and how
// many are done. Checked against cases worked out by hand, with the real
// client pointed at a stand-in for AroFlo. Run with `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { DatabaseSync } = require('node:sqlite');
const { day, rawTask, task, cacheOf, standIn, quiet } = require('./helpers');
const { openWorkloadStore, emptyDay } = require('../src/workload/store');
const { buildWorkloadDay } = require('../src/workload/view');
const { readDay, readEarlierDays, doneOn } = require('../src/workload/read');
const { createWorkload, instantOf } = require('../src/workload');
const { sameSecret } = require('../src/workload/token');

// Days as the page names them (YYYY-MM-DD) beside AroFlo's YYYY/MM/DD.
const iso = (offset = 0) => day(offset).replace(/\//g, '-');
const taskId = (job) => `internal-${job}==`;

// A Schedules record: `worker` booked to job `job` on a day.
function booking(id, worker, job, { on = day(0), until = on, start = '07:00:00', end = '09:00:00', hours = 2, type = 'task', toType = 'user', businessUnit, hidden = false } = {}) {
  return {
    scheduleid: id,
    scheduletype: { type, typeid: type === 'task' ? taskId(job) : '', typename: type === 'task' ? `Job ${job}` : 'Annual leave' },
    scheduledto: { scheduledtoid: `id-${worker}`, scheduledtotype: toType, scheduledtoname: worker },
    startdatetime: `${on} ${start}`,
    enddatetime: `${until} ${end}`,
    hours: String(hours),
    ishidden: String(hidden),
    ...(businessUnit ? { org: { orgid: 'bu', orgname: businessUnit } } : {}),
  };
}

// What kind of request reached the stand-in.
const asksById = (request) => request.where.some((w) => w.split('|')[1] === 'taskid');
const asksRunning = (request) => request.where.some((w) => w.startsWith('and|startdate|<|'));
const jobsById = (pool, request) => pool.filter((t) => request.where.map((w) => w.split('|')[3]).includes(t.taskid));
const kindOf = (r) => (r.zone === 'Schedules' ? (asksRunning(r) ? 'Schedules running in' : 'Schedules') : asksById(r) ? `Tasks by id x${r.where.length}` : r.zone);

// The day a "startdate =" request asks for, as AroFlo writes it.
const askedDay = (request) => (request.where.find((w) => w.startsWith('and|startdate|=|')) || '').split('|')[3];

// An AroFlo that answers like the TTS account: the bookings in `starting`
// that start on the day asked for, `running` ones from earlier days, jobs by
// id from `pool`, and `finished` for "completed since".
function aroflo({ starting = [], running = [], pool = [], finished = [], priorities = [] }) {
  return standIn((zone, request) => {
    // One page of each: the tests' page size is small, and a full page would be asked for again.
    if (request.page > 1) return [];
    if (zone === 'Priorities') return priorities;
    if (zone === 'Schedules') return asksRunning(request) ? running : starting.filter((b) => b.startdatetime.startsWith(askedDay(request)));
    if (zone === 'Tasks') return asksById(request) ? jobsById(pool, request) : finished;
    return [];
  });
}

// A worker's row on the page, zero but for `fields`.
const row = (worker, fields = {}) => ({ worker, booked: 0, done: 0, open: 0, hours: 0, notDone: 0, notDoneOnDay: 0, notDoneEarlier: 0, finishedFromEarlier: 0, oldest: '', finishedInAll: 0, ...fields });
const jobNo = (id) => id.replace(/internal-|==/g, '');

const memoryStore = () => openWorkloadStore(new DatabaseSync(':memory:'));
// A day as an update stores it. Each booked job has a number and a customer
// order number unless the test says otherwise in `jobs`.
const stored = (store, dayIso, fields) => {
  const known = Object.fromEntries((fields.bookings || []).map((b) => [b.taskId, { jobNumber: jobNo(b.taskId), customerOrderNumber: `PO-${jobNo(b.taskId)}`, taskName: b.taskName }]));
  return store.saveDay({ ...emptyDay(dayIso), bookingsFetchedAt: new Date().toISOString(), ...fields, jobs: { ...known, ...fields.jobs } });
};
const booked = (worker, job, extra = {}) => ({ scheduleId: `s-${worker}-${job}-${extra.startAt || ''}`, workerId: `id-${worker}`, worker, taskId: taskId(job), taskName: `Job ${job}`, startAt: '', endAt: '', hours: 0, ...extra });

// The app's key/value settings, in memory.
function settingsMap() {
  const values = new Map();
  return { getSetting: (key, fallback = null) => (values.has(key) ? values.get(key) : fallback), setSetting: (key, value) => values.set(key, value), values };
}

test('a job is a worker’s on the day it is scheduled, and done on the day it is finished', () => {
  const store = memoryStore();
  const monday = iso(-1);
  const tuesday = iso(0);
  // Monday: Sam has two jobs and finishes one. Tuesday: a new job, finished — and Monday's other one, finished too.
  const mondays = [booked('Sam', 1), booked('Sam', 2)];
  stored(store, monday, { bookings: mondays, completed: { [taskId(2)]: { at: `${day(-1)} 15:00:00`, how: 'completed', by: '', source: 'aroflo' } } });
  store.saveSchedule(monday, mondays, tuesday); // as Tuesday's update keeps it
  stored(store, tuesday, {
    bookings: [booked('Sam', 3)],
    completed: { [taskId(1)]: { at: `${day(0)} 09:10:00`, how: 'completed', by: '', source: 'aroflo' }, [taskId(3)]: { at: `${day(0)} 11:00:00`, how: 'completed', by: '', source: 'aroflo' } },
    jobs: { [taskId(1)]: { jobNumber: '1', taskName: 'Job 1' } },
  });

  const mon = buildWorkloadDay(store, monday, { today: tuesday }).data;
  assert.equal(mon.when, 'past');
  // Job 1 was not finished on Monday, whatever happened later: still to do that day, and not done by its end.
  assert.deepEqual(mon.workers, [row('Sam', { booked: 2, done: 1, open: 1, notDone: 1, notDoneOnDay: 1, oldest: monday, finishedInAll: 1 })]);
  assert.deepEqual(mon.jobs.map((j) => [j.taskName, j.state]), [['Job 1', 'ongoing'], ['Job 2', 'completed']]);
  assert.deepEqual(mon.backlog.jobs.map((j) => [j.worker, j.taskName, j.state, j.onDay]), [['Sam', 'Job 1', 'open', true]]);

  const tue = buildWorkloadDay(store, tuesday, { today: tuesday }).data;
  assert.equal(tue.when, 'today');
  // Monday's job, finished on Tuesday: one of Sam's carried over from an earlier day, finished today.
  assert.deepEqual(tue.workers, [row('Sam', { booked: 1, done: 1, finishedFromEarlier: 1, finishedInAll: 2 })]);
  assert.deepEqual(tue.backlog.jobs.map((j) => [j.worker, j.jobNumber, j.state, j.firstScheduled, j.completedAt]), [['Sam', '1', 'finished', monday, `${day(0)} 09:10:00`]]);
  assert.deepEqual(tue.notBooked, []);
  assert.deepEqual(tue.totals, { workers: 1, booked: 1, done: 1, open: 0, notDone: 0, notDoneOnDay: 0, notDoneEarlier: 0, finishedFromEarlier: 1, finishedInAll: 2, finishedNotBooked: 0, notCounted: 0 });
});

test('only an actual job with a job number counts, with or without a customer order number, and not one raised against our own company', () => {
  const store = memoryStore();
  stored(store, iso(0), {
    bookings: [booked('Sam', 1), booked('Elias', 2), booked('Ray', 3), booked('Ray', 4), booked('Kim', 5), booked('Lee', 6), booked('Pat', 7)],
    completed: { [taskId(8)]: { at: `${day(0)} 10:00:00`, how: 'completed', by: '', source: 'aroflo' } },
    jobs: {
      // Time booked to an internal job, as Elias's "APY - Preliminaries" (2026-10-19).
      [taskId(2)]: { jobNumber: '2', customerOrderNumber: '', taskName: 'APY - Preliminaries', client: 'ttsRMS' },
      [taskId(3)]: { jobNumber: '3', customerOrderNumber: 'PO-3', taskName: 'Labour - Carpentry', client: 'TTS Contracting Services Pty Ltd' },
      // A real job without a customer order number, as 16573 "315A Umuwa - Front Door Handle": counted.
      [taskId(4)]: { jobNumber: '4', customerOrderNumber: '', taskName: 'Job 4', client: 'Anangu Pitjantjatjara Yankunytjatjara' },
      // Not read from AroFlo (too many requests): nothing known either way, so counted by name.
      [taskId(5)]: { jobNumber: '', customerOrderNumber: '', taskName: 'Job 5', unread: true },
      // Kept before customer order numbers were: nothing known of it either way.
      [taskId(6)]: { jobNumber: '6', taskName: 'Job 6', client: 'Ventia' },
      [taskId(7)]: { jobNumber: '', customerOrderNumber: 'PO-7', taskName: 'Job 7', client: 'Ventia' },
      // Finished unbooked, but internal: not listed as done either.
      [taskId(8)]: { jobNumber: '8', customerOrderNumber: 'PO-8', taskName: 'Yard tidy', client: 'TTSRMS' },
    },
  });
  const { data } = buildWorkloadDay(store, iso(0), { today: iso(0) });
  assert.deepEqual(data.jobs.map((j) => [j.worker, j.jobNumber, j.customerOrderNumber]), [['Kim', '', ''], ['Lee', '6', ''], ['Ray', '4', ''], ['Sam', '1', 'PO-1']]);
  assert.deepEqual(data.backlog.jobs.map((j) => j.worker), ['Kim', 'Lee', 'Ray', 'Sam']);
  assert.deepEqual(data.notBooked, []);
  assert.deepEqual(data.notCounted.map((j) => [j.worker, j.jobNumber, j.reason]), [
    ['Elias', '2', 'Internal job — the client is our own company'],
    ['Pat', '', 'No job number'],
    ['Ray', '3', 'Internal job — the client is our own company'],
  ]);
});

test('booked twice to one person is one job for them; booked to two people is a job for each; hidden counts only on a finished job', () => {
  const store = memoryStore();
  stored(store, iso(0), {
    // (A day stored before the hidden rule holds hidden bookings of both kinds.)
    bookings: [
      booked('Sam', 7, { startAt: `${day(0)} 13:00:00`, endAt: `${day(0)} 14:00:00`, hours: 1 }),
      booked('Sam', 7, { startAt: `${day(0)} 07:30:00`, endAt: `${day(0)} 09:30:00`, hours: 2 }),
      booked('Alex', 7, { startAt: `${day(0)} 07:30:00`, endAt: `${day(0)} 09:30:00`, hours: 2 }),
      // Hidden, job still open: the office following up with the tradie — not a job.
      booked('Kim', 8, { startAt: `${day(0)} 10:00:00`, endAt: `${day(0)} 10:30:00`, hours: 0.5, hidden: true }),
      // Hidden, job finished: AroFlo hides a finished job's bookings — real work, and done.
      booked('Lee', 9, { startAt: `${day(0)} 08:00:00`, endAt: `${day(0)} 10:00:00`, hours: 2, hidden: true }),
      // Finished two days ago and still on today's calendar: done, but not something Pat finished today.
      booked('Pat', 10, { startAt: `${day(0)} 08:00:00`, endAt: `${day(0)} 09:00:00`, hours: 1 }),
    ],
    completed: {
      [taskId(9)]: { at: `${day(0)} 09:50:00`, how: 'completed', by: '', source: 'aroflo' },
      [taskId(10)]: { at: day(-2), how: 'earlier', by: '', source: 'aroflo' },
    },
  });
  store.saveJobs({ [taskId(8)]: { jobNumber: '8', taskName: 'Job 8', status: 'Pending' } });
  const { data } = buildWorkloadDay(store, iso(0), { today: iso(0) });
  assert.deepEqual(data.workers, [
    row('Alex', { booked: 1, open: 1, hours: 2, notDone: 1, notDoneOnDay: 1, oldest: iso(0) }),
    row('Lee', { booked: 1, done: 1, hours: 2, finishedInAll: 1 }),
    row('Pat', { booked: 1, done: 1, hours: 1 }),
    row('Sam', { booked: 1, open: 1, hours: 3, notDone: 1, notDoneOnDay: 1, oldest: iso(0) }),
  ]);
  const sam = data.jobs.find((j) => j.worker === 'Sam');
  assert.deepEqual([sam.start, sam.end], [`${day(0)} 07:30:00`, `${day(0)} 14:00:00`]);
  assert.deepEqual(data.notCounted.map((j) => [j.worker, j.jobNumber, j.reason]), [['Kim', '8', 'Hidden in AroFlo, job not finished — a follow-up, not a job']]);
  // A day nobody has asked AroFlo about yet says so.
  assert.equal(buildWorkloadDay(store, iso(1), { today: iso(0) }).data.loaded, false);
  assert.equal(buildWorkloadDay(store, iso(1), { today: iso(0) }).data.when, 'future');
});

test('everything on the calendar that day is read — what starts on it and what runs into it — and what isn’t counted is kept, with why', async () => {
  const stand = await aroflo({
    starting: [
      booking('s1', 'Sam', 501),
      booking('s2', 'Sam', 0, { type: 'adhoc' }), // leave
      booking('s3', 'Van 3', 502, { toType: 'asset' }), // equipment
      booking('s6', 'Kim', 505, { hidden: true }), // hidden, job still open: a follow-up with the tradie, not a job
      booking('s7', 'Lee', 506, { hidden: true }), // hidden, job finished: AroFlo hides a finished job's bookings — counted
    ],
    running: [
      booking('s4', 'Alex', 503, { on: day(-2), until: day(1) }), // a three-day booking: on the calendar today
      booking('s5', 'Kim', 504, { on: day(-3), until: day(-1) }), // ended yesterday: not today's, whatever the filter sent
    ],
    pool: [{ job: 501 }, { job: 503 }, { job: 505, status: 'Pending' }, { job: 506, status: 'Completed', completed: day(0) }].map((t) => rawTask({ ...t, businessUnit: 'TTS RMS' })),
  });
  try {
    const read = await readDay(stand.client, { day: iso(0) });
    const ids = (...jobs) => jobs.map((job, i) => `${i ? 'or' : 'and'}|taskid|=|${taskId(job)}`);
    // Every job on the calendar is read, hidden ones too — whether the job is finished decides whether a hidden one counts.
    // (Five to a page in the tests: a full page is followed by a look at the next.)
    assert.deepEqual(stand.requests.map((r) => [kindOf(r), r.where, r.join]), [
      ['Schedules', [`and|startdate|=|${day(0)}`], []],
      ['Schedules', [`and|startdate|=|${day(0)}`], []],
      ['Schedules running in', [`and|startdate|<|${day(0)}`, `and|enddate|>=|${day(0)}`], []],
      ['Tasks by id x4', ids(501, 505, 506, 503), ['substatus']],
      ['Tasks', [`and|datecompleted|>=|${iso(0)}`], ['substatus']],
    ]);
    assert.deepEqual(read.bookings.map((b) => [b.worker, jobNo(b.taskId), b.hidden]), [['Sam', '501', false], ['Lee', '506', true], ['Alex', '503', false]]);
    assert.ok(read.completed[taskId(506)]);
    assert.deepEqual(read.notCounted.map((b) => [b.worker, b.jobNumber, b.reason]), [
      ['Sam', '', 'Not a job (leave, a meeting…)'],
      ['Van 3', '', 'Booked to equipment, not a person'],
      ['Kim', '505', 'Hidden in AroFlo, job not finished — a follow-up, not a job'],
    ]);
    assert.deepEqual([read.check.schedules.received, read.check.schedules.runningIntoTheDay, read.check.schedules.hidden, read.check.hidden], [5, 1, 2, { onFinishedJobs: 1, followUps: 1 }]);
    assert.deepEqual(read.notes, []);
  } finally {
    await stand.close();
  }
});

test('if AroFlo won’t filter bookings by their end date, the day is still read — from the bookings that start on it', async () => {
  const stand = await standIn((zone, request) => {
    if (zone === 'Schedules' && asksRunning(request)) return { status: '0', statusmessage: 'WHERE field(s) enddate are not available in the Schedules zone, default filter applied', zoneresponse: { schedules: [] } };
    if (zone === 'Schedules') return [booking('s1', 'Sam', 501)];
    return zone === 'Tasks' && asksById(request) ? jobsById([rawTask({ job: 501 })], request) : [];
  });
  try {
    const read = await readDay(stand.client, { day: iso(0) });
    assert.deepEqual(read.bookings.map((b) => b.worker), ['Sam']);
    assert.equal(read.check.schedules.runningIntoTheDay, 'filter refused');
    assert.equal(read.runningFilter, false);
  } finally {
    await stand.close();
  }
});

test('if AroFlo takes the end-date filter but doesn’t apply it, the page says nothing about it and the question isn’t asked again', async () => {
  // Two full pages of old bookings, none of them running into today — as the TTS account answered.
  const old = Array.from({ length: 200 }, (_, i) => booking(`old${i}`, 'Kim', 900, { on: day(-400), until: day(-400) }));
  const stand = await standIn((zone, request) => {
    if (zone === 'Schedules' && asksRunning(request)) return old;
    if (zone === 'Schedules') return request.page === 1 ? [booking('s1', 'Sam', 501)] : [];
    return zone === 'Tasks' && asksById(request) ? jobsById([rawTask({ job: 501 })], request) : [];
  });
  try {
    const schedules = () => stand.requests.filter((r) => r.zone === 'Schedules').map(kindOf);
    let read = await readDay(stand.client, { day: iso(0), runningFilter: null });
    assert.deepEqual(read.bookings.map((b) => b.worker), ['Sam']);
    assert.equal(read.runningFilter, false);
    assert.deepEqual(read.notes, []);
    assert.deepEqual(read.check.schedules.runningFilter, { received: 400, runningIntoTheDay: 0, applied: false, starts: [day(-400), day(-400)], ends: [day(-400), day(-400)] });
    assert.deepEqual(schedules(), ['Schedules', 'Schedules running in', 'Schedules running in']);

    stand.requests.length = 0;
    read = await readDay(stand.client, { day: iso(0), runningFilter: false });
    assert.deepEqual(schedules(), ['Schedules']);
    assert.match(read.check.schedules.runningIntoTheDay, /not asked/);
  } finally {
    await stand.close();
  }
});

test('the job’s own business unit decides whose a booking is, not the unit the booking names', async () => {
  const stand = await aroflo({
    starting: [
      booking('s1', 'Sam', 601, { businessUnit: 'ttsBuilt' }), // our job, booked under another unit
      booking('s2', 'Kim', 602, { businessUnit: 'ttsRMS' }), // another unit's job, booked under ours
      booking('s3', 'Lee', 603, { businessUnit: 'ttsBuilt' }), // job can't be read: the booking's unit is all there is
      booking('s4', 'Pat', 604), // job can't be read, booking names none: kept, and said
    ],
    pool: [rawTask({ job: 601, businessUnit: 'ttsRMS' }), rawTask({ job: 602, businessUnit: 'ttsBuilt' })],
  });
  try {
    const read = await readDay(stand.client, { day: iso(0), wanted: ['TTS RMS'] });
    assert.deepEqual(read.bookings.map((b) => b.worker), ['Sam', 'Pat']);
    // Other units' work is simply not there — not listed, not explained on the page; the log has the counts.
    assert.deepEqual(read.notCounted, []);
    assert.doesNotMatch(read.notes.join(' '), /business unit/i);
    assert.deepEqual([read.check.bookingUnitDiffersFromJob, read.check.otherUnitsBookings, read.check.bookingsWhoseUnitIsUnknown], [2, 2, 1]);
    assert.match(read.notes.join(' '), /of 1 booked job did not come back from AroFlo, so only the name is shown/);
  } finally {
    await stand.close();
  }
});

test('done: completed that day, completed on an earlier day, or Ready for Invoicing — and not a job finished later', async () => {
  const pool = [
    rawTask({ job: 701, status: 'Not Started', substatus: 'Ready for Invoicing' }), // with the office to invoice
    rawTask({ job: 702, status: 'Completed', completed: day(-2) }), // finished two days ago, still on the calendar
    rawTask({ job: 703, status: 'Completed', completed: day(0) }), // finished today
    rawTask({ job: 704, status: 'Pending', substatus: 'Materials Ordered' }), // not done
    rawTask({ job: 705, status: 'In Progress', completed: day(0) }), // finished today, then reopened
  ];
  const stand = await aroflo({ starting: pool.map((t, i) => booking(`s${i}`, 'Ben', Number(t.jobnumber))).slice(0, 4), pool });
  try {
    const read = await readDay(stand.client, { day: iso(0) });
    assert.deepEqual(
      Object.fromEntries(Object.entries(read.completed).map(([id, done]) => [id.replace(/internal-|==/g, ''), done.how])),
      { 701: 'invoicing', 702: 'earlier', 703: 'completed' },
    );
    assert.equal(read.completed[taskId(703)].at, `${day(0)} 15:00:00`);
    assert.deepEqual(read.check.jobs.done, { invoicing: 1, earlier: 1, completed: 1, 'not done': 1 });
    assert.deepEqual([read.jobs[taskId(701)].status, read.jobs[taskId(701)].substatus], ['Not Started', 'Ready for Invoicing']);
  } finally {
    await stand.close();
  }
  // Day by day, from the job as it stands now.
  const t = (fields) => task({ job: 1, ...fields });
  const today = day(0);
  const yesterday = day(-1);
  assert.equal(doneOn(t({ status: 'Completed', completed: today }), yesterday, false), null); // finished the day after: not done that day
  assert.equal(doneOn(t({ status: 'Archived', completed: yesterday }), today, true).how, 'earlier');
  assert.equal(doneOn(t({ status: 'Pending', substatus: 'Ready for Invoicing' }), today, true).how, 'invoicing');
  // A substatus has no date: on a day gone by it can't be said when it was set.
  assert.equal(doneOn(t({ status: 'Pending', substatus: 'Ready for Invoicing' }), yesterday, false), null);
  assert.equal(doneOn(t({ status: 'In Progress', completed: today }), today, true), null);
});

test('whose a job is comes from the calendar: scheduled that day, and not done yet from that day back — each a job of whoever it was last scheduled to', async () => {
  const rms = (job, fields = {}) => rawTask({ job, businessUnit: 'TTS RMS', ...fields });
  const doneToday = { status: 'Completed', completed: day(0) };
  const pool = [
    rms(801, doneToday),
    rms(806),
    rms(808, { status: 'Pending' }),
    rms(813, doneToday),
    rms(802, doneToday),
    rms(809),
    rms(810, doneToday),
    rms(811),
    rms(812, { status: 'Completed', completed: day(-1) }),
    rms(814, doneToday),
    rms(815, { status: 'Pending' }),
  ];
  const job = (n) => pool.find((t) => t.jobnumber === String(n) || t.jobnumber === n);
  const stand = await aroflo({
    starting: [
      // Today.
      booking('t1', 'Ben', 801, { start: '07:00:00', end: '09:00:00' }),
      booking('t2', 'Ben', 806, { start: '09:00:00', end: '11:00:00' }),
      booking('t3', 'Ben', 808, { start: '11:00:00', end: '11:30:00', hidden: true }), // hidden, job open: a follow-up, not a job
      booking('t4', 'Ben', 813, { start: '13:00:00', end: '15:00:00', hidden: true }), // hidden because it's finished: real work, done
      // Yesterday.
      booking('y1', 'Ben', 802, { on: day(-1) }), // finished today
      booking('y2', 'Ben', 809, { on: day(-1) }), // still not done
      booking('y3', 'Ben', 810, { on: day(-1) }), // two people, finished today
      booking('y4', 'Lou', 810, { on: day(-1) }),
      booking('y5', 'Blake', 811, { on: day(-1) }), // Ben's the day before, Blake's since: Blake's
      booking('y6', 'Lou', 814, { on: day(-1), hidden: true }), // hidden because it's finished (today): Lou's, finished from an earlier day
      // The day before.
      booking('b1', 'Ben', 811, { on: day(-2) }),
      booking('b2', 'Ben', 812, { on: day(-2) }), // finished yesterday: done, not listed
      booking('b3', 'Ben', 815, { on: day(-2), hidden: true }), // hidden, job open: a follow-up, not on Ben's list
    ],
    pool,
    // AroFlo's "completed since today": 803 was on nobody's calendar; 805 is another unit's.
    finished: [job(801), job(802), job(810), job(813), job(814), rms(803, doneToday), rawTask({ job: 805, ...doneToday, businessUnit: 'ttsBuilt' })],
  });
  try {
    const cache = { ...cacheOf(), allowanceIsLow: () => false };
    const workload = createWorkload({ client: stand.client, cache, db: new DatabaseSync(':memory:'), settings: settingsMap(), logger: quiet });
    await workload.update(iso(0));
    // The day, then the three days before it (WORKLOAD_BACKLOG_DAYS=3 in the tests), then the jobs on those not
    // already read. (Five to a page in the tests: a full page is followed by a look at the next.)
    // (815's only booking is hidden: whether it counts depends only on whether it was finished today, which the day's
    // list of completed jobs says — so it isn't looked up.)
    assert.deepEqual(stand.requests.map(kindOf), ['Schedules', 'Schedules running in', 'Tasks by id x4', 'Tasks', 'Tasks', 'Schedules', 'Schedules', 'Schedules', 'Schedules', 'Tasks by id x3']);
    const { data, meta } = workload.view(iso(0));
    assert.equal(meta.requests, 10);

    // Scheduled today: Ben's three jobs — two done, one of them hidden since it was finished. The follow-up is listed apart.
    assert.deepEqual(data.jobs.map((j) => [j.worker, j.jobNumber, j.state]), [['Ben', '801', 'completed'], ['Ben', '806', 'ongoing'], ['Ben', '813', 'completed']]);
    assert.deepEqual(data.notCounted.map((j) => [j.worker, j.jobNumber, j.reason]), [['Ben', '808', 'Hidden in AroFlo, job not finished — a follow-up, not a job']]);

    // Not done yet, from today back, longest waiting first — and the ones carried over that were finished today, for each person on them.
    assert.deepEqual(data.backlog.jobs.map((j) => [j.worker, j.jobNumber, j.state, j.onDay, j.firstScheduled, j.daysWaiting]), [
      ['Ben', '809', 'open', false, iso(-1), 1],
      ['Ben', '806', 'open', true, iso(0), 0],
      ['Ben', '802', 'finished', false, iso(-1), 1],
      ['Ben', '810', 'finished', false, iso(-1), 1],
      ['Blake', '811', 'open', false, iso(-1), 1],
      ['Lou', '810', 'finished', false, iso(-1), 1],
      ['Lou', '814', 'finished', false, iso(-1), 1],
    ]);
    assert.deepEqual(data.workers, [
      row('Ben', { booked: 3, done: 2, open: 1, hours: 6, notDone: 2, notDoneOnDay: 1, notDoneEarlier: 1, finishedFromEarlier: 2, oldest: iso(-1), finishedInAll: 4 }),
      row('Blake', { notDone: 1, notDoneEarlier: 1, oldest: iso(-1) }),
      row('Lou', { finishedFromEarlier: 2, finishedInAll: 2 }),
    ]);
    // Finished today and on nobody's calendar in all that time: listed apart.
    assert.deepEqual(data.notBooked.map((j) => j.jobNumber), ['803']);
    assert.deepEqual([data.backlog.from, data.backlog.days, data.backlog.calendarsKept], [iso(-3), 3, 3]);

    // Pressed again: earlier days' calendars were read on a later day, so they are kept; only the open jobs from them are read again.
    stand.requests.length = 0;
    await workload.update(iso(0));
    assert.deepEqual(stand.requests.map(kindOf), ['Schedules', 'Schedules running in', 'Tasks by id x4', 'Tasks', 'Tasks', 'Tasks by id x2']);
    assert.deepEqual(
      stand.requests.filter(asksById).slice(-1)[0].where.map((w) => jobNo(w.split('|')[3])),
      ['811', '809'],
    );
  } finally {
    await stand.close();
  }
});

test('an earlier day’s calendar is read once, on a later day; one read on the day itself is read again; and reading stops when told to', async () => {
  const stand = await aroflo({ starting: [booking('a', 'Sam', 901, { on: day(-2) }), booking('b', 'Sam', 902, { on: day(-1) })], pool: [rawTask({ job: 901 }), rawTask({ job: 902 })] });
  try {
    const store = memoryStore();
    const known = { get: (id) => store.getJobs([id]).get(id) };
    const schedules = () => stand.requests.filter((r) => r.zone === 'Schedules').map(askedDay);
    // Yesterday's calendar was read yesterday: it may have changed since.
    store.saveSchedule(iso(-1), [], iso(-1));
    let earlier = await readEarlierDays(stand.client, { day: iso(0), today: iso(0), days: 2, schedules: store, knownJobs: known });
    assert.deepEqual(schedules(), [day(-2), day(-1)]);
    assert.deepEqual(Object.values(earlier.learnt).map((j) => j.jobNumber).sort(), ['901', '902']);
    assert.deepEqual(store.schedules(iso(-2), iso(-1)).map((c) => [c.day, c.bookings.length, c.readOn]), [[iso(-2), 1, iso(0)], [iso(-1), 1, iso(0)]]);

    stand.requests.length = 0;
    earlier = await readEarlierDays(stand.client, { day: iso(0), today: iso(0), days: 2, schedules: store, knownJobs: known, stop: () => true });
    assert.deepEqual(stand.requests, []);
    assert.match(earlier.notes.join(' '), /2 jobs from earlier days could not be checked this time/);

    // Once a job is known to be finished, it isn't read again.
    store.saveJobs({ [taskId(901)]: { jobNumber: '901', taskName: 'Job 901', status: 'Completed', completedDate: day(-1) } });
    earlier = await readEarlierDays(stand.client, { day: iso(0), today: iso(0), days: 2, schedules: store, knownJobs: known });
    assert.deepEqual(stand.requests.filter(asksById).map((r) => r.where.map((w) => jobNo(w.split('|')[3]))), [['902']]);
    assert.deepEqual(earlier.check, { days: 2, daysRead: 0, daysKept: 2, jobsOnThem: 2, jobsRead: 1, jobsToRead: 1 });

    // Nor is one known to be another business unit's: it is never shown, so its status doesn't matter.
    store.saveJobs({ [taskId(902)]: { jobNumber: '902', taskName: 'Job 902', status: 'Pending', businessUnit: 'ttsBuilt' } });
    stand.requests.length = 0;
    earlier = await readEarlierDays(stand.client, { day: iso(0), today: iso(0), days: 2, schedules: store, knownJobs: known, wanted: ['TTS RMS'] });
    assert.deepEqual(stand.requests, []);
  } finally {
    await stand.close();
  }
});

test('several jobs are read to a request, and every booked job is read again on every update', async () => {
  const bookings = [booking('s1', 'Sam', 601, { businessUnit: 'ttsRMS' }), booking('s2', 'Sam', 602, { businessUnit: 'ttsRMS' }), booking('s3', 'Alex', 603, { businessUnit: 'ttsRMS' })];
  const pool = [601, 602, 603, 604].map((job) => rawTask({ job, client: job === 603 ? 'South Australian Housing Trust' : 'Ventia', priority: 'id-p2', businessUnit: 'ttsRMS' }));
  const stand = await aroflo({ starting: bookings, pool, priorities: [{ priorityid: 'id-p2', shortdescription: 'P2', description: 'Priority Level 2' }] });
  try {
    // Nobody has pressed Refresh: no work orders loaded, not even the priority names.
    const cache = { ...cacheOf({ priorities: [] }), allowanceIsLow: () => false };
    const settings = settingsMap();
    const workload = createWorkload({ client: stand.client, cache, db: new DatabaseSync(':memory:'), settings, logger: quiet });
    const kinds = () => stand.requests.splice(0).map(kindOf);

    await workload.update(iso(0));
    // The day, then the three days before it (nothing on them here).
    assert.deepEqual(kinds(), ['Priorities', 'Schedules', 'Schedules running in', 'Tasks by id x3', 'Tasks', 'Schedules', 'Schedules', 'Schedules']);
    let page = workload.view(iso(0));
    assert.deepEqual(page.data.jobs.map((j) => [j.worker, j.jobNumber, j.client, j.site, j.priority]), [
      ['Alex', '603', 'South Australian Housing Trust', 'Site A', 'P2'],
      ['Sam', '601', 'Ventia', 'Site A', 'P2'],
      ['Sam', '602', 'Ventia', 'Site A', 'P2'],
    ]);
    assert.deepEqual([page.meta.requests, page.meta.notes], [8, []]);
    assert.equal(settings.values.get('workload_several_ids'), true);

    // Sam finishes 601 and the update sees it: every booked job is read again.
    pool[0].status = 'Completed';
    pool[0].completeddate = day(0);
    pool[0].completeddatetime = `${day(0)} 10:15:00`;
    bookings.push(booking('s4', 'Alex', 604, { businessUnit: 'ttsRMS' }));
    await workload.update(iso(0));
    assert.deepEqual(kinds(), ['Schedules', 'Schedules running in', 'Tasks by id x4', 'Tasks']);
    page = workload.view(iso(0));
    assert.deepEqual(page.data.jobs.map((j) => [j.jobNumber, j.state, j.doneHow]), [['603', 'ongoing', ''], ['604', 'ongoing', ''], ['601', 'completed', 'completed'], ['602', 'ongoing', '']]);
    assert.equal(workload.store.getJobs([taskId(604), 'never-seen']).get(taskId(604)).jobNumber, '604');
    assert.equal(workload.store.getJobs(['never-seen']).size, 0);
  } finally {
    await stand.close();
  }
});

test('if AroFlo won’t take several ids at once, jobs are read one at a time, so many per update, and the page says what is waiting', async () => {
  const jobs = Array.from({ length: 17 }, (_, i) => 700 + i);
  const pool = jobs.map((job) => rawTask({ job, businessUnit: 'ttsRMS' }));
  const stand = await standIn((zone, request) => {
    if (zone === 'Schedules') return !asksRunning(request) && request.page === 1 ? jobs.map((job, i) => booking(`s${i}`, `Worker ${i % 3}`, job, { businessUnit: 'ttsRMS' })) : [];
    if (zone !== 'Tasks' || !asksById(request)) return [];
    // Only the first id is honoured; the "or …" ones are ignored.
    return jobsById(pool, { where: request.where.slice(0, 1) });
  });
  try {
    let read = await readDay(stand.client, { day: iso(0) });
    const byId = stand.requests.filter(asksById).map((r) => r.where.length);
    assert.deepEqual([byId[0], byId.length - 1], [17, 15]); // one try at all of them, then fifteen singly
    assert.equal(read.severalIds, false);
    assert.equal(Object.values(read.jobs).filter((j) => j.jobNumber).length, 16);
    assert.match(read.notes.join(' '), /of 1 booked job are still to be read — AroFlo gives them one at a time\. Press Update now again/);

    // Next update: what was read is on record, so the one left over shows with its details even if not re-read.
    const known = new Map(Object.entries(read.learnt).filter(([, j]) => j.jobNumber));
    stand.requests.length = 0;
    read = await readDay(stand.client, { day: iso(0), knownJobs: known, severalIds: false });
    assert.equal(stand.requests.filter(asksById).length, 15);
    assert.deepEqual([Object.values(read.jobs).filter((j) => j.jobNumber).length, read.notes], [17, []]);
  } finally {
    await stand.close();
  }
});

test('a request for some jobs that fails doesn’t stop the rest being read', async () => {
  // Thirty jobs: two requests of them. The first fails, as one did on the TTS account (2026-10-15).
  const jobs = Array.from({ length: 30 }, (_, i) => 900 + i);
  const pool = jobs.map((job) => rawTask({ job, businessUnit: 'TTS RMS', ...(job === 929 ? { status: 'Completed', completed: day(0) } : {}) }));
  let byId = 0;
  const stand = await standIn((zone, request) => {
    if (zone === 'Schedules') return !asksRunning(request) && request.page === 1 ? jobs.map((job, i) => booking(`s${i}`, `Worker ${i % 3}`, job)) : [];
    if (zone !== 'Tasks' || !asksById(request)) return [];
    byId += 1;
    return byId === 1 ? { status: '1', statusmessage: 'timeout of 30000ms exceeded' } : jobsById(pool, request);
  });
  try {
    const read = await readDay(stand.client, { day: iso(0), severalIds: true });
    assert.deepEqual(stand.requests.filter(asksById).map((r) => r.where.length), [25, 5]);
    assert.equal(read.check.jobs.readNow, 5);
    assert.equal(read.check.jobs.lookupError, 'timeout of 30000ms exceeded');
    // The second request's jobs are there, done or not.
    assert.ok(read.completed[taskId(929)]);
    assert.match(read.notes.join(' '), /of 25 booked jobs could not be read from AroFlo \(timeout of 30000ms exceeded\)/);
  } finally {
    await stand.close();
  }
});

test('opening the page on a new day reads that day once, by itself; other days, and a day already read, wait for Update now', async () => {
  const stand = await aroflo({ starting: [booking('s1', 'Sam', 501)], pool: [rawTask({ job: 501, businessUnit: 'TTS RMS' })] });
  try {
    const cache = { ...cacheOf(), allowanceIsLow: () => false };
    const workload = createWorkload({ client: stand.client, cache, db: new DatabaseSync(':memory:'), settings: settingsMap(), logger: quiet });
    assert.equal(workload.loadIfNew(iso(-1)), false); // a day gone by: only on Update now
    assert.equal(workload.loadIfNew(iso(1)), false); // a day still to come: likewise
    assert.equal(stand.requests.length, 0);
    assert.equal(workload.loadIfNew(iso(0)), true);
    assert.equal(workload.view(iso(0)).meta.updating, true); // the page shows it reading straight away
    assert.equal(workload.loadIfNew(iso(0)), false); // already under way
    // Wait for it to finish (it answers the page at once and reads in the background).
    for (let i = 0; i < 100 && workload.view(iso(0)).meta.updating; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(workload.view(iso(0)).data.loaded, true);
    const sent = stand.requests.length;
    assert.equal(workload.loadIfNew(iso(0)), false); // read once: after that, only on Update now
    assert.equal(stand.requests.length, sent);
  } finally {
    await stand.close();
  }
});

test('every so often today is read by itself; a turn is skipped while the daily allowance is low', async () => {
  const stand = await aroflo({ starting: [booking('s1', 'Sam', 501)], pool: [rawTask({ job: 501, businessUnit: 'TTS RMS' })] });
  let low = true;
  const cache = { ...cacheOf(), allowanceIsLow: () => low };
  const workload = createWorkload({ client: stand.client, cache, db: new DatabaseSync(':memory:'), settings: settingsMap(), logger: quiet });
  const settle = async (ms) => new Promise((r) => setTimeout(r, ms));
  try {
    assert.equal(workload.startAutoUpdate(0), false); // 0 = never
    assert.equal(workload.startAutoUpdate(0.001), true); // every 60 ms
    assert.equal(workload.startAutoUpdate(0.001), false); // one timer only
    await settle(200);
    assert.equal(stand.requests.length, 0); // allowance low: skipped, not queued
    low = false;
    for (let i = 0; i < 100 && !workload.view(iso(0)).data.loaded; i++) await settle(20);
    assert.equal(workload.view(iso(0)).data.loaded, true);
    assert.ok(stand.requests.some((r) => r.zone === 'Schedules' && askedDay(r) === day(0))); // today's calendar was read
  } finally {
    workload.stopAutoUpdate();
    for (let i = 0; i < 100 && workload.view(iso(0)).meta.updating; i++) await settle(20);
    await stand.close();
  }
});

test('AroFlo saying "too many requests" part-way through an update stops the asking but keeps what was read', async () => {
  // The calendar reads fine; every request for jobs is turned away, as on the live site on 2026-10-14.
  const stand = await standIn((zone, request) => {
    if (zone === 'Schedules') return !asksRunning(request) && request.page === 1 && askedDay(request) === day(0) ? [booking('s1', 'Sam', 701), booking('s2', 'Alex', 702)] : [];
    if (zone === 'Tasks' && asksById(request)) return { status: '1', statusmessage: 'Exceeded Secondary Daily Rate Limit - Please try again in a little while' };
    return [];
  });
  try {
    const cache = { ...cacheOf(), allowanceIsLow: () => false };
    const workload = createWorkload({ client: stand.client, cache, db: new DatabaseSync(':memory:'), settings: settingsMap(), logger: quiet });
    await workload.update(iso(0));
    const page = workload.view(iso(0));
    assert.equal(page.meta.error, null);
    assert.equal(page.data.loaded, true);
    assert.deepEqual(page.data.jobs.map((j) => j.worker), ['Alex', 'Sam']);
    assert.match(page.meta.notes.join(' '), /Exceeded Secondary Daily Rate Limit/);
    // One request for the jobs (retried by the client), not one per batch after it.
    assert.equal(new Set(stand.requests.filter(asksById).map((r) => r.where.join())).size, 1);
  } finally {
    await stand.close();
  }
});

test('Update now reads AroFlo; a message pushed by AroFlo marks a job done without a single request', async () => {
  const pool = [rawTask({ job: 501, status: 'Completed', completed: day(0), businessUnit: 'TTS RMS' }), rawTask({ job: 502, businessUnit: 'TTS RMS' }), rawTask({ job: 640, businessUnit: 'TTS RMS' })];
  // Yesterday, job 640 was on Kim's calendar.
  const stand = await aroflo({ starting: [booking('s1', 'Sam', 501), booking('s2', 'Alex', 502), booking('k1', 'Kim', 640, { on: day(-1) })], pool, finished: [pool[0]] });
  try {
    const cache = { ...cacheOf(), allowanceIsLow: () => false };
    const settings = settingsMap();
    const workload = createWorkload({ client: stand.client, cache, db: new DatabaseSync(':memory:'), settings, logger: quiet });
    const today = iso(0);

    assert.equal(workload.view(today).data.loaded, false);
    assert.equal(workload.refusal(), null);
    await workload.update(today);
    let page = workload.view(today);
    const counts = () => workload.view(today).data.workers.map((w) => [w.worker, w.booked, w.done, w.open, w.notDone, w.finishedFromEarlier]);
    assert.deepEqual(counts(), [['Alex', 1, 0, 1, 1, 0], ['Kim', 0, 0, 0, 1, 0], ['Sam', 1, 1, 0, 0, 0]]);
    // The day, the three before it, and Kim's job from yesterday.
    assert.deepEqual([page.data.loaded, page.meta.requests, page.meta.error, page.meta.updating], [true, 8, null, false]);
    assert.equal(settings.values.get('workload_completed_filter'), 'datecompleted');
    // Pressed again straight away: made to wait, so a double click isn't twice the requests.
    assert.match(workload.refusal().message, /Please wait \d+s before updating again/);

    const sent = stand.requests.length;
    const push = (kind, ids, extra = {}) => workload.receive(kind, { eventname: kind, timestamputc: new Date().toISOString().slice(0, 19).replace('T', ' ').replace(/-/g, '/'), payload: { api_related_ids: ids, ...extra } });

    // Alex finishes 502.
    push('task-completed', { taskid: taskId(502) }, { currentuser: 'Alex', jobnumber: '502', task: 'Job 502' });
    assert.deepEqual(counts(), [['Alex', 1, 1, 0, 0, 0], ['Kim', 0, 0, 0, 1, 0], ['Sam', 1, 1, 0, 0, 0]]);
    // Kim finishes 640, carried over from yesterday's calendar: one of hers from an earlier day, finished today.
    push('task-completed', { taskid: taskId(640) }, { currentuser: 'Kim' });
    // And a job nothing is known about — it could be any business unit's — which is held back.
    push('task-completed', { taskid: 'somebody-elses' }, { currentuser: 'Pat', jobnumber: '9001', task: 'Elsewhere' });
    page = workload.view(today);
    assert.deepEqual(page.data.backlog.jobs.map((j) => [j.worker, j.jobNumber, j.state]), [['Kim', '640', 'finished']]);
    assert.deepEqual(page.data.workers.find((w) => w.worker === 'Kim'), row('Kim', { finishedFromEarlier: 1, finishedInAll: 1 }));
    assert.deepEqual(page.data.notBooked, []);
    // The calendar moves: the page is told, and nothing is fetched.
    assert.equal(page.meta.calendarChangedAt, null);
    push('schedule-changed', { scheduleid: 's9' });
    assert.ok(workload.view(today).meta.calendarChangedAt);
    // A message of some other kind is taken in and does nothing.
    assert.deepEqual(push('something-else', {}), { applied: null });
    assert.equal(stand.requests.length, sent);
  } finally {
    await stand.close();
  }
});

test('an update keeps what AroFlo pushed, unless AroFlo itself now says the job is open again', async () => {
  const pool = [rawTask({ job: 501 }), rawTask({ job: 502 })];
  const stand = await aroflo({ starting: [booking('s1', 'Sam', 501), booking('s2', 'Alex', 502)], pool });
  try {
    const cache = { ...cacheOf(), allowanceIsLow: () => false };
    const workload = createWorkload({ client: stand.client, cache, db: new DatabaseSync(':memory:'), settings: settingsMap(), logger: quiet });
    const today = iso(0);
    const states = () => Object.fromEntries(workload.view(today).data.jobs.map((j) => [j.worker, j.state]));

    workload.receive('task-completed', { payload: { api_related_ids: { taskid: taskId(501) } } });
    workload.receive('task-completed', { payload: { api_related_ids: { taskid: taskId(502) } } });
    // AroFlo hasn't caught up with 501, and shows 502 finished today and open again.
    Object.assign(pool[1], { status: 'In Progress', completeddate: day(0), completeddatetime: `${day(0)} 11:00:00` });
    await workload.update(today);
    assert.deepEqual(states(), { Alex: 'ongoing', Sam: 'completed' });
  } finally {
    await stand.close();
  }
});

test('updating stops short of the daily allowance, and a failed update says why', async () => {
  const stand = await standIn(() => ({ status: '-99999', statusmessage: 'Authentication Failed' }));
  try {
    const low = createWorkload({ client: { ...stand.client, dailyAllowance: { remaining: 150, limit: 2000 } }, cache: { ...cacheOf(), allowanceIsLow: () => true }, db: new DatabaseSync(':memory:'), settings: settingsMap(), logger: quiet });
    assert.match(low.refusal().message, /daily request allowance is nearly used up \(150 of 2000 left\)/);

    const workload = createWorkload({ client: stand.client, cache: { ...cacheOf(), allowanceIsLow: () => false }, db: new DatabaseSync(':memory:'), settings: settingsMap(), logger: quiet });
    await workload.update(iso(0));
    const page = workload.view(iso(0));
    assert.deepEqual([page.data.loaded, page.meta.updating], [false, false]);
    assert.match(page.meta.error, /Authentication Failed/);
  } finally {
    await stand.close();
  }
});

test('an event message’s time is UTC; its secret is compared whole', () => {
  assert.equal(instantOf('2026/10/14 04:05:06').toISOString(), '2026-10-14T04:05:06.000Z');
  assert.ok(Math.abs(instantOf('not a time').getTime() - Date.now()) < 5000);
  assert.equal(sameSecret('s3cret-value', 's3cret-value'), true);
  for (const wrong of ['s3cret-valuE', 's3cret', '', undefined, ['s3cret-value']]) assert.equal(sameSecret(wrong, 's3cret-value'), false);
  assert.equal(sameSecret('', ''), false);
});
