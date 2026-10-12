const config = require('./config');
const { daysBetween } = require('./normalize');
const { parseAroFloDateTime } = require('./aroflo/aroFloDates');

function isCompletedStatus(status) {
  return config.completedTaskStatuses.includes(String(status || '').toLowerCase());
}

// Port of aroflo_dash's kpis.py _is_overdue — same three-branch logic.
function isOverdue(task, today = new Date()) {
  if (!task.requiredCompletedDate) return false;
  if (isCompletedStatus(task.status)) {
    return Boolean(task.completedDate) && task.completedDate > task.requiredCompletedDate;
  }
  return task.requiredCompletedDate < isoDate(today);
}

function isoDate(d) {
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;
}

function computeKpis(tasks, today = new Date()) {
  const issued = tasks.length;
  const completed = tasks.filter((t) => isCompletedStatus(t.status)).length;
  const outstanding = issued - completed;
  const overdue = tasks.filter((t) => isOverdue(t, today)).length;
  return {
    issued,
    completed,
    outstanding,
    overdue,
    completionRate: issued > 0 ? (completed / issued) * 100 : 0,
    // Deliberately /completed, not /issued — matches aroflo_dash exactly.
    overdueRate: completed > 0 ? (overdue / completed) * 100 : 0,
  };
}

// Port of aroflo_dash's compute_days_late.
function computeDaysLate(task, today = new Date()) {
  if (!task.requiredCompletedDate) return null;
  const required = parseAroFloDateSafe(task.requiredCompletedDate);
  if (!required) return null;
  if (isCompletedStatus(task.status) && task.completedDate) {
    const completed = parseAroFloDateSafe(task.completedDate);
    if (!completed) return null;
    return Math.max(daysBetween(required, completed), 0);
  }
  if (!isCompletedStatus(task.status)) {
    return Math.max(daysBetween(required, today), 0);
  }
  return null;
}

function parseAroFloDateSafe(value) {
  try {
    return parseAroFloDateTime(value);
  } catch {
    return null;
  }
}

// Port of aroflo_dash's map_delay_reason.
function mapDelayReason(delayRelevantSubstatus, daysLate, delayReasonsOfInterest) {
  if (!daysLate || daysLate <= 0) return '-';
  if (delayReasonsOfInterest.includes(delayRelevantSubstatus)) return delayRelevantSubstatus;
  return '-';
}

// One row per priority label that has a configured target AND ≥1 matching
// task — matches aroflo_dash exactly. Returns [] if priorityTargets is
// empty (not yet confirmed for this account — see src/config.js).
function computePriorityKpiCompliance(tasks, priorityTargets, today = new Date()) {
  const rows = [];
  for (const [label, target] of Object.entries(priorityTargets)) {
    const matching = tasks.filter((t) => t.priorityLabel === label);
    if (matching.length === 0) continue;
    const overdueCount = matching.filter((t) => isOverdue(t, today)).length;
    const actual = ((matching.length - overdueCount) / matching.length) * 100;
    rows.push({
      priority: label,
      total: matching.length,
      actualPercent: actual,
      targetPercent: target,
      variancePp: actual - target,
      status: actual >= target ? 'Met' : 'Below Target',
    });
  }
  return rows;
}

// priorities: optional array to filter to (empty/null = no filter, since
// priorityTargets often isn't configured yet and there's nothing meaningful
// to restrict to). delayRelevantByTaskId: {taskId: substatus} from the
// engine's append-only transition log (src/engine/db.js).
function buildBreakdownTable(tasks, { priorities, ascending, delayRelevantByTaskId, delayReasonsOfInterest }, today = new Date()) {
  const filtered = priorities && priorities.length ? tasks.filter((t) => priorities.includes(t.priorityLabel)) : tasks;

  const rows = filtered.map((t) => {
    const daysLate = computeDaysLate(t, today);
    const delayRelevantSubstatus = delayRelevantByTaskId[t.taskId] ?? t.substatus;
    return {
      taskId: t.taskId,
      jobNumber: t.jobNumber,
      client: t.client,
      priority: t.priorityLabel,
      requestDate: t.requestDate,
      // AroFlo has no single "work started" field; this is the earliest logged
      // Labour entry (see normalizeTask). Display-only, never used in a calc.
      actualStartDate: t.actualStartDate || null,
      requiredCompletedDate: t.requiredCompletedDate,
      completedDate: t.completedDate,
      daysLate,
      delayReason: mapDelayReason(delayRelevantSubstatus, daysLate, delayReasonsOfInterest),
      currentSubstatus: t.substatus || '-',
    };
  });

  rows.sort((a, b) => {
    const p = (a.priority || '').localeCompare(b.priority || '');
    if (p !== 0) return p;
    const cmp = (a.requestDate || '').localeCompare(b.requestDate || '');
    return ascending ? cmp : -cmp;
  });

  return rows;
}

// Port of aroflo_dash's data_source.py priority mapping step (Series.map()
// + fallthrough-on-miss): returns new task objects with priorityLabel
// replaced by its mapped P-code, dropping (not replacing) any task whose
// priorityLabel has no entry in priorityCodeMap — same as aroflo_dash's own
// unmapped-priorityid tasks falling out of every P-scale section.
function applyPriorityCodeMap(tasks, priorityCodeMap) {
  return tasks
    .filter((t) => Object.prototype.hasOwnProperty.call(priorityCodeMap, t.priorityLabel))
    .map((t) => ({ ...t, priorityLabel: priorityCodeMap[t.priorityLabel] }));
}

module.exports = {
  isOverdue,
  computeKpis,
  computeDaysLate,
  mapDelayReason,
  computePriorityKpiCompliance,
  buildBreakdownTable,
  applyPriorityCodeMap,
};
