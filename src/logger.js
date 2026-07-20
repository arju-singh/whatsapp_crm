// ---------------------------------------------------------------------------
// Structured logger + request correlation.
//
// Levels: error < warn < info < debug (LOG_LEVEL, default info). Emits JSON lines
// in production (or LOG_JSON=1) for log aggregators, and human-readable lines in
// development. `child(bindings)` returns a logger that stamps every line with
// shared fields (e.g. a request id) so related lines can be correlated.
//
// This is the standard seam for NEW code and the request/error path. The existing
// console.* calls can migrate incrementally; they still print.
// ---------------------------------------------------------------------------

const crypto = require('crypto');

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };
const isProd = process.env.NODE_ENV === 'production';
const JSON_LOGS = process.env.LOG_JSON === '1' || isProd;
const THRESHOLD = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] ?? LEVELS.info;

function emit(level, msg, meta) {
  if (LEVELS[level] > THRESHOLD) return;
  if (JSON_LOGS) {
    let rec;
    try { rec = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...(meta || {}) }); }
    catch (_) { rec = JSON.stringify({ ts: new Date().toISOString(), level, msg }); }
    process.stdout.write(rec + '\n');
  } else {
    const suffix = meta && Object.keys(meta).length ? ' ' + safeInline(meta) : '';
    const line = `[${level}] ${msg}${suffix}`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
  }
}
function safeInline(o) { try { return JSON.stringify(o); } catch (_) { return '[unserializable]'; } }

function make(bindings) {
  const merge = (meta) => (bindings ? { ...bindings, ...(meta || {}) } : meta);
  return {
    error: (msg, meta) => emit('error', msg, merge(meta)),
    warn: (msg, meta) => emit('warn', msg, merge(meta)),
    info: (msg, meta) => emit('info', msg, merge(meta)),
    debug: (msg, meta) => emit('debug', msg, merge(meta)),
    child: (extra) => make({ ...(bindings || {}), ...extra }),
  };
}

const logger = make(null);

// Attach a request id (from an upstream proxy's X-Request-Id or a fresh one),
// echo it back, and expose req.log — a child logger bound to that id.
function requestId(req, res, next) {
  const id = String(req.headers['x-request-id'] || crypto.randomBytes(8).toString('hex')).slice(0, 64);
  req.id = id;
  req.log = logger.child({ req: id });
  res.setHeader('X-Request-Id', id);
  next();
}

// Log one structured line per API request on completion (method, path, status,
// latency, org). Mount after the tenant middleware so org is available.
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    if (!req.path || !req.path.startsWith('/api')) return;
    logger.info('request', {
      req: req.id, method: req.method, path: req.path,
      status: res.statusCode, ms: Date.now() - start,
      org: req.orgId || null, user: (req.user && req.user.id) || null,
    });
  });
  next();
}

module.exports = Object.assign(logger, { requestId, requestLogger, child: logger.child });
