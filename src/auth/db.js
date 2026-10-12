const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('../config');

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
`;

function openDb(dbPath = config.auth.dbPath) {
  const resolved = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec(SCHEMA);
  return wrap(db);
}

function wrap(db) {
  const stmts = {
    getUser: db.prepare('SELECT * FROM users WHERE username = $username'),
    listUsers: db.prepare('SELECT username, display_name, role, created_at FROM users ORDER BY username'),
    countUsers: db.prepare('SELECT COUNT(*) AS n FROM users'),
    countAdmins: db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
    insertUser: db.prepare(`
      INSERT INTO users (username, display_name, password_hash, salt, role, created_at)
      VALUES ($username, $displayName, $passwordHash, $salt, $role, $createdAt)
    `),
    deleteUser: db.prepare('DELETE FROM users WHERE username = $username'),
    updatePassword: db.prepare('UPDATE users SET password_hash = $passwordHash, salt = $salt WHERE username = $username'),
    updateRole: db.prepare('UPDATE users SET role = $role WHERE username = $username'),

    insertSession: db.prepare(`
      INSERT INTO sessions (token_hash, username, created_at, expires_at)
      VALUES ($tokenHash, $username, $createdAt, $expiresAt)
    `),
    getSession: db.prepare('SELECT * FROM sessions WHERE token_hash = $tokenHash'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = $tokenHash'),
    deleteSessionsForUser: db.prepare('DELETE FROM sessions WHERE username = $username'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at < $now'),
  };

  return {
    raw: db,

    getUser(username) {
      return stmts.getUser.get({ username }) || null;
    },

    listUsers() {
      return stmts.listUsers.all();
    },

    userCount() {
      return stmts.countUsers.get().n;
    },

    adminCount() {
      return stmts.countAdmins.get().n;
    },

    createUser({ username, displayName, passwordHash, salt, role }) {
      stmts.insertUser.run({
        username,
        displayName,
        passwordHash,
        salt,
        role,
        createdAt: new Date().toISOString(),
      });
    },

    deleteUser(username) {
      stmts.deleteUser.run({ username });
      stmts.deleteSessionsForUser.run({ username });
    },

    updatePassword(username, { passwordHash, salt }) {
      stmts.updatePassword.run({ username, passwordHash, salt });
      stmts.deleteSessionsForUser.run({ username });
    },

    updateRole(username, role) {
      stmts.updateRole.run({ username, role });
    },

    createSession({ tokenHash, username, expiresAt }) {
      stmts.insertSession.run({ tokenHash, username, createdAt: new Date().toISOString(), expiresAt });
    },

    getSession(tokenHash) {
      return stmts.getSession.get({ tokenHash }) || null;
    },

    deleteSession(tokenHash) {
      stmts.deleteSession.run({ tokenHash });
    },

    deleteSessionsForUser(username) {
      stmts.deleteSessionsForUser.run({ username });
    },

    pruneExpiredSessions() {
      stmts.deleteExpiredSessions.run({ now: new Date().toISOString() });
    },

    close() {
      db.close();
    },
  };
}

module.exports = { openDb };
