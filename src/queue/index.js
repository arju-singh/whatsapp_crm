// ---------------------------------------------------------------------------
// Queue facade. Selects the driver via QUEUE_DRIVER (memory | redis), owns the
// dead-letter table, and registers queue metrics. Business code depends only on
// this module — swapping memory↔redis is a config change, not a code change.
//
//   const queue = require('./queue');
//   queue.registerWorker('wa-send', handler, { concurrency: 1, paceMs });
//   queue.add('wa-send', { id }, { priority: true, attempts: 3 });
// ---------------------------------------------------------------------------

const db = require('../db');
const metrics = require('../metrics');

// Dead-letter sink — one row per job that exhausted its retries, for either
// driver. Portable DDL (matches the app's SQLite/Postgres-friendly conventions).
db.exec(`
CREATE TABLE IF NOT EXISTS dead_letter (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL,
  job_id TEXT,
  payload TEXT,
  error TEXT,
  attempts INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (strftime('%s','now') * 1000)
);
CREATE INDEX IF NOT EXISTS idx_dead_letter_type ON dead_letter(job_type, created_at);
`);

function deadLetter(jobType, jobId, payload, error, attempts) {
  db.prepare(`INSERT INTO dead_letter (job_type, job_id, payload, error, attempts) VALUES (?, ?, ?, ?, ?)`)
    .run(jobType, jobId == null ? null : String(jobId), payload == null ? null : JSON.stringify(payload).slice(0, 4000), (error || '').slice(0, 1000), attempts || 0);
}

const DRIVER = String(process.env.QUEUE_DRIVER || 'memory').toLowerCase();

let driver;
if (DRIVER === 'redis') {
  driver = require('./redis').createRedisDriver({ deadLetter });
} else {
  driver = require('./memory').createMemoryDriver({ deadLetter });
}

// --- Metrics registration ---------------------------------------------------
metrics.registerCounter('queue_jobs_enqueued_total', 'Jobs added to a queue');
metrics.registerCounter('queue_jobs_completed_total', 'Jobs processed successfully');
metrics.registerCounter('queue_jobs_retried_total', 'Job attempts that failed and were retried');
metrics.registerCounter('queue_jobs_deadlettered_total', 'Jobs that exhausted retries and were dead-lettered');
// Live queue depth (memory driver exposes it synchronously; redis reports via /readyz).
metrics.registerGauge('queue_depth', 'Waiting jobs per queue', () => {
  if (driver.key !== 'memory') return [];
  const s = driver.stats();
  return Object.entries(s).map(([type, v]) => ({ labels: { type }, value: v.waiting }));
});
metrics.registerGauge('queue_dead_letter_total', 'Rows in the dead-letter table', () => {
  try { return db.prepare('SELECT COUNT(*) c FROM dead_letter').get().c; } catch (_) { return 0; }
});

function add(jobType, data, opts = {}) {
  try {
    const r = driver.add(jobType, data, opts);
    // redis add is async — don't let a transient enqueue error crash the caller.
    if (r && typeof r.then === 'function') r.catch((e) => console.error('[queue] enqueue failed:', e.message));
    return r;
  } catch (e) {
    console.error('[queue] enqueue failed:', e.message);
    return null;
  }
}

module.exports = {
  driverKey: () => driver.key,
  isReady: () => driver.isReady(),
  add,
  registerWorker: (...a) => driver.registerWorker(...a),
  stats: (...a) => driver.stats(...a),
  deadLetterCount: () => { try { return db.prepare('SELECT COUNT(*) c FROM dead_letter').get().c; } catch (_) { return 0; } },
  close: (...a) => driver.close(...a),
};
