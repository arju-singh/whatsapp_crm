// ---------------------------------------------------------------------------
// Redis / BullMQ queue driver (QUEUE_DRIVER=redis).
//
// Drop-in replacement for the memory driver that enables horizontal scaling: N
// stateless API processes enqueue jobs, N separate worker processes (worker.js)
// consume them. BullMQ provides durable jobs, retries with backoff, and a failed
// set; exhausted jobs are also mirrored into the dead_letter table so the DLQ is
// observable the same way regardless of driver.
//
// bullmq + ioredis are lazy-required so the memory default never needs them
// installed. Set QUEUE_PRODUCER_ONLY=1 on API processes that should enqueue but
// not consume (leave workers to worker.js).
// ---------------------------------------------------------------------------

const metrics = require('../metrics');

function loadBull() {
  try {
    // eslint-disable-next-line global-require
    return { bullmq: require('bullmq'), IORedis: require('ioredis') };
  } catch (e) {
    throw new Error('QUEUE_DRIVER=redis requires the "bullmq" and "ioredis" packages — run `npm install bullmq ioredis`. ' + e.message);
  }
}

function createRedisDriver({ deadLetter }) {
  const { bullmq, IORedis } = loadBull();
  const { Queue, Worker } = bullmq;
  const url = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  const producerOnly = process.env.QUEUE_PRODUCER_ONLY === '1';
  // BullMQ requires maxRetriesPerRequest=null on the connection it blocks on.
  const connection = new IORedis(url, { maxRetriesPerRequest: null });
  let ready = false;
  connection.on('ready', () => { ready = true; });
  connection.on('end', () => { ready = false; });
  connection.on('error', (e) => console.error('[queue:redis] connection error:', e.message));

  const queues = new Map();  // jobType -> Queue
  const workers = new Map(); // jobType -> Worker

  function queueFor(jobType) {
    if (!queues.has(jobType)) queues.set(jobType, new Queue(jobType, { connection }));
    return queues.get(jobType);
  }

  async function add(jobType, data, opts = {}) {
    metrics.inc('queue_jobs_enqueued_total', { type: jobType });
    const job = await queueFor(jobType).add(jobType, data, {
      jobId: opts.jobId,
      priority: opts.priority ? 1 : undefined,
      attempts: opts.attempts != null ? opts.attempts : 1,
      backoff: { type: 'exponential', delay: opts.backoffMs != null ? opts.backoffMs : 30_000 },
      removeOnComplete: 1000,
      removeOnFail: false, // keep in the failed set (DLQ)
    });
    return job.id;
  }

  function registerWorker(jobType, handler, opts = {}) {
    if (producerOnly) return; // this process only enqueues
    const worker = new Worker(jobType, async (job) => handler(job.data, { jobId: job.id, attempt: job.attemptsMade + 1 }), {
      connection,
      concurrency: opts.concurrency || 1,
      // paceMs → a per-type rate limit (jobs per pace window) to mirror the
      // memory driver's post-job delay / anti-ban throttle.
      ...(opts.paceMs ? { limiter: { max: 1, duration: Math.max(1, Number(typeof opts.paceMs === 'function' ? opts.paceMs() : opts.paceMs) || 0) } } : {}),
    });
    worker.on('completed', () => metrics.inc('queue_jobs_completed_total', { type: jobType }));
    worker.on('failed', (job, err) => {
      if (!job) return;
      if (job.attemptsMade < (job.opts.attempts || 1)) {
        metrics.inc('queue_jobs_retried_total', { type: jobType });
        return;
      }
      metrics.inc('queue_jobs_deadlettered_total', { type: jobType });
      try { deadLetter(jobType, job.id, job.data, err && err.message, job.attemptsMade); } catch (_) {}
    });
    worker.on('error', (e) => console.error(`[queue:redis:${jobType}] worker error:`, e.message));
    workers.set(jobType, worker);
  }

  async function stats(jobType) {
    if (jobType) {
      try {
        const c = await queueFor(jobType).getJobCounts('waiting', 'active', 'failed', 'delayed');
        return { waiting: c.waiting || 0, active: c.active || 0, failed: c.failed || 0, delayed: c.delayed || 0 };
      } catch (_) { return { waiting: 0, active: 0 }; }
    }
    const out = {};
    for (const t of queues.keys()) out[t] = await stats(t);
    return out;
  }

  async function close() {
    for (const w of workers.values()) { try { await w.close(); } catch (_) {} }
    for (const q of queues.values()) { try { await q.close(); } catch (_) {} }
    try { await connection.quit(); } catch (_) {}
  }

  function isReady() { return ready; }

  return { key: 'redis', add, registerWorker, stats, close, isReady };
}

module.exports = { createRedisDriver };
