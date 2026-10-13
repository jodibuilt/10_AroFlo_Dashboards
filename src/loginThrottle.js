// A limit on wrong sign-in attempts, per address: on the public internet a
// username and password are all that stands between anyone and the reports,
// and nothing else here slows down guessing.
//
// After MAX_FAILURES wrong attempts from one address inside WINDOW_MS, that
// address is refused (429) until the window runs out. A correct sign-in
// clears its count. Counts are held in memory: a restart forgets them, and
// that is fine — the point is to make guessing slow, not to keep a record.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;
// Never let the table grow without limit, whatever is thrown at it.
const MAX_TRACKED = 5000;

// The caller's address. Behind App Service the proxy passes it on with the
// port attached ("203.0.113.5:49231"), and the port changes with every
// connection — left on, each attempt would look like a new caller.
function clientAddress(req) {
  return String(req.ip || req.socket?.remoteAddress || 'unknown').replace(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/, '$1');
}

function createLoginThrottle({ windowMs = WINDOW_MS, maxFailures = MAX_FAILURES, now = () => Date.now() } = {}) {
  const failures = new Map(); // address -> { count, until }

  function current(address) {
    const entry = failures.get(address);
    if (entry && entry.until <= now()) {
      failures.delete(address);
      return null;
    }
    return entry || null;
  }

  function recordFailure(address) {
    const entry = current(address) || { count: 0, until: now() + windowMs };
    entry.count += 1;
    failures.set(address, entry);
    if (failures.size > MAX_TRACKED) {
      for (const [key, value] of failures) if (value.until <= now()) failures.delete(key);
      // Still over: drop the oldest. A flood shouldn't be able to pin memory.
      while (failures.size > MAX_TRACKED) failures.delete(failures.keys().next().value);
    }
  }

  // Express middleware for POST /auth/login, ahead of the route itself.
  function middleware(req, res, next) {
    const address = clientAddress(req);
    const entry = current(address);
    if (entry && entry.count >= maxFailures) {
      const minutes = Math.max(1, Math.ceil((entry.until - now()) / 60000));
      res.set('Retry-After', String(Math.ceil((entry.until - now()) / 1000)));
      res.status(429).json({ error: `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` });
      return;
    }
    res.on('finish', () => {
      if (res.statusCode === 401) recordFailure(address);
      else if (res.statusCode === 200) failures.delete(address);
    });
    next();
  }

  return { middleware, size: () => failures.size };
}

module.exports = { createLoginThrottle, clientAddress };
