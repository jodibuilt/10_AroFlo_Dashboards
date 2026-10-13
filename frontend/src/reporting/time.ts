// The reports run on Adelaide time — the zone the server reports in
// /api/reporting/config — not on whatever the browser is set to. Someone
// opening the page from Darwin, Perth or overseas sees the same "today",
// the same month and the same times as someone in Adelaide. The server
// works the same way (src/time.js).

let zone = 'Australia/Adelaide';

// Called once with the server's setting, before any report pane is shown.
export function setReportTimeZone(timeZone: string | null | undefined): void {
  if (!timeZone) return;
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone }); // throws on a name the browser doesn't know
    zone = timeZone;
  } catch {
    /* keep the default */
  }
}

// "Now" as the clock on the wall in the reports' zone, as a Date whose own
// fields read that way — getFullYear(), getDate(), getHours() are
// Adelaide's. That is the form the dates on these pages are already in
// (AroFlo's "2026/10/13 08:30:00", read as written), so they compare like
// for like. It is not the instant in time: don't call toISOString() on it.
export function zonedNow(instant: Date = new Date()): Date {
  const parts: Record<string, number> = {};
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
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

// A wall-clock Date's day as a date input holds it: YYYY-MM-DD.
export function dayOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

// Today, in the reports' zone. Not `new Date().toISOString()`: that is the
// day in UTC, which is still yesterday in Adelaide until mid-morning.
export function today(): string {
  return dayOf(zonedNow());
}

// A date as AroFlo sends it — "2026/10/05", with or without a time after it
// — shown as "05 Oct 2026". Read as written: the day on the page is the day
// in the data, in any browser. (Parsing it as a Date first shifts it a day
// in a browser west of Greenwich.)
export function formatDay(value: string | null | undefined): string {
  if (!value) return '';
  const m = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(value.trim());
  if (!m) return value;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

// The day it was, in the reports' zone, at a moment the server recorded:
// YYYY-MM-DD. Not the first ten characters of the ISO string — that is the
// day in UTC.
export function dayOfInstant(iso: string): string {
  return dayOf(zonedNow(new Date(iso)));
}

// A moment the server recorded (an ISO instant), as a time in the reports'
// zone: "13 Oct, 8:30 am ACDT".
export function formatInstant(iso: string): string {
  return new Date(iso).toLocaleString('en-AU', {
    timeZone: zone,
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

// The zone as people say it: "Australia/Adelaide" -> "Adelaide".
export function zoneName(): string {
  return (zone.split('/').pop() || zone).replace(/_/g, ' ');
}
