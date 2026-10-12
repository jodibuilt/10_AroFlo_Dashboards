const config = require('./config');
const logger = require('./logger');
const { fetchZonePaged } = require('./zoneFetch');
const { formatAroFloDate } = require('./aroflo/aroFloDates');

function lookbackDate() {
  const d = new Date();
  d.setDate(d.getDate() - config.payments.lookbackDays);
  return d;
}

// Mirrors aroflo_dash's fetch_payments fallback: AroFlo's own unfiltered
// default for this zone is a rolling ~30-day window ("datePaid > DATEADD(d,
// -30, GETUTCDATE())"); a wider explicit `where` is attempted first, and if
// AroFlo rejects that specific WHERE field, this falls back to the zone's
// own default rather than failing the whole Invoices tab. The rejection is
// now surfaced as a thrown AroFloApiError by AroFloClient.checkEnvelope's
// own safety net (matches on "not available in the" — confirmed live this
// session; AroFlo returns status "0" success alongside the rejection
// message, so this would otherwise silently return wrongly-scoped data
// with no error at all), not something detected here independently.
async function fetchPayments(client) {
  const where = () => [`and|datepaid|>=|${formatAroFloDate(lookbackDate())}`];
  try {
    return await fetchZonePaged(client, { zone: 'Payments', pluralKey: 'payments', singularKey: 'payment', where });
  } catch (err) {
    if (typeof err.message === 'string' && err.message.includes('not available in the')) {
      logger.warn('Payments zone rejected the datepaid WHERE filter — falling back to its own default range', {
        error: err.message,
      });
      return fetchZonePaged(client, { zone: 'Payments', pluralKey: 'payments', singularKey: 'payment' });
    }
    throw err;
  }
}

module.exports = { fetchPayments };
