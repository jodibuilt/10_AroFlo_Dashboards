// How the app talks to AroFlo: that it only reads, asks for the whole period
// the reports cover, survives a rate-limit reply, and stops short of using
// up the daily request allowance. Each test runs the real client and cache
// against a small stand-in for AroFlo that records what it is sent.
// Run with `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { day, standIn, quiet } = require('./helpers');
const AroFloClient = require('../src/aroflo/AroFloClient');
const { DashboardCache } = require('../src/cache');
const config = require('../src/config');
const { zonedNow } = require('../src/time');
const { businessUnitScope } = require('../src/businessUnit');
const { buildInvoicingReport } = require('../src/views');

const settle =(promise, ms) =>
  Promise.race([promise.then((value) => ({ value }), (error) => ({ error })), new Promise((r) => setTimeout(() => r({ hung: true }), ms))]);

test('a refresh only reads, and asks each dated zone for the whole period the reports cover', async () => {
  const aroflo = await standIn();
  try {
    const cache = new DashboardCache(aroflo.client);
    await cache.refreshAll();

    assert.deepEqual(aroflo.requests.map((r) => r.method), ['GET', 'GET', 'GET', 'GET']);
    assert.deepEqual(aroflo.requests.map((r) => r.zone), ['Priorities', 'Tasks', 'Invoices', 'Payments']);

    // Without these AroFlo returns just the last 30 days and says nothing.
    // The month it is in Adelaide, not on this machine.
    const now = zonedNow();
    const first = new Date(now.getFullYear(), now.getMonth() - config.lookbackMonths, 1);
    const iso = `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-01`;
    const where = Object.fromEntries(aroflo.requests.map((r) => [r.zone, r.where]));
    assert.deepEqual(where.Tasks, [`and|daterequested|>=|${iso}`]);
    assert.deepEqual(where.Invoices, [`and|dateinvoiced|>=|${iso}`]);
    assert.deepEqual(where.Payments, [`and|datepaid|>=|${iso.replace(/-/g, '/')}`]);
    assert.equal(cache.status().coverageFrom, iso.replace(/-/g, '/'));

    // Without these AroFlo sends every work order's substatus, labour and
    // notes empty — and says nothing about that either.
    const tasks = aroflo.requests.find((r) => r.zone === 'Tasks');
    assert.deepEqual(tasks.join, ['substatus,labour,notes']);
  } finally {
    await aroflo.close();
  }
});

// A record as AroFlo sends it, owned by a business unit.
const owned = (orgname, fields) => ({ org: { orgid: `id of ${orgname}`, orgname }, ...fields });

