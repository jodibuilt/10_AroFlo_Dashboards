function pad(n) {
  return String(n).padStart(2, '0');
}

// AroFlo v1 dates are local time, formatted YYYY/MM/DD and YYYY/MM/DD HH:mm:ss.
function formatAroFloDate(dateIso) {
  const d = new Date(dateIso);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

function formatAroFloDateTime(dateIso) {
  const d = new Date(dateIso);
  return `${formatAroFloDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const DATETIME_PATTERN = /^(\d{4})\/(\d{2})\/(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?$/;

// Parses "YYYY/MM/DD" or "YYYY/MM/DD HH:mm:ss" as local time.
function parseAroFloDateTime(value) {
  const match = DATETIME_PATTERN.exec(String(value || '').trim());
  if (!match) {
    throw new Error(`Unrecognized AroFlo date format: "${value}"`);
  }
  const [, year, month, day, hour = '0', minute = '0', second = '0'] = match;
  return new Date(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second)
  );
}

module.exports = { formatAroFloDate, formatAroFloDateTime, parseAroFloDateTime };
