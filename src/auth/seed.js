const config = require('../config');
const logger = require('../logger');
const { hashPassword, isValidPassword, MIN_PASSWORD_LENGTH } = require('./passwords');

// ADMIN_USERNAME/ADMIN_PASSWORD in .env are authoritative for that one
// account on every boot, not just the first — if the account doesn't exist
// yet it's created, and if it already exists its password is resynced to
// match .env every time (a plain admin-password-reset each restart, which
// also revokes any existing sessions for it via db.updatePassword). Other
// accounts created through the admin panel are untouched either way. Fails
// loudly on boot rather than silently starting an unloginable app if no
// users exist at all and no env credentials are available to seed one.
function seedFirstAdmin(db) {
  const { adminUsername, adminPassword, adminDisplayName } = config.auth;

  if (!adminUsername || !adminPassword) {
    if (db.userCount() === 0) {
      throw new Error(
        'No users exist yet and ADMIN_USERNAME/ADMIN_PASSWORD are not set — set them in .env and restart to seed the first admin account.'
      );
    }
    return;
  }

  // The env-seeded admin skips the length rule every other account gets from
  // the admin panel. Not fatal (local dev uses a short one), but say so on
  // every boot so a deployed instance can't quietly keep a placeholder.
  if (!isValidPassword(adminPassword)) {
    logger.warn(`ADMIN_PASSWORD is shorter than ${MIN_PASSWORD_LENGTH} characters — set a strong one before exposing this app`, {
      username: adminUsername,
    });
  }

  const { hash, salt } = hashPassword(adminPassword);
  const existing = db.getUser(adminUsername);
  if (existing) {
    db.updatePassword(adminUsername, { passwordHash: hash, salt });
    logger.info('Synced admin account password from ADMIN_PASSWORD env var', { username: adminUsername });
  } else {
    db.createUser({
      username: adminUsername,
      displayName: adminDisplayName,
      passwordHash: hash,
      salt,
      role: 'admin',
    });
    logger.info('Seeded admin account', { username: adminUsername });
  }
}

module.exports = { seedFirstAdmin };
