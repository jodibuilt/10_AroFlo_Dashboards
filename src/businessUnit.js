const config = require('./config');

// One AroFlo login can see several business units. The reports are for the
// ones named in AROFLO_BUSINESS_UNITS (default: TTS RMS): a work order or an
// invoice owned by any other is dropped as it is loaded (src/cache.js), so
// it is in no figure, table or download.
//
// The dropping is done here, on what AroFlo sends back, not by asking AroFlo
// for one unit: no business-unit filter is known to work on these zones,
// while each record names its owner (`org.orgname`) — which can be checked,
// counted and logged (the `Data check` line says what arrived for each unit).
//
// Payments are not scoped. A payment only ever counts against an invoice
// that is held (views.buildInvoicingReport), so another unit's payment has
// nothing to count against.

// Every business unit the login can see.
const EVERY_UNIT = '*';
const NONE_GIVEN = '(none given)';

// Letters and digits only: "TTS - RMS", "tts rms" and "TTS RMS" are one name.
const plain = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

const tallyText = (received) =>
  Object.entries(received)
    .sort((a, b) => b[1] - a[1])
    .map(([name, count]) => `${name} (${count.toLocaleString('en-AU')})`)
    .join(', ');

// How one zone's records split by business unit, and which to keep.
//   keep(record)  true for a record the reports are for
//   summary       what arrived and what was kept — for /api/status and the log
//   warning       set when the records could not be limited, or none were left
function businessUnitScope(records, wanted = config.businessUnits) {
  const received = {};
  for (const r of records) {
    const name = r.businessUnit || NONE_GIVEN;
    received[name] = (received[name] || 0) + 1;
  }
  const summary = { reportsAreFor: wanted, received, kept: records.length, leftOut: 0, limited: false };
  const names = wanted.join(' + ');

  if (wanted.includes(EVERY_UNIT) || records.length === 0) {
    return { keep: () => true, summary: { ...summary, limited: !wanted.includes(EVERY_UNIT) }, warning: null };
  }
  // Not one record says whose it is: this zone does not carry the owner, so
  // there is nothing to go by. Keeping them and saying so beats showing an
  // empty report for the wrong reason.
  if (!records.some((r) => r.businessUnit)) {
    return {
      keep: () => true,
      summary,
      warning: `AroFlo did not say which business unit these belong to, so they could not be limited to ${names} — every one it sent is included`,
    };
  }

  const wantedPlain = new Set(wanted.map(plain));
  const keep = (r) => wantedPlain.has(plain(r.businessUnit));
  const kept = records.filter(keep).length;
  return {
    keep,
    summary: { ...summary, kept, leftOut: records.length - kept, limited: true },
    warning:
      kept === 0
        ? `none of the ${records.length.toLocaleString('en-AU')} AroFlo sent belong to ${names}, so none are shown. It sent: ${tallyText(received)}. The business unit is named in AROFLO_BUSINESS_UNITS`
        : null,
  };
}

module.exports = { businessUnitScope, plain, EVERY_UNIT };
