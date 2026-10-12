const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const config = require('./config');

// The two tables the Reports/Tools shell needs, with the same definitions
// they have in test_all_aroflo's engine.sqlite — so pointing APP_DB_PATH at
// a copy of that file carries existing nav settings and saved edits across.
const SCHEMA = `
  -- Small key/value store for app-wide settings — currently just which
  -- sidebar tabs / sub-tabs an admin has hidden (key 'nav_hidden'). value is
  -- always a JSON string.
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  -- Reporting Dashboard inline-edit/color-picker persistence, ported from
  -- aroflo_dash's edit_store.py. Scoped per user + view + date range +
  -- state_key — switching back to a prior view/date-range picks its old
  -- edits back up.
  CREATE TABLE IF NOT EXISTS dashboard_edits (
    username TEXT NOT NULL,
    view TEXT NOT NULL,
    date_from TEXT NOT NULL,
    date_to TEXT NOT NULL,
    state_key TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (username, view, date_from, date_to, state_key)
  );
`;

function openDb(dbPath = config.db.path) {
  const resolved = path.isAbsolute(dbPath) ? dbPath : path.join(process.cwd(), dbPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  // Only this one process ever opens the file, so the default rollback
  // journal is enough — no WAL, which needs shared memory that App Service's
  // network-backed /home doesn't reliably provide.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  return wrap(db);
}

function wrap(db) {
  const stmts = {
    getSetting: db.prepare('SELECT value FROM app_settings WHERE key = $key'),
    upsertSetting: db.prepare(`
      INSERT INTO app_settings (key, value, updated_at) VALUES ($key, $value, $updatedAt)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `),
    getDashboardEdit: db.prepare(`
      SELECT payload_json, updated_at FROM dashboard_edits
      WHERE username = $username AND view = $view AND date_from = $dateFrom AND date_to = $dateTo AND state_key = $stateKey
    `),
    upsertDashboardEdit: db.prepare(`
      INSERT INTO dashboard_edits (username, view, date_from, date_to, state_key, payload_json, updated_at)
      VALUES ($username, $view, $dateFrom, $dateTo, $stateKey, $payloadJson, $updatedAt)
      ON CONFLICT(username, view, date_from, date_to, state_key) DO UPDATE SET
        payload_json = excluded.payload_json,
        updated_at = excluded.updated_at
    `),
    deleteDashboardEdit: db.prepare(`
      DELETE FROM dashboard_edits
      WHERE username = $username AND view = $view AND date_from = $dateFrom AND date_to = $dateTo AND state_key = $stateKey
    `),
  };

  return {
    raw: db,

    // JSON-valued app settings. getSetting returns the parsed value or the
    // supplied fallback; setSetting stores any JSON-serialisable value.
    getSetting(key, fallback = null) {
      const row = stmts.getSetting.get({ key });
      if (!row) return fallback;
      try {
        return JSON.parse(row.value);
      } catch {
        return fallback;
      }
    },

    setSetting(key, value) {
      stmts.upsertSetting.run({ key, value: JSON.stringify(value), updatedAt: new Date().toISOString() });
    },

    getDashboardEdit({ username, view, dateFrom, dateTo, stateKey }) {
      const row = stmts.getDashboardEdit.get({ username, view, dateFrom, dateTo, stateKey });
      return row ? JSON.parse(row.payload_json) : null;
    },

    saveDashboardEdit({ username, view, dateFrom, dateTo, stateKey, payload }) {
      stmts.upsertDashboardEdit.run({
        username,
        view,
        dateFrom,
        dateTo,
        stateKey,
        payloadJson: JSON.stringify(payload),
        updatedAt: new Date().toISOString(),
      });
    },

    deleteDashboardEdit({ username, view, dateFrom, dateTo, stateKey }) {
      stmts.deleteDashboardEdit.run({ username, view, dateFrom, dateTo, stateKey });
    },

    close() {
      db.close();
    },
  };
}

module.exports = { openDb };
