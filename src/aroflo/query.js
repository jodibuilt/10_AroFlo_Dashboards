function encodeValue(value) {
  return encodeURIComponent(String(value));
}

function appendParam(parts, key, value) {
  parts.push(`${key}=${encodeValue(value)}`);
}

function buildGetVarString({ zone, where = [], order = [], join = [], page, pageSize }) {
  const parts = [];
  appendParam(parts, 'zone', zone);
  for (const clause of where) {
    appendParam(parts, 'where', clause);
  }
  for (const clause of order) {
    appendParam(parts, 'order', clause);
  }
  for (const clause of join) {
    appendParam(parts, 'join', clause);
  }
  if (typeof page === 'number') {
    appendParam(parts, 'page', page);
  }
  if (typeof pageSize === 'number') {
    appendParam(parts, 'pageSize', pageSize);
  }
  return parts.join('&');
}

module.exports = { buildGetVarString };
