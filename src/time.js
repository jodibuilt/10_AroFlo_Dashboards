const config = require('./config');

// The reports run on Adelaide time (config.timeZone) — not on whatever the
// machine this happens to run on is set to. A server in the cloud is usually
// on UTC, where "today" is still yesterday until 9:30 or 10:30 in the
// morning in Adelaide: until then a job due yesterday would not yet be
// overdue, and the month would not have turned over.
//
// Returns "now" as the clock on the wall in that zone, as a Date whose OWN
// fields read that way — getFullYear(), getDate(), getHours() are Adelaide's.
// That is the form every date here is already in: AroFlo sends wall-clock
// strings ("2026/10/13 08:30:00") and aroFloDates parses them the same way,
// so the two compare like for like in any server time zone. It is not the
// instant in time — don't call toISOString() on it or store it.
function zonedNow(instant = new Date(), timeZone = config.timeZone) {
  const parts = {};
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  for (const { type, value } of formatter.formatToParts(instant)) parts[type] = Number(value);
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

// A wall-clock Date's day as YYYY-MM-DD.
function dayOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

module.exports = { zonedNow, dayOf };
