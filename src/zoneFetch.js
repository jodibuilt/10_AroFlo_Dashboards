const config = require('./config');
const logger = require('./logger');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Pages through a zone until AroFlo returns fewer than pageSize records, capped
// at maxPagesPerZone as a safety net. Shared by the dashboard cache and the
// trigger engine so both use identical, conservative pacing against v1.
//
// `join` is passed through to AroFlo explicitly — the v1 Tasks zone GET
// returns substatus as a present but permanently EMPTY key
// ({"substatusid": "", "substatus": ""}) unless the request includes
// join=substatus, and AroFlo returns status "0" (success) either way, so it
// fails silently. Same failure mode for the Inventory zone's stocklevels
// without join=stocklevels.
async function fetchZonePaged(client, { zone, pluralKey, singularKey, where, join }) {
  const records = [];
  let page = 1;
  while (page <= config.maxPagesPerZone) {
    const options = { page, pageSize: config.pageSize };
    if (where) options.where = where();
    if (join) options.join = join;
    // eslint-disable-next-line no-await-in-loop
    const data = await client.getZone(zone, options);
    const pageRecords = client.extractRecords(data, pluralKey, singularKey);
    records.push(...pageRecords);
    if (pageRecords.length < config.pageSize) break;
    page += 1;
    // eslint-disable-next-line no-await-in-loop
    await sleep(200);
  }
  if (page > config.maxPagesPerZone) {
    logger.warn(`Hit maxPagesPerZone fetching ${zone} — data may be incomplete this pass`, {
      maxPages: config.maxPagesPerZone,
    });
  }
  return records;
}

module.exports = { fetchZonePaged, sleep };
