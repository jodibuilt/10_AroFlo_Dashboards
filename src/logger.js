const config = require('./config');

const LEVELS = ['error', 'warn', 'info', 'debug'];
const currentLevelIndex = LEVELS.includes(config.logLevel) ? LEVELS.indexOf(config.logLevel) : 2;

function log(level, message, meta) {
  if (LEVELS.indexOf(level) > currentLevelIndex) return;
  const ts = new Date().toISOString();
  const metaStr = meta && Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  const line = `[${ts}] ${level.toUpperCase()}: ${message}${metaStr}`;
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

module.exports = {
  error: (msg, meta) => log('error', msg, meta),
  warn: (msg, meta) => log('warn', msg, meta),
  info: (msg, meta) => log('info', msg, meta),
  debug: (msg, meta) => log('debug', msg, meta),
};