test('only the business unit the reports are for is kept: its work orders and its invoices', async () => {
  assert.deepEqual(config.businessUnits, ['TTS RMS']);
  const tasks = [
    owned('TTS RMS', { taskid: 't1', jobnumber: '1', status: 'In Progress' }),
    owned('TTS Projects', { taskid: 't2', jobnumber: '2', status: 'In Progress' }),
    owned('tts - rms', { taskid: 't3', jobnumber: '3', status: 'Completed' }), // the same unit, written another way
    { taskid: 't4', jobnumber: '4', status: 'In Progress' }, // no owner given: not known to be ours
  ];
  const bill = (id, inc) => ({ invoiceid: id, invoicenumber: id, client: { orgid: 'c', orgname: 'Ventia' }, status: 'Approved', dateinvoiced: day(-2), totalex: String(inc), totalinc: String(inc) });
  const invoices = [owned('TTS RMS', bill('i1', 100)), owned('TTS Projects', bill('i2', 900))];
  const paid = (id, invoiceId, amount) => ({ paymentid: id, linkedto: { linkedtotype: 'Invoice', linkedtoid: invoiceId }, amount: String(amount), datepaid: day(-1), status: 'Paid' });
  const payments = [paid('p1', 'i1', 100), paid('p2', 'i2', 900)];
  const aroflo = await standIn((zone) => ({ Tasks: tasks, Invoices: invoices, Payments: payments })[zone] || []);
  try {
    const cache = new DashboardCache(aroflo.client);
    await cache.refreshAll();

    assert.deepEqual(cache.get('jobs').records.map((t) => t.jobNumber), ['1', '3']);
    assert.deepEqual(cache.get('invoices').records.map((i) => i.invoiceId), ['i1']);

    // What arrived and what was left out is on record, for the page and the log.
    const status = cache.status();
    assert.deepEqual(status.businessUnits, ['TTS RMS']);
    assert.deepEqual(status.zones.jobs.businessUnits, {
      reportsAreFor: ['TTS RMS'],
      received: { 'TTS RMS': 1, 'TTS Projects': 1, 'tts - rms': 1, '(none given)': 1 },
      kept: 2,
      leftOut: 2,
      limited: true,
    });
    assert.deepEqual([status.zones.jobs.count, status.zones.jobs.warning], [2, null]);
    assert.deepEqual([status.zones.invoices.businessUnits.kept, status.zones.invoices.businessUnits.leftOut], [1, 1]);

    // Payments are not cut down — and need not be: one only counts against
    // an invoice that is held, so the other unit's $900 reaches no figure.
    assert.equal(cache.get('payments').records.length, 2);
    assert.equal(status.zones.payments.businessUnits, null);
    const { data } = buildInvoicingReport(cache, { view: 'all', dateFrom: day(-30), dateTo: day(0) });
    assert.deepEqual([data.kpis.submittedCount, data.kpis.submittedTotalInc, data.kpis.paidCount, data.kpis.paidTotalInc], [1, 100, 1, 100]);
  } finally {
    await aroflo.close();
  }
});

test('when the business unit cannot be told, or matches nothing, the page is told — never a quiet guess', () => {
  const of = (...names) => names.map((businessUnit) => ({ businessUnit }));
  const kept = (records, scope) => records.filter(scope.keep).map((r) => r.businessUnit);

  // AroFlo named no owner on anything: nothing to go by, so all of it stays, with a warning.
  let records = of('', '');
  let scope = businessUnitScope(records, ['TTS RMS']);
  assert.equal(kept(records, scope).length, 2);
  assert.match(scope.warning, /did not say which business unit .* could not be limited to TTS RMS/);
  assert.equal(scope.summary.limited, false);

  // The name matches nothing that came: nothing is shown, and the warning says what did come.
  records = of('TTS Projects', 'TTS Built', 'TTS Built');
  scope = businessUnitScope(records, ['TTS RMS']);
  assert.deepEqual(kept(records, scope), []);
  assert.match(scope.warning, /none of the 3 AroFlo sent belong to TTS RMS.*It sent: TTS Built \(2\), TTS Projects \(1\)/);

  // A longer name is another unit, not a match.
  records = of('TTS RMS', 'TTS RMS Projects', 'RMS');
  scope = businessUnitScope(records, ['TTS RMS']);
  assert.deepEqual(kept(records, scope), ['TTS RMS']);
  assert.equal(scope.warning, null);

  // More than one unit can be named; "*" is every unit the login can see.
  scope = businessUnitScope(records, ['TTS RMS', 'rms']);
  assert.deepEqual(kept(records, scope), ['TTS RMS', 'RMS']);
  scope = businessUnitScope(records, ['*']);
  assert.deepEqual([kept(records, scope).length, scope.warning, scope.summary.limited], [3, null, false]);
});

test('the client refuses to send anything but a GET', async () => {
  const aroflo = await standIn();
  try {
    const attempts = [
      () => aroflo.client.http.post('', 'zone=Tasks&postxml=<task/>'),
      () => aroflo.client.http.put('', {}),
      () => aroflo.client.http.patch('', {}),
      () => aroflo.client.http.delete(''),
      () => aroflo.client.http.request({ method: 'post', url: '', data: 'x' }),
    ];
    for (const attempt of attempts) await assert.rejects(attempt, /read-only/);
    assert.equal(aroflo.requests.length, 0);
  } finally {
    await aroflo.close();
  }
});

