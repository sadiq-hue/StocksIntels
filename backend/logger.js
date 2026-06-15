// Structured logger with timestamps, levels, and JSON support
const levels = { error: 0, warn: 1, info: 2, debug: 3 };
const levelNames = ['ERROR', 'WARN ', 'INFO ', 'DEBUG'];

function log(level, msg, meta) {
  if (level > (process.env.LOG_LEVEL ? levels[process.env.LOG_LEVEL] : levels.info)) return;
  const entry = {
    time: new Date().toISOString(),
    level: levelNames[level],
    msg,
    ...(meta ? (typeof meta === 'object' ? meta : { meta }) : {}),
  };
  const prefix = `[${entry.time}] [${entry.level}]`;
  const suffix = meta ? ' ' + JSON.stringify(meta, stringifySafe) : '';
  if (level === 0) console.error(prefix, msg, suffix);
  else if (level === 1) console.warn(prefix, msg, suffix);
  else console.log(prefix, msg, suffix);
}

function stringifySafe(k, v) {
  if (typeof v === 'object' && v !== null) {
    if (v instanceof Error) return v.message;
    const s = JSON.stringify(v);
    if (s && s.length > 500) return s.slice(0, 500) + '...';
  }
  return v;
}

module.exports = {
  error: (msg, meta) => log(0, msg, meta),
  warn: (msg, meta) => log(1, msg, meta),
  info: (msg, meta) => log(2, msg, meta),
  debug: (msg, meta) => log(3, msg, meta),
};
