const logger = require('./logger');
const { fetchZonePaged } = require('./zoneFetch');
const { formatAroFloDate } = require('./aroflo/aroFloDates');

// Payments from `since` on — the first day the reports cover (src/cache.js),
// which is far enough back for every invoice they hold, since a payment can't
// come before its invoice.
//
// Mirrors aroflo_dash's fetch_payments fallback: AroFlo's own unfiltered
// default for this zone is a rolling ~30-day window ("datePaid > DATEADD(d,
// -30, GETUTCDATE())"); a wider explicit `where` is attempted first, and if
// AroFlo rejects that specific WHERE field, this falls back to the zone's
// own default rather than failing the whole Invoices tab — and says so, as
// a warning the Invoicing page passes on. The rejection is surfaced as a
// thrown AroFloApiError by AroFloClient.checkEnvelope's own safety net
// (matches on "not available in the" — AroFlo returns status "0" success
// alongside the rejection message, so this would otherwise silently return
// wrongly-scoped data with no error at all), not something detected here
// independently.
async function fetchPayments(client, since) {
  const where = () => [`and|datepaid|>=|${formatAroFloDate(since)}`];
  try {
    return { records: await fetchZonePaged(client, { zone: 'Payments', pluralKey: 'payments', singularKey: 'payment', where }) };
  } catch (err) {
    if (typeof err.message === 'string' && err.message.includes('not available in the')) {
      logger.warn('Payments zone rejected the datepaid WHERE filter — falling back to its own default range', {
        error: err.message,
      });
      return {
        records: await fetchZonePaged(client, { zone: 'Payments', pluralKey: 'payments', singularKey: 'payment' }),
        warning: 'AroFlo would not filter payments by date, so only its default last 30 days of payments are loaded — invoices paid before then show as unpaid',
      };
    }
    throw err;
  }
}

module.exports = { fetchPayments };
