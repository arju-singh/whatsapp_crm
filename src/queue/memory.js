// ---------------------------------------------------------------------------
// In-process queue driver (default — QUEUE_DRIVER=memory).
//
// Preserves the app's original single-process behavior: jobs run in this process,
// with per-job-type concurrency, priority-front insertion, and an optional pacing
// delay after each job (used to rate-limit WhatsApp sends / avoid bans). Adds what
// the ad-hoc array lacked: bounded retries with exponential backoff, a dead-letter
// sink for exhausted jobs, graceful drain, and metrics.
//
// No Redis, no extra deps — the rollback-safe default. The redis (BullMQ) driver
// is a drop-in replacement for horizontal scaling.
// ---------------------------------------------------------------------------

const metrics = require('../metrics');

function createMemoryDriver({ deadLetter }) {
  const types = new Map(); // jobType -> { queue:[], active, worker }
  const retryTimers = new Set();
  let closing = false;
  let seq = 0;

  function typeState(jobType) {
    if (!types.has(jobType)) types.set(jobType, { queue: [], active: 0, worker: null });
    return types.get(jobType);
  }

  function add(jobType, data, opts = {}) {
    const st = typeState(jobType);
    const jobId = opts.jobId || `${jobType}:${++seq}`;
    const job = {
      jobId,
      data,
      priority: !!opts.priority,
      attempts: 0,
      maxAttempts: opts.attempts != null ? opts.attempts : 1,
      backoffMs: opts.backoffMs != null ? opts.backoffMs : 30_000,
    };
    if (job.priority) st.queue.unshift(job); else st.queue.push(job);
    metrics.inc('queue_jobs_enqueued_total', { type: jobType });
    setImmediate(() => pump(jobType));
    return jobId;
  }

  function registerWorker(jobType, handler, opts = {}) {
    const st = typeState(jobType);
    st.worker = {
      handler,
      concurrency: opts.concurrency || 1,
      paceMs: typeof opts.paceMs === 'function' ? opts.paceMs : () => Number(opts.paceMs) || 0,
    };
    setImmediate(() => pump(jobType));
  }

  async function runJob(jobType, job) {
    const st = typeState(jobType);
    const { handler, paceMs } = st.worker;
    try {
      await handler(job.data, { jobId: job.jobId, attempt: job.attempts + 1 });
      metrics.inc('queue_jobs_completed_total', { type: jobType });
    } catch (e) {
      job.attempts += 1;
      const errMsg = (e && e.message) ? e.message : String(e);
      if (job.attempts < job.maxAttempts && !closing) {
        metrics.inc('queue_jobs_retried_total', { type: jobType });
        const delay = Math.min(60 * 60 * 1000, job.backoffMs * Math.pow(2, job.attempts - 1));
        const t = setTimeout(() => {
          retryTimers.delete(t);
          if (closing) return;
          if (job.priority) st.queue.unshift(job); else st.queue.push(job);
          pump(jobType);
        }, delay);
        retryTimers.add(t);
      } else {
        metrics.inc('queue_jobs_deadlettered_total', { type: jobType });
        try { deadLetter(jobType, job.jobId, job.data, errMsg, job.attempts); } catch (_) {}
      }
    } finally {
      // Pacing: wait AFTER the job before freeing the concurrency slot, so a
      // per-type rate limit (e.g. WhatsApp anti-ban delay) is honored.
      let wait = 0;
      try { wait = Math.max(0, paceMs() || 0); } catch (_) {}
      if (wait) await new Promise((r) => setTimeout(r, wait));
      st.active -= 1;
      pump(jobType);
    }
  }

  function pump(jobType) {
    const st = types.get(jobType);
    if (!st || !st.worker || closing) return;
    while (st.active < st.worker.concurrency && st.queue.length) {
      const job = st.queue.shift();
      st.active += 1;
      runJob(jobType, job); // fire-and-forget; slot freed in finally
    }
  }

  function stats(jobType) {
    if (jobType) {
      const st = types.get(jobType) || { queue: [], active: 0 };
      return { waiting: st.queue.length, active: st.active };
    }
    const out = {};
    for (const [t, st] of types) out[t] = { waiting: st.queue.length, active: st.active };
    return out;
  }

  async function close({ timeoutMs = 10_000 } = {}) {
    closing = true;
    for (const t of retryTimers) clearTimeout(t);
    retryTimers.clear();
    const start = Date.now();
    const anyActive = () => [...types.values()].some((s) => s.active > 0);
    while (anyActive() && Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  function isReady() { return true; }

  return { key: 'memory', add, registerWorker, stats, close, isReady };
}

module.exports = { createMemoryDriver };
