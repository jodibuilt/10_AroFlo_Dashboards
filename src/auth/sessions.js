const crypto = require('crypto');
const config = require('../config');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Only the sha256 of the token is ever stored — the raw token lives only in
// the caller's httpOnly cookie, same principle as password hashing above.
function issueSession(db, username) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + config.auth.sessionTtlDays * 24 * 60 * 60 * 1000).toISOString();
  db.createSession({ tokenHash, username, expiresAt });
  return { token, expiresAt };
}

// Fixed-TTL-from-creation, not sliding — a session's expiry never extends on
// activity, it just eventually requires a fresh login.
function resolveSession(db, token) {
  if (!token) return null;
  const row = db.getSession(hashToken(token));
  if (!row) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) {
    db.deleteSession(row.token_hash);
    return null;
  }
  const user = db.getUser(row.username);
  if (!user) return null;
  return { username: user.username, displayName: user.display_name, role: user.role };
}

function revokeSession(db, token) {
  if (!token) return;
  db.deleteSession(hashToken(token));
}

module.exports = { issueSession, resolveSession, revokeSession };
