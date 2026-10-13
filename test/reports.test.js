// Do the report numbers come out right? Each test builds a handful of work
// orders or invoices whose answer can be worked out by hand, and checks the
// report says the same. Run with `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { day, task, invoice, payment, cacheOf } = require('./helpers');
const kpi = require('../src/kpi');
const { codeFromName } = require('../src/priorities');
const { buildReportingKpis, buildOverdueAgeing, buildInvoicingReport, buildKpiMatrixTasks } = require('../src/views');

test('priority names are read for their level', () => {
  const expected = {
    P1: 'P1',
    AP1: 'P1',
    AP5: 'P5',
    'P4 - 30 days': 'P4',
    'Priority Level 2 - Attend within 3 calendar days': 'P2',
    PM: 'PM',
    'PM - Preventative Maintenance': 'PM',
    SM: 'PM',
    Emergency: 'P1', // from the configured map
    PHONECALL: null,
    'SLA Urgent 1hour': null,
    1: null,
    P10: null,
    SMS: null,
  };
  for (const [name, level] of Object.entries(expected)) assert.equal(codeFromName(name), level, name);
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
  for (const [what, t, overdue] of cases) assert.equal(kpi.isOverdue(t), overdue, what);
});

test('days late', () => {
  assert.equal(kpi.computeDaysLate(task({ status: 'Completed', due: day(-10), completed: day(-8) })), 2);
  assert.equal(kpi.computeDaysLate(task({ status: 'Completed', due: day(-5), completed: day(-6) })), 0);
  assert.equal(kpi.computeDaysLate(task({ due: day(-4) })), 4);
  assert.equal(kpi.computeDaysLate(task({ due: day(3) })), 0);
  assert.equal(kpi.computeDaysLate(task({})), null);
});

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
  // Overdue rate is overdue / completed, as in the earlier dashboard.
  assert.equal(summary.overdueRate, 50);
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

test('the client filter takes one client, several, or everyone', () => {
  const jobs = [task({ client: 'Ventia' }), task({ client: 'Ventia' }), task({ client: 'South Australian Housing Trust' }), task({ client: 'Other Co' })];
  const issued = (view) => buildReportingKpis(cacheOf({ jobs }), { dateFrom: day(-30), dateTo: day(0), view }).summary.issued;
  assert.equal(issued('overall'), 4);
  assert.equal(issued('Ventia'), 2);
  assert.equal(issued('South Australian Housing Trust||Ventia'), 3);
  assert.equal(issued('Nobody'), 0);
});

test('Target KPI Compliance: share of each level not overdue, AP counted with P', () => {
  const jobs = [
    task({ priority: 'id-p1', due: day(5) }),
    task({ priority: 'id-ap1', client: 'South Australian Housing Trust', due: day(-2) }), // overdue
    task({ priority: 'id-p1', status: 'Completed', due: day(-3), completed: day(-3) }),
    task({ priority: 'id-ap1', client: 'South Australian Housing Trust', status: 'Completed', due: day(-3), completed: day(-4) }),
    task({ priority: 'id-pm', due: day(-1) }), // overdue
    task({ priority: 'id-sm', due: day(10) }),
    task({ priority: 'id-ap5', due: day(-1) }), // level 5 has no target
    task({ priority: 'id-phone', due: day(-1) }), // not on the scale
    task({ priority: '', due: day(-1) }), // no priority
  ];
  const result = buildReportingKpis(cacheOf({ jobs }), { dateFrom: day(-30), dateTo: day(0), view: 'overall' });
  const rows = Object.fromEntries(result.priorityCompliance.map((r) => [r.priority, r]));
  assert.deepEqual(Object.keys(rows).sort(), ['P1', 'PM']);
  assert.deepEqual([rows.P1.total, rows.P1.actualPercent, rows.P1.targetPercent, rows.P1.status], [4, 75, 98, 'Below Target']);
  assert.deepEqual([rows.PM.total, rows.PM.actualPercent, rows.PM.targetPercent, rows.PM.status], [2, 50, 90, 'Below Target']);
  // Everything still counts in General Statistics, on the scale or not.
  assert.equal(result.summary.issued, 9);
  assert.equal(result.summary.overdue, 5);
  // Level 5 goes to the P5 / PM table; the off-scale ones to neither.
  assert.deepEqual(result.breakdown.map((r) => r.priority).sort(), ['P1', 'P1', 'P1', 'P1']);
  assert.deepEqual(result.pmBreakdown.map((r) => r.priority).sort(), ['P5', 'PM', 'PM']);
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
    const result = buildReportingKpis(cacheOf({ jobs: [task({ ...fields, ...extra }), task({ priority: 'id-p1', due: day(3) })] }), { dateFrom: day(-30), dateTo: day(0), view: 'overall' });
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
    ['P4', 2],
    ['P5', 2],
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
  ];
  const payments = [
    payment({ id: 'p1', invoiceId: 'b', amount: 220 }), // paid in full
    payment({ id: 'p2', invoiceId: 'c', amount: 100 }), // part paid: still unpaid
    payment({ id: 'p3', invoiceId: 'd', amount: 30 }),
    payment({ id: 'p4', invoiceId: 'd', amount: 25 }), // two payments that add up
  ];
  const { data } = buildInvoicingReport(cacheOf({ invoices, payments }), { view: 'all', dateFrom: day(-30), dateTo: day(0) });
  assert.deepEqual(data.kpis, {
    submittedCount: 4,
    submittedTotalInc: 715,
    submittedTotalEx: 650,
    paidCount: 2,
    paidTotalInc: 275,
    unpaidCount: 2,
    unpaidTotalInc: 440,
  });
  const byClient = Object.fromEntries(data.byClient.map((r) => [r.client, [r.submittedCount, r.totalInc, r.paidCount, r.unpaidValue]]));
  assert.deepEqual(byClient, {
    Ventia: [2, 330, 1, 110],
    SAHA: [1, 330, 0, 330],
    'Projects/Other': [1, 55, 1, 0],
    Total: [4, 715, 2, 440],
  });
  // The status table counts drafts too.
  const pending = data.byStatus.find((r) => r.status === 'Pending Approval' && r.client === 'Ventia');
  assert.deepEqual([pending.count, pending.totalInc], [1, 999]);
  // Picking client groups.
  const two = buildInvoicingReport(cacheOf({ invoices, payments }), { view: 'SAHA||Ventia', dateFrom: day(-30), dateTo: day(0) }).data;
  assert.deepEqual([two.buckets, two.kpis.submittedCount], [['Ventia', 'SAHA'], 3]);
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
  assert.deepEqual(jobs.map((t) => kpi.isOverdue(t)), [false, true, true, false]);
  // The one that can't be judged goes over without a due date, so the
  // matrix doesn't take it for an open job that has run past it.
  assert.deepEqual(data.map((t) => Boolean(t.dueAt)), [true, true, true, false]);
});