test('a filter AroFlo ignores is an error, not quietly different data', async () => {
  const aroflo = await standIn((zone) =>
    zone === 'Tasks'
      ? { status: '0', statusmessage: 'WHERE field(s) daterequested are not available in the Tasks zone, default filter applied', zoneresponse: { tasks: [{ taskid: 'x' }] } }
      : [],
  );
  try {
    const cache = new DashboardCache(aroflo.client);
    await cache.refreshAll();
    assert.match(cache.get('jobs').error, /not available in the Tasks zone/);
    assert.equal(cache.get('jobs').records.length, 0);
  } finally {
    await aroflo.close();
  }
});

test('hitting the page limit is reported, not hidden', async () => {
  const fullPage = Array.from({ length: config.pageSize }, (_, i) => ({ paymentid: String(i), amount: '1', datepaid: day(-1) }));
  const aroflo = await standIn((zone) => (zone === 'Payments' ? fullPage : []));
  try {
    const cache = new DashboardCache(aroflo.client);
    await cache.refreshAll();
    assert.equal(aroflo.requests.filter((r) => r.zone === 'Payments').length, config.maxPagesPerZone);
    assert.match(cache.status().zones.payments.warning, /only the first .* records were loaded/);
    assert.equal(cache.status().zones.jobs.warning, null);
  } finally {
    await aroflo.close();
  }
});

test('a rate-limit reply is retried and does not freeze refreshing', async () => {
  let refuse = 0;
  const aroflo = await standIn(() => {
    if (refuse > 0) {
      refuse -= 1;
      return { status: '-1', statusmessage: 'Exceeded Per Second Rate Limit - Please limit the timing of your requests' };
    }
    return [];
  });
  try {
    // One request a second is the app's default, and the setting it froze on:
    // the retry used to wait for the single slot its own failed attempt held.
    const client = new AroFloClient({
      baseUrl: aroflo.client.baseUrl,
      secretKey: 'k',
      uEncoded: 'u',
      pEncoded: 'p',
      orgEncoded: 'o',
      rateLimitPerSecond: 1,
      rateLimitPerMinute: 120,
      logger: quiet,
    });

    refuse = 1;
    let result = await settle(client.getZone('Tasks', { page: 1, pageSize: 200 }), 15000);
    assert.ok(result.value, result.hung ? 'the retry never came back' : String(result.error));
    assert.equal(aroflo.requests.length, 2);

    // AroFlo keeps refusing: give up with the error rather than hang.
    refuse = 99;
    result = await settle(client.getZone('Tasks', { page: 1, pageSize: 200 }), 20000);
    assert.match(result.error?.message || 'hung', /Rate Limit/);
    assert.equal(aroflo.requests.length, 5);
  } finally {
    await aroflo.close();
  }
});

test('with the daily allowance nearly gone, a refresh reads one thing and keeps what it has', async () => {
  const aroflo = await standIn((zone) => (zone === 'Tasks' ? [{ taskid: 't1', jobnumber: '1', status: 'Completed', priority: '' }] : []));
  try {
    const cache = new DashboardCache(aroflo.client);
    await cache.refreshAll();
    assert.equal(cache.get('jobs').records.length, 1);

    aroflo.headers['x-ratelimit-daily-remaining'] = '150'; // under the 10% kept in reserve
    aroflo.requests.length = 0;
    await cache.refreshAll();
    assert.deepEqual(aroflo.requests.map((r) => r.zone), ['Priorities']);
    assert.equal(cache.get('jobs').records.length, 1);
    assert.match(cache.get('jobs').error, /daily request allowance nearly used up — 150 of 2000 left/);

    aroflo.headers['x-ratelimit-daily-remaining'] = '2000'; // the daily reset
    aroflo.requests.length = 0;
    await cache.refreshAll();
    assert.deepEqual(aroflo.requests.map((r) => r.zone), ['Priorities', 'Tasks', 'Invoices', 'Payments']);
    assert.equal(cache.get('jobs').error, null);
  } finally {
    await aroflo.close();
  }
});
