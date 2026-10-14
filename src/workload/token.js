const crypto = require('crypto');

// Whether what came in the address is the secret, compared in a way that
// takes the same time however much of it is right — so the answer can't be
// felt out one character at a time.
function sameSecret(given, secret) {
  if (typeof given !== 'string' || !given || !secret) return false;
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(String(secret)).digest();
  return crypto.timingSafeEqual(a, b);
}

module.exports = { sameSecret };
