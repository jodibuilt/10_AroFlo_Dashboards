// How the app talks to AroFlo: that it only reads, asks for the whole period
// the reports cover, survives a rate-limit reply, and stops short of using
// up the daily request allowance. Each test runs the real client and cache
// against a small stand-in for AroFlo that records what it is sent.
// Run with `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { day } = require('./helpers');
const AroFloClient = require('../src/aroflo/AroFloClient');
const { DashboardCache } = require('../src/cache');
const config = require('../src/config');
const { zonedNow } = require('../src/time');

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

// `reply(zone, request)` returns the records for a request, or a whole
// response body to send instead.
async function standIn(reply = () => []) {
  const requests = [];
  const headers = { 'x-ratelimit-daily-limit': '2000', 'x-ratelimit-daily-remaining': '1500' };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://aroflo');
    const zone = url.searchParams.get('zone') || '';
    const request = {
      method: req.method,
      zone,
      where: url.searchParams.getAll('where'),
      join: url.searchParams.getAll('join'),
      page: Number(url.searchParams.get('page')),
    };
    requests.push(request);
    const result = reply(zone, request);
    res.writeHead(200, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(Array.isArray(result) ? { status: '0', statusmessage: '', zoneresponse: { [zone.toLowerCase()]: result } } : result));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const client = new AroFloClient({
    baseUrl: `http://127.0.0.1:${server.address().port}/`,
    secretKey: 'not-a-real-key',
    uEncoded: 'u',
    pEncoded: 'p',
    orgEncoded: 'o',
    rateLimitPerSecond: 50,
    rateLimitPerMinute: 1000,
    logger: quiet,
  });
  return { client, requests, headers, close: () => new Promise((resolve) => server.close(resolve)) };
}

const settle = (promise, ms) =>
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
