// The limit on wrong sign-in attempts (src/loginThrottle.js): it has to slow
// down guessing from one address without getting in anyone else's way.
// Run with `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
require('./helpers');
const { createLoginThrottle, clientAddress } = require('../src/loginThrottle');

// One sign-in attempt through the middleware. `outcome` is the status the
// sign-in route would answer with if the attempt is let through.
function attempt(throttle, ip, outcome) {
  const res = new EventEmitter();
  res.headers = {};
  res.set = (name, value) => {
    res.headers[name] = value;
  };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
  };
  let letThrough = false;
  throttle.middleware({ ip }, res, () => {
    letThrough = true;
  });
  if (letThrough) {
    res.statusCode = outcome;
    res.emit('finish');
  }
  return { letThrough, status: res.statusCode, body: res.body, retryAfter: res.headers['Retry-After'] };
}

test('ten wrong sign-ins from one address, and that address waits', () => {
  let clock = 1_000_000;
  const throttle = createLoginThrottle({ now: () => clock });
  for (let i = 0; i < 10; i++) assert.equal(attempt(throttle, '203.0.113.5', 401).letThrough, true, `attempt ${i + 1}`);
  const refused = attempt(throttle, '203.0.113.5', 401);
  assert.deepEqual([refused.letThrough, refused.status, refused.body], [false, 429, { error: 'Too many sign-in attempts. Try again in 15 minutes.' }]);
  assert.equal(refused.retryAfter, '900');
  // Even the right password has to wait: the limit is on trying, not on failing.
  assert.equal(attempt(throttle, '203.0.113.5', 200).letThrough, false);
  // Nobody else is held up.
  assert.equal(attempt(throttle, '198.51.100.7', 200).letThrough, true);

  clock += 14 * 60 * 1000;
  assert.equal(attempt(throttle, '203.0.113.5', 401).body.error, 'Too many sign-in attempts. Try again in 1 minute.');
  clock += 61 * 1000; // the fifteen minutes are up
  assert.equal(attempt(throttle, '203.0.113.5', 401).letThrough, true);
});

test('a correct sign-in clears the count', () => {
  const throttle = createLoginThrottle();
  for (let i = 0; i < 9; i++) attempt(throttle, '203.0.113.5', 401);
  assert.equal(attempt(throttle, '203.0.113.5', 200).letThrough, true);
  for (let i = 0; i < 10; i++) assert.equal(attempt(throttle, '203.0.113.5', 401).letThrough, true);
  assert.equal(attempt(throttle, '203.0.113.5', 401).letThrough, false);
});

test('the address is counted without the port App Service adds to it', () => {
  assert.equal(clientAddress({ ip: '203.0.113.5:49231' }), '203.0.113.5');
  assert.equal(clientAddress({ ip: '203.0.113.5' }), '203.0.113.5');
  assert.equal(clientAddress({ ip: '::ffff:203.0.113.5' }), '::ffff:203.0.113.5');
  assert.equal(clientAddress({ ip: '2001:db8::1' }), '2001:db8::1');
  // Each attempt arrives from a new port; it is still the same caller.
  const throttle = createLoginThrottle();
  for (let i = 0; i < 10; i++) attempt(throttle, `203.0.113.5:${40000 + i}`, 401);
  assert.equal(attempt(throttle, '203.0.113.5:51000', 401).letThrough, false);
});

test('a flood of addresses cannot grow the table without limit', () => {
  const throttle = createLoginThrottle();
  for (let i = 0; i < 6000; i++) attempt(throttle, `10.${i >> 16}.${(i >> 8) & 255}.${i & 255}`, 401);
  assert.ok(throttle.size() <= 5000);
});
