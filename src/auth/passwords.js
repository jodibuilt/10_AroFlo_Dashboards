const crypto = require('crypto');

const ITERATIONS = 200_000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';
const MIN_PASSWORD_LENGTH = 8;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  return { hash, salt };
}

// Constant-time compare, matching the pattern already used for webhook token
// checks (src/webhook/auth.js) — return false on a length mismatch rather
// than letting timingSafeEqual throw.
function verifyPassword(password, { salt, hash }) {
  const candidate = crypto.pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString('hex');
  const a = Buffer.from(candidate);
  const b = Buffer.from(hash);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function isValidPassword(password) {
  return typeof password === 'string' && password.length >= MIN_PASSWORD_LENGTH;
}

module.exports = { hashPassword, verifyPassword, isValidPassword, MIN_PASSWORD_LENGTH };
