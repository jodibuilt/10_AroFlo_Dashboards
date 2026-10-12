const { createHmac } = require('crypto');

/**
 * AroFlo API v1 HMAC-SHA512 request signing.
 * Canonical payload = METHOD + [HostIP] + urlPath + Accept + Authorization + afdatetimeutc + varString,
 * joined with "+", signed with the account's Secret Key.
 */

function buildAuthorizationHeader({ uEncoded, pEncoded, orgEncoded }) {
  const u = encodeURIComponent(uEncoded);
  const p = encodeURIComponent(pEncoded);
  const org = encodeURIComponent(orgEncoded);
  return `uencoded=${u}&pencoded=${p}&orgEncoded=${org}`;
}

function buildCanonicalPayload({ method, hostIp, urlPath, accept, authorization, afDateTimeUtc, varString }) {
  const parts = [method];
  if (hostIp) {
    parts.push(hostIp);
  }
  parts.push(urlPath || '');
  parts.push(accept);
  parts.push(authorization);
  parts.push(afDateTimeUtc);
  parts.push(varString);
  return parts.join('+');
}

function signPayload(payload, secretKey) {
  if (!secretKey) {
    throw new Error('AroFlo secret key is required for request signing');
  }
  return createHmac('sha512', secretKey).update(payload).digest('hex');
}

function buildAuthHeaders({ signature, authorization, accept, afDateTimeUtc, hostIp }) {
  const headers = {
    Authentication: `HMAC ${signature}`,
    Authorization: authorization,
    Accept: accept,
    afdatetimeutc: afDateTimeUtc,
  };
  if (hostIp) {
    headers.HostIP = hostIp;
  }
  return headers;
}

module.exports = {
  buildAuthorizationHeader,
  buildCanonicalPayload,
  signPayload,
  buildAuthHeaders,
};
