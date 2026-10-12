const axios = require('axios');
const Bottleneck = require('bottleneck');
const {
  buildAuthorizationHeader,
  buildCanonicalPayload,
  signPayload,
  buildAuthHeaders,
} = require('./signing');
const { buildGetVarString } = require('./query');
const { AroFloAuthError, AroFloRateLimitError, AroFloApiError, isRetryable } = require('./errors');

/**
 * AroFlo API v1 client (HMAC-SHA512 signed, zone based) — READ-ONLY.
 *
 * Trimmed from test_all_aroflo's AroFloClient: the schedule/substatus write
 * methods and postZone() are deliberately not here, so this app has no code
 * path that can change anything in AroFlo. Everything the Reports tab shows
 * comes from getZone() GETs.
 */
class AroFloClient {
  constructor({
    baseUrl,
    secretKey,
    uEncoded,
    pEncoded,
    orgEncoded,
    accept = 'text/json',
    hostIp,
    rateLimitPerSecond = 3,
    rateLimitPerMinute = 120,
    logger,
  }) {
    if (!baseUrl) {
      throw new Error('AroFloClient requires AROFLO_API_BASE_URL to be set');
    }
    if (!secretKey || !uEncoded || !pEncoded || !orgEncoded) {
      throw new Error(
        'AroFloClient requires AROFLO_SECRET_KEY, AROFLO_UENCODED, AROFLO_PENCODED and AROFLO_ORG_ENCODED to be set'
      );
    }

    this.logger = logger || console;
    this.baseUrl = baseUrl;
    this.credentials = { uEncoded, pEncoded, orgEncoded };
    this.secretKey = secretKey;
    this.accept = accept;
    this.hostIp = hostIp || undefined;

    this.http = axios.create({ baseURL: baseUrl, timeout: 30000 });

    // AroFlo's documented limits are 3 req/s and 120 req/min; chain two
    // limiters so a full cache refresh respects both.
    const perSecond = new Bottleneck({
      reservoir: rateLimitPerSecond,
      reservoirRefreshAmount: rateLimitPerSecond,
      reservoirRefreshInterval: 1000,
      maxConcurrent: rateLimitPerSecond,
    });
    const perMinute = new Bottleneck({
      reservoir: rateLimitPerMinute,
      reservoirRefreshAmount: rateLimitPerMinute,
      reservoirRefreshInterval: 60000,
    });
    perSecond.chain(perMinute);
    this.limiter = perSecond;
  }

  // Tries the common AroFlo JSON shapes for a zone's records: nested under
  // pluralKey.singularKey (mirrors the XML), flat under pluralKey, flat
  // Confirmed live shape: data.zoneresponse.<lowercase plural zone name> is a
  // flat array (e.g. data.zoneresponse.tasks). The other candidates are
  // kept as fallbacks in case a different zone responds differently.
  extractRecords(data, pluralKey, singularKey) {
    const candidates = [
      data?.zoneresponse?.[pluralKey.toLowerCase()],
      data?.[pluralKey]?.[singularKey],
      data?.[pluralKey],
      data?.[singularKey],
      Array.isArray(data) ? data : undefined,
    ];

    for (const candidate of candidates) {
      if (Array.isArray(candidate)) {
        return candidate;
      }
      if (candidate && typeof candidate === 'object') {
        return [candidate];
      }
    }

    this.logger.debug(`No ${pluralKey}/${singularKey} records found in AroFlo response`, { data });
    return [];
  }

  async getZone(zone, options = {}) {
    const varString = buildGetVarString({ zone, ...options });
    return this.send(varString);
  }

  async send(varString, attempt = 1) {
    return this.limiter.schedule(async () => {
      const afDateTimeUtc = new Date().toISOString();
      const authorization = buildAuthorizationHeader(this.credentials);
      const payload = buildCanonicalPayload({
        method: 'GET',
        hostIp: this.hostIp,
        urlPath: '',
        accept: this.accept,
        authorization,
        afDateTimeUtc,
        varString,
      });
      const signature = signPayload(payload, this.secretKey);
      const headers = buildAuthHeaders({
        signature,
        authorization,
        accept: this.accept,
        afDateTimeUtc,
        hostIp: this.hostIp,
      });

      try {
        const response = await this.http.get(`?${varString}`, { headers });
        return this.checkEnvelope(response.data);
      } catch (err) {
        const mapped = this.mapError(err);
        if (isRetryable(mapped) && attempt < 3) {
          const delayMs = mapped instanceof AroFloRateLimitError ? 1000 * attempt : 0;
          this.logger.warn(`Retrying AroFlo GET request (attempt ${attempt + 1})`, {
            error: mapped.message,
            delayMs,
          });
          if (delayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
          return this.send(varString, attempt + 1);
        }
        throw mapped;
      }
    });
  }

  checkEnvelope(data) {
    const envelope = (data && (data.status !== undefined || data.statusmessage !== undefined))
      ? data
      : data?.imsapi;
    const status = envelope?.status;
    if (status !== undefined && Number(status) !== 0 && status !== 'success') {
      const message = envelope?.statusmessage || `AroFlo request failed with status ${status}`;
      if (Number(status) === -99999 || /authentication failed/i.test(message)) {
        throw new AroFloAuthError(message, { status });
      }
      if (/rate limit/i.test(message)) {
        throw new AroFloRateLimitError(message, { status });
      }
      throw new AroFloApiError(message, { status });
    }
    // AroFlo returns status "0" (success) even when a WHERE field name isn't
    // valid for the zone queried — it silently drops the clause and
    // substitutes its own default filter instead, so a caller trusting
    // status alone can end up scoping data completely differently than
    // requested with no visible error. Confirmed live: querying an invalid
    // WHERE field returns status "0" with statusmessage "...WHERE field(s)
    // X are not available in the Y zone... default filter applied" — verb
    // is "are" (plural "field(s)"), so this matches on "not available in
    // the" without "is"/"are" rather than depending on AroFlo's
    // pluralization. Treated as a hard failure here rather than silently
    // returning differently-filtered data. Deliberately narrow phrasing —
    // does NOT trigger on the separate, legitimate "No WHERE clause found,
    // default filter applied" message (an intentional no-WHERE call, not a
    // rejected field).
    const statusmessage = envelope?.statusmessage || '';
    if (/not available in the/i.test(statusmessage)) {
      throw new AroFloApiError(statusmessage, { status });
    }
    return data;
  }

  mapError(err) {
    if (err instanceof AroFloApiError) {
      return err;
    }
    const httpStatus = err.response?.status;
    const message = err.response?.data?.statusmessage || err.message;
    if (httpStatus === 401 || httpStatus === 403) {
      return new AroFloAuthError(message, { statusCode: httpStatus });
    }
    if (httpStatus === 429) {
      return new AroFloRateLimitError(message, { statusCode: httpStatus });
    }
    return new AroFloApiError(message, { statusCode: httpStatus });
  }
}

module.exports = AroFloClient;
