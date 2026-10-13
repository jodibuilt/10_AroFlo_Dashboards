const config = require('./config');

// Why a late job was late — as far as AroFlo can say, which is two places:
//
//   1. the job's current substatus, when it is one that means "held up"
//      (KPI_DELAY_REASON_SUBSTATUSES: Non Access, Materials Ordered, On
//      Hold/Materials Required, Sent to Procurement). That is something
//      staff set on the job.
//   2. failing that, the wording of the job's notes — a plain keyword match,
//      shown with "(from notes)" after it because it is a guess about a
//      sentence, not a recorded cause: "ordered lunch while waiting" would
//      match as confidently as "parts ordered".
//
// AroFlo keeps no history of a job's substatus, so a job that sat in Non
// Access and has since moved on to "Ready for Invoicing" can only be caught
// by (2), if someone wrote it down.
//
// Only ever given for a job that IS late: a substatus or a note about
// materials on a job that finished on time is not why anything was late.
// (Ported from aroflo_dash's map_delay_reason / guess_delay_reason_from_notes.)

// Checked top to bottom, first match wins — so "parts ordered" reads as
// Materials Ordered before the broader "parts" can claim it.
const NOTE_KEYWORDS = [
  ['Materials Ordered', ['ordered', 'awaiting delivery', 'on order']],
  ['On Hold/Materials Required', ['material', 'parts', 'supplier']],
  [
    'Non Access',
    ['no access', 'non access', 'access issue', 'denied access', 'could not access', "couldn't access", 'unable to access', 'unable to gain access'],
  ],
];

// Letters and digits only, so "Non-Access" and "non access" are one name.
const plain = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

function fromSubstatus(substatus) {
  const s = String(substatus || '').trim();
  if (!plain(s)) return null;
  const known = config.kpi.delayReasonSubstatuses.some((name) => plain(name) === plain(s));
  return known ? s : null;
}

function fromNotes(notes) {
  const text = String(notes || '').toLowerCase();
  if (!text) return null;
  const hit = NOTE_KEYWORDS.find(([, keywords]) => keywords.some((keyword) => text.includes(keyword)));
  return hit ? hit[0] : null;
}

const FROM_NOTES = ' (from notes)';

function delayReasonFor(task, daysLate) {
  if (!daysLate || daysLate <= 0) return '-';
  const recorded = fromSubstatus(task.substatus);
  if (recorded) return recorded;
  const guessed = fromNotes(task.notes);
  return guessed ? `${guessed}${FROM_NOTES}` : '-';
}

// Where a reason came from, for the log's tally after a refresh.
function delayReasonSource(reason) {
  if (!reason || reason === '-') return 'none found';
  return reason.endsWith(FROM_NOTES) ? 'from notes' : 'from substatus';
}

module.exports = { delayReasonFor, delayReasonSource };
