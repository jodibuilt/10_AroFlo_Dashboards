const config = require('./config');

// A task carries only the id of its priority. What that id means is each
// AroFlo account's own business — the Priorities zone lists them, and the
// cache keeps a copy (src/cache.js) — so priorities are named here the way
// AroFlo names them rather than from a table of ids that only fits one
// account.
//
// The reports are built on a P1-P4 / PM scale, so each priority is also read
// for the level its name states — and only what it states (confirmed with
// the business, 2026-10-13: "use the priorities explicitly"):
//   - "P3", "AP3" and "Priority Level 3 - …" are all level 3. AP<n> is SAHA's
//     contract wording for the same urgency as P<n>.
//   - level 5 (AP5) is reported as part of P4: same 30-day window, same
//     target. Its own level is kept beside it (`level`), so a page can head
//     the group "P4/P5" when there are level-5 jobs in it.
//   - "PM" is PM.
//   - a name that doesn't state its level, like "Emergency", gets one from
//     KPI_PRIORITY_CODE_MAP_JSON.
// Anything else — "PHONECALL", "SM" — has no place on the scale: it is left
// out of the priority sections and shown under its own name everywhere else.

function clean(v) {
  return v === null || v === undefined ? '' : String(v).trim();
}

// The level a priority's name states: "P1" … "P5", "PM", or null.
function levelFromName(name) {
  const s = clean(name);
  if (!s) return null;
  const configured = config.reporting.priorityCodeMap[s];
  if (configured) return configured;
  const level = /^(?:A?P|Priority(?:\s+Level)?)\s*([1-5])(?!\d)/i.exec(s);
  if (level) return `P${level[1]}`;
  if (/^PM(?![A-Za-z0-9])/i.test(s) || /^(?:preventative|preventive)\s+maint/i.test(s)) return 'PM';
  return null;
}

// The level a priority is REPORTED under: its own, except that P5 is part
// of P4.
const reportedAs = (level) => (level === 'P5' ? 'P4' : level);
const codeFromName = (name) => reportedAs(levelFromName(name));

// One record of the Priorities zone.
function normalizePriority(raw) {
  const short = clean(raw.shortdescription);
  const description = clean(raw.description);
  const level = levelFromName(short) || levelFromName(description);
  return {
    priorityId: clean(raw.priorityid),
    // The short name is what AroFlo shows on a job ("AP1"); the description
    // is the long form ("AP1 - Emergency Work - Attend same day…").
    name: short || description || null,
    code: reportedAs(level),
    level,
  };
}

// The name, reported level and own level for the priority id on a task.
// `priorities` is a Map of the cache's Priorities records by id.
// KPI_PRIORITY_LABELS_JSON only fills in for an id that list doesn't have.
function resolvePriority(priorityId, priorities) {
  const listed = priorities.get(priorityId);
  if (listed) return { label: listed.name, code: listed.code, level: listed.level };
  const label = config.kpi.priorityLabels[priorityId] || null;
  const level = levelFromName(label);
  return { label, code: reportedAs(level), level };
}

// How a reported level is headed when its group holds jobs of more than one
// level: { P4: 'P4/P5' } when any of `tasks` is a level-5 job. Empty when
// every group is just itself.
function levelLabels(tasks) {
  return tasks.some((t) => t.priorityCode === 'P4' && t.priorityLevel === 'P5') ? { P4: 'P4/P5' } : {};
}

module.exports = { normalizePriority, resolvePriority, codeFromName, levelFromName, levelLabels };
