// Do the report numbers come out right? Each test builds a handful of work
// orders or invoices whose answer can be worked out by hand, and checks the
// report says the same. Run with `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { day, task, invoice, payment, cacheOf, now } = require('./helpers');
const kpi = require('../src/kpi');
const { zonedNow, dayOf } = require('../src/time');
const { codeFromName, levelFromName } = require('../src/priorities');
const { buildReportingKpis, buildOverdueAgeing, buildInvoicingReport, buildKpiMatrixTasks } = require('../src/views');

test('priority names are read for the level they state, and nothing more', () => {
  // [the level the name states, the level it is reported under]
  const expected = {
    P1: ['P1', 'P1'],
    AP1: ['P1', 'P1'],
    AP4: ['P4', 'P4'],
    AP5: ['P5', 'P4'], // level 5 is reported as part of P4
    'AP5 - Attend within 30 calendar days': ['P5', 'P4'],
    'P4 - 30 days': ['P4', 'P4'],
    'Priority Level 2 - Attend within 3 calendar days': ['P2', 'P2'],
    PM: ['PM', 'PM'],
    'PM - Preventative Maintenance': ['PM', 'PM'],
    Emergency: ['P1', 'P1'], // from the configured map
    SM: [null, null], // not a name that states a level — it is not guessed at
    PHONECALL: [null, null],
    'SLA Urgent 1hour': [null, null],
    1: [null, null],
    P10: [null, null],
    SMS: [null, null],
  };
  for (const [name, [level, reported]] of Object.entries(expected)) {
    assert.equal(levelFromName(name), level, `${name}: level`);
    assert.equal(codeFromName(name), reported, `${name}: reported as`);
  }
});

test('AP5 is counted with P4, and its group is headed P4/P5 only when it holds AP5 jobs', () => {
  const range = { dateFrom: day(-30), dateTo: day(0), view: 'overall' };
  const withAp5 = [task({ priority: 'id-p4', due: day(5) }), task({ priority: 'id-ap5', client: 'South Australian Housing Trust', due: day(-2) })];
  let result = buildReportingKpis(cacheOf({ jobs: withAp5 }), range);
  const p4 = result.priorityCompliance.find((r) => r.priority === 'P4');
  // The P4 job is not due yet (in progress); the AP5 one is open past its due date (late).
  assert.deepEqual([p4.total, p4.onTime, p4.late, p4.inProgress, p4.actualPercent, p4.targetPercent], [2, 0, 1, 1, 0, 90]);
  assert.deepEqual(result.breakdown.map((r) => [r.priority, r.priorityName]).sort(), [['P4', 'AP5'], ['P4', 'P4']]);
  assert.deepEqual(result.pmBreakdown, []);
  assert.deepEqual(result.meta.levelLabels, { P4: 'P4/P5' });
  assert.deepEqual(buildOverdueAgeing(cacheOf({ jobs: withAp5 }), { view: 'overall' }).meta.levelLabels, { P4: 'P4/P5' });
  // No AP5 job in the selection: plain P4.
  result = buildReportingKpis(cacheOf({ jobs: withAp5 }), { ...range, view: 'Ventia' });
  assert.deepEqual(result.meta.levelLabels, {});
});

test('a work order is overdue when it is open past its due date, or was finished after it', () => {
  const cases = [
    ['finished the day before it was due', task({ status: 'Completed', due: day(-5), completed: day(-6) }), false],
    ['finished on the due date', task({ status: 'Archived', due: day(-5), completed: day(-5) }), false],
    ['finished two days late', task({ status: 'Completed', due: day(-10), completed: day(-8) }), true],
    ['open, due yesterday', task({ due: day(-1) }), true],
    ['open, due today', task({ due: day(0) }), false],
    ['open, due next week', task({ due: day(7) }), false],
    ['open, no due date', task({}), false],
  ];
  for (const [what, t, overdue] of cases) assert.equal(kpi.isOverdue(t, now()), overdue, what);
});

