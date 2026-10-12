const config = require('./config');

// A task carries only the id of its priority. What that id means is each
// AroFlo account's own business — the Priorities zone lists them, and the
// cache keeps a copy (src/cache.js) — so priorities are named here the way
// AroFlo names them rather than from a table of ids that only fits one
// account.
//
// The reports are built on a P1-P5 / PM scale, so each priority is also read
// for the level its name gives it:
//   - "P3", "AP3" and "Priority Level 3 - …" are all level 3. AP<n> is SAHA's
//     contract wording for the same urgency as P<n>.
//   - "PM" and "SM" (scheduled maintenance) are both PM.
//   - a name that doesn't state its level, like "Emergency", gets one from
//     KPI_PRIORITY_CODE_MAP_JSON.
// Anything else ("PHONECALL") has no place on the scale: it is left out of
// the P-scale sections and shown under its own name everywhere else.

function clean(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

function codeFromName(name) {
  const s = clean(name);
  if (!s) return null;
  const configured = config.reporting.priorityCodeMap[s];
  if (configured) return configured;
  const level = /^(?:A?P|Priority(?:\s+Level)?)\s*([1-5])(?!\d)/i.exec(s);
  if (level) return `P${level[1]}`;
  if (/^(?:PM|SM)(?![A-Za-z0-9])/i.test(s) || /^(?:preventative|preventive|scheduled|planned)\s+maint/i.test(s)) {
    return 'PM';
  }
  return null;
}

// One record of the Priorities zone.
function normalizePriority(raw) {
  const short = clean(raw.shortdescription);
  const description = clean(raw.description);
  return {
    priorityId: clean(raw.priorityid),
    // The short name is what AroFlo shows on a job ("AP1"); the description
    // is the long form ("AP1 - Emergency Work - Attend same day…").
    name: short || description || null,
    code: codeFromName(short) || codeFromName(description),
  };
}

// The name and scale level for the priority id on a task. `priorities` is a
// Map of the cache's Priorities records by id. KPI_PRIORITY_LABELS_JSON only
// fills in for an id that list doesn't have.
function resolvePriority(priorityId, priorities) {
  const listed = priorities.get(priorityId);
  if (listed) return { label: listed.name, code: listed.code };
  const label = config.kpi.priorityLabels[priorityId] || null;
  return { label, code: codeFromName(label) };
}

module.exports = { normalizePriority, resolvePriority, codeFromName };