test('days late', () => {
  assert.equal(kpi.computeDaysLate(task({ status: 'Completed', due: day(-10), completed: day(-8) }), now()), 2);
  assert.equal(kpi.computeDaysLate(task({ status: 'Completed', due: day(-5), completed: day(-6) }), now()), 0);
  assert.equal(kpi.computeDaysLate(task({ due: day(-4) }), now()), 4);
  assert.equal(kpi.computeDaysLate(task({ due: day(3) }), now()), 0);
  assert.equal(kpi.computeDaysLate(task({}), now()), null);
});

test('"today" is the day in Adelaide, whatever the clock of the machine says', () => {
  // The same instant, read on Adelaide's wall clock. Summer time (UTC+10:30)
  // starts on the first Sunday of October and ends on the first of April.
  const read = (iso) => {
    const d = zonedNow(new Date(iso), 'Australia/Adelaide');
    return `${dayOf(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  assert.equal(read('2026-10-12T22:00:00Z'), '2026-10-13 08:30'); // already the 13th, still the 12th in UTC
  assert.equal(read('2026-10-13T13:29:00Z'), '2026-10-13 23:59');
  assert.equal(read('2026-10-13T13:30:00Z'), '2026-10-14 00:00'); // midnight in Adelaide
  assert.equal(read('2026-07-01T14:29:00Z'), '2026-07-01 23:59'); // winter: UTC+9:30
  assert.equal(read('2026-07-01T14:30:00Z'), '2026-07-02 00:00');
  assert.equal(read('2026-10-31T13:30:00Z'), '2026-11-01 00:00'); // the month turns over on Adelaide's clock
  // And the reports say which day they took.
  const { meta } = buildOverdueAgeing(cacheOf({ jobs: [] }), { view: 'overall' });
  assert.equal(meta.today, day(0).replace(/\//g, '-'));
});

// Every test in this file again, on a machine whose own clock is somewhere
// else — a server in the cloud is usually on UTC, and Honolulu is the far
// side of midnight from Adelaide for most of the day. If any report took
// "today" from the machine, something above would fail there.
for (const zone of ['UTC', 'Pacific/Honolulu', 'Europe/London']) {
  test(`the reports come out the same on a machine set to ${zone}`, { skip: Boolean(process.env.REPORTS_TZ_RERUN) }, () => {
    execFileSync(process.execPath, ['--test', __filename], {
      env: { ...process.env, TZ: zone, REPORTS_TZ_RERUN: '1' },
      stdio: 'pipe',
    });
  });
}

test('General Statistics', () => {
  const jobs = [
    task({ status: 'Completed', due: day(-5), completed: day(-6) }),
    task({ status: 'Completed', due: day(-10), completed: day(-8) }), // late
    task({ status: 'Archived', due: day(-5), completed: day(-5) }),
    task({ status: 'Completed', due: day(-2), completed: day(-2) }),
    task({ due: day(-1) }), // open and overdue
    task({ due: day(0) }),
    task({ status: 'Not Started', due: day(9) }),
    task({ status: 'Pending' }),
  ];
  const { summary } = buildReportingKpis(cacheOf({ jobs }), { dateFrom: day(-30), dateTo: day(0), view: 'overall' });
  assert.deepEqual(
    { issued: summary.issued, completed: summary.completed, outstanding: summary.outstanding, overdue: summary.overdue },
    { issued: 8, completed: 4, outstanding: 4, overdue: 2 },
  );
  assert.equal(summary.completionRate, 50);
  // The overdue rate is given both ways: of completed (as in the earlier
  // dashboard), and of issued.
  assert.equal(summary.overdueRate, 50);
  assert.equal(summary.overdueRateOfIssued, 25);
  // Nothing issued: no rate to give, not a division by nothing.
  const none = buildReportingKpis(cacheOf({ jobs }), { dateFrom: day(-400), dateTo: day(-300), view: 'overall' }).summary;
  assert.deepEqual([none.issued, none.overdueRate, none.overdueRateOfIssued], [0, 0, 0]);
});

test('"open in system" counts every unfinished work order for the clients, whatever the date range', () => {
  const jobs = [
    task({ client: 'Ventia', requested: day(-50) }), // open, requested before the range
    task({ client: 'Ventia', requested: day(-3) }), // open, in the range
    task({ client: 'Ventia', requested: day(-3), status: 'Completed', completed: day(-1) }),
    task({ client: 'Other Co', requested: day(-50) }), // open, another client
  ];
  const summaryFor = (view) => buildReportingKpis(cacheOf({ jobs }), { dateFrom: day(-7), dateTo: day(0), view }).summary;
  assert.deepEqual([summaryFor('Ventia').outstanding, summaryFor('Ventia').openInSystem], [1, 2]);
  assert.deepEqual([summaryFor('overall').outstanding, summaryFor('overall').openInSystem], [1, 3]);
});

test('the date range is by requested date and includes both end days', () => {
  const jobs = [-11, -10, -5, -3, -2].map((offset) => task({ requested: day(offset) }));
  const issued = (from, to) => buildReportingKpis(cacheOf({ jobs }), { dateFrom: day(from), dateTo: day(to), view: 'overall' }).summary.issued;
  assert.equal(issued(-10, -3), 3);
  assert.equal(issued(-30, 0), 5);
  assert.equal(issued(-4, -4), 0);
  // The date pickers send YYYY-MM-DD.
  const iso = (offset) => day(offset).replace(/\//g, '-');
  assert.equal(buildReportingKpis(cacheOf({ jobs }), { dateFrom: iso(-10), dateTo: iso(-3), view: 'overall' }).summary.issued, 3);
});

test('the client filter: Ventia, SAHA, every other company together, any mix, or everyone', () => {
  const jobs = [
    task({ client: 'Ventia' }),
    task({ client: 'Ventia' }),
    task({ client: 'South Australian Housing Trust' }),
    task({ client: 'Other Co' }),
    task({ client: 'Another Builder' }),
    task({ client: '' }), // no client on the job: not a contract client's, so with the others
  ];
  const issued = (view) => buildReportingKpis(cacheOf({ jobs }), { dateFrom: day(-30), dateTo: day(0), view }).summary.issued;
  assert.equal(issued('overall'), 6);
  assert.equal(issued('Ventia'), 2);
  assert.equal(issued('South Australian Housing Trust'), 1);
  assert.equal(issued('South Australian Housing Trust||Ventia'), 3); // the default
  assert.equal(issued('others'), 3);
  assert.equal(issued('Ventia||others'), 5);
  assert.equal(issued('South Australian Housing Trust||Ventia||others'), 6);
  assert.equal(issued('Nobody'), 0);
  // The overdue list takes the same filter.
  const overdue = jobs.map((t) => ({ ...t, dueDate: day(-3), requiredCompletedDate: day(-3) }));
  const count = (view) => buildOverdueAgeing(cacheOf({ jobs: overdue }), { view }).data.total;
  assert.deepEqual([count('overall'), count('Ventia'), count('others')], [6, 2, 3]);
});

test('Target KPI Compliance: on time out of on time and late, in progress counted apart, AP counted with P', () => {
  const jobs = [
    task({ priority: 'id-p1', due: day(5) }), // open, not due yet: in progress
    task({ priority: 'id-ap1', client: 'South Australian Housing Trust', due: day(-2) }), // overdue
    task({ priority: 'id-p1', status: 'Completed', due: day(-3), completed: day(-3) }),
    task({ priority: 'id-ap1', client: 'South Australian Housing Trust', status: 'Completed', due: day(-3), completed: day(-4) }),
    task({ priority: 'id-pm', due: day(-1) }), // overdue
    task({ priority: 'id-pm', due: day(10) }),
    task({ priority: 'id-ap5', due: day(-1) }), // level 5: counted with P4
    task({ priority: 'id-p4', due: day(8) }),
    task({ priority: 'id-sm', due: day(-1) }), // not on the scale
    task({ priority: 'id-phone', due: day(-1) }), // not on the scale
    task({ priority: '', due: day(-1) }), // no priority
  ];
  const result = buildReportingKpis(cacheOf({ jobs }), { dateFrom: day(-30), dateTo: day(0), view: 'overall' });
  const rows = Object.fromEntries(result.priorityCompliance.map((r) => [r.priority, r]));
  assert.deepEqual(Object.keys(rows).sort(), ['P1', 'P4', 'PM']);
  const figures = (r) => [r.total, r.onTime, r.late, r.inProgress, r.targetPercent, r.status];
  // P1: two finished on time, one open past due, one not due yet — 2 of the 3 decided.
  assert.deepEqual(figures(rows.P1), [4, 2, 1, 1, 98, 'Below Target']);
  assert.equal(Math.round(rows.P1.actualPercent * 10) / 10, 66.7);
  assert.equal(Math.round(rows.P1.variancePp * 10) / 10, -31.3);
  assert.deepEqual([...figures(rows.P4), rows.P4.actualPercent], [2, 0, 1, 1, 90, 'Below Target', 0]);
  assert.deepEqual([...figures(rows.PM), rows.PM.actualPercent], [2, 0, 1, 1, 90, 'Below Target', 0]);
  // On time, late and in progress always add up to the level's work orders.
  for (const r of result.priorityCompliance) assert.equal(r.onTime + r.late + r.inProgress, r.total, r.priority);
  // Everything still counts in General Statistics, on the scale or not.
  assert.equal(result.summary.issued, 11);
  assert.equal(result.summary.overdue, 6);
  // AP5 is in the P4 table; PM has its own; the off-scale ones are in neither.
  assert.deepEqual(result.breakdown.map((r) => r.priority).sort(), ['P1', 'P1', 'P1', 'P1', 'P4', 'P4']);
  assert.deepEqual(result.pmBreakdown.map((r) => r.priority).sort(), ['PM', 'PM']);
});

test('Target KPI Compliance: a level with nothing finished or overdue has no percentage yet', () => {
  const range = { dateFrom: day(-30), dateTo: day(0), view: 'overall' };
  const open = [task({ priority: 'id-p2', due: day(3) }), task({ priority: 'id-p2', due: day(9) })];
  let [p2] = buildReportingKpis(cacheOf({ jobs: open }), range).priorityCompliance;
  assert.deepEqual(
    [p2.priority, p2.total, p2.onTime, p2.late, p2.inProgress, p2.actualPercent, p2.variancePp, p2.status],
    ['P2', 2, 0, 0, 2, null, null, 'In progress'],
  );
  // One of them finished on time: 1 of 1 decided, and the other still in progress.
  const one = [task({ priority: 'id-p2', status: 'Completed', due: day(-1), completed: day(-1) }), task({ priority: 'id-p2', due: day(9) })];
  [p2] = buildReportingKpis(cacheOf({ jobs: one }), range).priorityCompliance;
  assert.deepEqual([p2.onTime, p2.late, p2.inProgress, p2.actualPercent, p2.status], [1, 0, 1, 100, 'Met']);
  // Finished after its due date: late, the same as open past it.
  const lateDone = [task({ priority: 'id-p2', status: 'Completed', due: day(-4), completed: day(-2) }), task({ priority: 'id-p2', status: 'Completed', due: day(-1), completed: day(-1) })];
  [p2] = buildReportingKpis(cacheOf({ jobs: lateDone }), range).priorityCompliance;
  assert.deepEqual([p2.onTime, p2.late, p2.inProgress, p2.actualPercent], [1, 1, 0, 50]);
});

test('the breakdown tables show the job number as the Task ID', () => {
  const jobs = [task({ priority: 'id-p2', job: 16762, due: day(-3) })];
  const [row] = buildReportingKpis(cacheOf({ jobs }), { dateFrom: day(-30), dateTo: day(0), view: 'overall' }).breakdown;
  assert.equal(row.taskId, '16762');
  assert.equal(row.daysLate, 3);
});

test('Delay Reason: a late job’s current substatus, or else what its notes say', () => {
  const late = { priority: 'id-p2', due: day(-3) };
  const cases = [
    ['held for access', { ...late, substatus: 'Non Access' }, 'Non Access'],
    ['held for materials', { ...late, substatus: 'Materials Ordered' }, 'Materials Ordered'],
    ['shown as AroFlo writes it', { ...late, substatus: 'NON-ACCESS' }, 'NON-ACCESS'],
    ['past due and with procurement', { ...late, substatus: 'Sent to Procurement' }, 'Sent to Procurement'],
    ['with procurement, but not past due', { priority: 'id-p2', due: day(6), substatus: 'Sent to Procurement' }, '-'],
    ['with procurement, finished on time', { priority: 'id-p2', status: 'Completed', due: day(-2), completed: day(-3), substatus: 'Sent to Procurement' }, '-'],
    ['finished late, still marked on hold', { priority: 'id-p2', status: 'Completed', due: day(-9), completed: day(-6), substatus: 'On Hold/Materials Required' }, 'On Hold/Materials Required'],
    ['another substatus, a note about access', { ...late, substatus: 'Scheduled', notes: ['Attended site.', 'Tenant not home — <b>no access</b>, card left'] }, 'Non Access (from notes)'],
    ['a note about an order', { ...late, notes: ['Hot water unit ordered, ETA Friday'] }, 'Materials Ordered (from notes)'],
    ['a note about parts', { ...late, notes: ['Waiting on parts'] }, 'On Hold/Materials Required (from notes)'],
    ['the substatus wins over the notes', { ...late, substatus: 'Non Access', notes: ['Parts ordered'] }, 'Non Access'],
    ['late, and nothing says why', { ...late, substatus: 'Scheduled', notes: ['Called the tenant'] }, '-'],
    ['late, no substatus or notes at all', late, '-'],
    ['on time: no reason is given, whatever the substatus', { priority: 'id-p2', due: day(4), substatus: 'Non Access', notes: ['no access'] }, '-'],
    ['finished on time', { priority: 'id-p2', status: 'Completed', due: day(-2), completed: day(-2), substatus: 'Materials Ordered' }, '-'],
    ['no due date', { priority: 'id-p2', substatus: 'Non Access' }, '-'],
  ];
  const jobs = cases.map(([, fields], i) => task({ ...fields, job: 7000 + i }));
  const { breakdown } = buildReportingKpis(cacheOf({ jobs }), { dateFrom: day(-30), dateTo: day(0), view: 'overall' });
  const reasons = Object.fromEntries(breakdown.map((r) => [r.taskId, r.delayReason]));
  cases.forEach(([what, , reason], i) => assert.equal(reasons[7000 + i], reason, what));
  // The same on the P5 / PM table.
  const pm = [task({ priority: 'id-pm', due: day(-2), substatus: 'Materials Ordered' })];
  assert.equal(buildReportingKpis(cacheOf({ jobs: pm }), { dateFrom: day(-30), dateTo: day(0), view: 'overall' }).pmBreakdown[0].delayReason, 'Materials Ordered');
});

test('a delay reason explains a late job without changing any figure', () => {
  const fields = { priority: 'id-p1', due: day(-2) };
  const figures = (extra) => {
    const onTime = task({ priority: 'id-p1', status: 'Completed', due: day(-3), completed: day(-3) });
    const result = buildReportingKpis(cacheOf({ jobs: [task({ ...fields, ...extra }), onTime] }), { dateFrom: day(-30), dateTo: day(0), view: 'overall' });
    return [result.summary.overdue, result.priorityCompliance[0].actualPercent];
  };
  assert.deepEqual(figures({ substatus: 'Non Access' }), figures({}));
  assert.deepEqual(figures({}), [1, 50]);
});

test('a job’s notes are read as plain text, oldest first, and stay on the server', () => {
  const t = task({ notes: ['<p>First&nbsp;visit</p>', '', '  Second <br/> visit  '] });
  assert.equal(t.notes, 'First visit | Second visit');
  assert.equal(task({}).notes, '');
  const sent = JSON.stringify([
    buildReportingKpis(cacheOf({ jobs: [t] }), { dateFrom: day(-30), dateTo: day(0), view: 'overall' }),
    buildOverdueAgeing(cacheOf({ jobs: [t] }), { view: 'overall' }),
    buildKpiMatrixTasks(cacheOf({ jobs: [t] })),
  ]);
  assert.ok(!sent.includes('First visit'));
});

test('Overdue & Ageing: only open work past its due date, in the right age band', () => {
  const overdueBy = [1, 7, 8, 14, 15, 30, 31, 90];
  const jobs = [
    ...overdueBy.map((n) => task({ priority: 'id-p2', due: day(-n) })),
    task({ due: day(0) }), // due today: not overdue yet
    task({ due: day(4) }),
    task({ status: 'Completed', due: day(-20), completed: day(-1) }), // finished, however late
    task({}), // no due date
  ];
  const { data } = buildOverdueAgeing(cacheOf({ jobs }), { view: 'overall' });
  assert.equal(data.total, 8);
  assert.equal(data.oldestDays, 90);
  assert.deepEqual(Object.fromEntries(data.buckets.map((b) => [b.key, b.count])), { '0-7': 2, '8-14': 2, '15-30': 2, '30+': 2 });
  assert.deepEqual(data.rows.map((r) => r.daysOverdue), [90, 31, 30, 15, 14, 8, 7, 1]);
});

test('Overdue & Ageing judges "overdue" against today, not the day the data was loaded', () => {
  // As loaded two days ago: due the next day, so not overdue then. It is now.
  const fellDueSince = { ...task({ due: day(-1) }), overdue: false };
  // The other way round: marked overdue when loaded, but its due date isn't past.
  const notActuallyDue = { ...task({ due: day(3) }), overdue: true };
  const { data } = buildOverdueAgeing(cacheOf({ jobs: [fellDueSince, notActuallyDue] }), { view: 'overall' });
  assert.deepEqual(data.rows.map((r) => [r.jobNumber, r.daysOverdue]), [[fellDueSince.jobNumber, 1]]);
});

test('Overdue & Ageing groups AP with P but shows each job under its AroFlo name', () => {
  const jobs = [
    task({ priority: 'id-p1', due: day(-2) }),
    task({ priority: 'id-ap1', due: day(-2) }),
    task({ priority: 'id-phone', due: day(-2) }),
    task({ priority: '', due: day(-2) }),
  ];
  const { data } = buildOverdueAgeing(cacheOf({ jobs }), { view: 'overall' });
  assert.deepEqual(Object.fromEntries(data.byPriority.map((p) => [p.priority, p.total])), { P1: 2, PHONECALL: 1, 'No priority': 1 });
  assert.deepEqual(data.rows.map((r) => r.priorityName).sort(), ['AP1', 'No priority', 'P1', 'PHONECALL']);
});

test('Overdue & Ageing lists priorities up the scale, P1 to P4 then P5 and PM, not by how many jobs each has', () => {
  const overdue = (priority, count) => Array.from({ length: count }, () => task({ priority, due: day(-2) }));
  const jobs = [
    ...overdue('', 6),
    ...overdue('id-phone', 5),
    ...overdue('id-pm', 4),
    ...overdue('id-p3', 3),
    ...overdue('id-ap5', 2),
    ...overdue('id-p4', 2),
    ...overdue('id-ap1', 1),
    ...overdue('id-p2', 1),
  ];
  const { data } = buildOverdueAgeing(cacheOf({ jobs }), { view: 'overall' });
  assert.deepEqual(data.byPriority.map((p) => [p.priority, p.total]), [
    ['P1', 1],
    ['P2', 1],
    ['P3', 3],
    ['P4', 4], // P4 and AP5 together
    ['PM', 4],
    ['PHONECALL', 5], // not on the scale: after it, by name
    ['No priority', 6],
  ]);
});

test('Invoicing: submitted, paid and unpaid, by client group', () => {
  const invoices = [
    invoice({ id: 'a', client: 'Ventia', status: 'Approved', inc: 110, ex: 100 }),
    invoice({ id: 'b', client: 'Ventia', status: 'Processed', inc: 220, ex: 200 }),
    invoice({ id: 'c', client: 'South Australian Housing Trust', status: 'Processed', inc: 330, ex: 300 }),
    invoice({ id: 'd', client: 'Some Builder', status: 'Approved', inc: 55, ex: 50 }),
    invoice({ id: 'e', client: 'Ventia', status: 'Pending Approval', inc: 999, ex: 900 }), // a draft: not submitted
    invoice({ id: 'f', client: 'Ventia', status: 'Approved', invoiced: day(-60), inc: 777, ex: 700 }), // outside the range
    invoice({ id: 'g', client: 'Ventia', status: 'In Progress', inc: 44, ex: 40 }), // gone to the client: submitted, and said to be in progress
  ];
  const payments = [
    payment({ id: 'p1', invoiceId: 'b', amount: 220 }), // paid in full
    payment({ id: 'p2', invoiceId: 'c', amount: 100 }), // part paid: still unpaid
    payment({ id: 'p3', invoiceId: 'd', amount: 30 }),
    payment({ id: 'p4', invoiceId: 'd', amount: 25 }), // two payments that add up
  ];
  const { data } = buildInvoicingReport(cacheOf({ invoices, payments }), { view: 'all', dateFrom: day(-30), dateTo: day(0) });
  assert.deepEqual(data.kpis, {
    submittedCount: 5,
    submittedTotalInc: 759,
    submittedTotalEx: 690,
    inProgressCount: 1,
    inProgressTotalInc: 44,
    paidCount: 2,
    paidTotalInc: 275,
    unpaidCount: 3,
    unpaidTotalInc: 484,
  });
  const byClient = Object.fromEntries(data.byClient.map((r) => [r.client, [r.submittedCount, r.totalInc, r.paidCount, r.unpaidValue]]));
  assert.deepEqual(byClient, {
    Ventia: [3, 374, 1, 154],
    SAHA: [1, 330, 0, 330],
    'Projects/Other': [1, 55, 1, 0],
    Total: [5, 759, 2, 484],
  });
  // The status table counts drafts too.
  const pending = data.byStatus.find((r) => r.status === 'Pending Approval' && r.client === 'Ventia');
  assert.deepEqual([pending.count, pending.totalInc], [1, 999]);
  // Picking client groups.
  const two = buildInvoicingReport(cacheOf({ invoices, payments }), { view: 'SAHA||Ventia', dateFrom: day(-30), dateTo: day(0) }).data;
  assert.deepEqual([two.buckets, two.kpis.submittedCount, two.kpis.inProgressCount], [['Ventia', 'SAHA'], 4, 1]);
});

test('the KPI Matrix feed carries the level, and a midnight due stays a date', () => {
  const jobs = [task({ priority: 'id-ap5', job: 501, due: day(2) }), task({ priority: 'id-phone', job: 502 }), task({ priority: '', job: 503 })];
  const { data } = buildKpiMatrixTasks(cacheOf({ jobs }));
  assert.deepEqual(data.map((t) => [t.jobNumber, t.priority]), [['501', 'P5'], ['502', 'PHONECALL'], ['503', '']]);
  assert.equal(data[0].dueAt, `${day(2)} 00:00:00`);
  assert.equal(data[0].completedAt, null);
});

test('the KPI Matrix feed calls a job finished when Work Orders does: by its status', () => {
  const jobs = [
    task({ job: 601, status: 'Archived', due: day(-5), completed: day(-6) }),
    task({ job: 602, status: 'In Progress', due: day(-5), completed: day(-6) }), // reopened: open again
    task({ job: 603, status: 'Not Started', due: day(-5) }),
    task({ job: 604, status: 'Completed', due: day(-5) }), // finished, but AroFlo holds no completed date
  ];
  const { data } = buildKpiMatrixTasks(cacheOf({ jobs }));
  assert.deepEqual(data.map((t) => [t.jobNumber, t.completedAt]), [['601', `${day(-6)} 15:00:00`], ['602', null], ['603', null], ['604', null]]);
  // And Work Orders agrees which of them are overdue: the two that are open.
  assert.deepEqual(jobs.map((t) => kpi.isOverdue(t, now())), [false, true, true, false]);
  // The one that can't be judged goes over without a due date, so the
  // matrix doesn't take it for an open job that has run past it.
  assert.deepEqual(data.map((t) => Boolean(t.dueAt)), [true, true, true, false]);
});
