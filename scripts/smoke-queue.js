// Queue abstraction smoke test — memory driver, NO Redis required.
//
// Covers: enqueue → process → complete, retry-with-backoff → dead-letter,
// priority ordering, and metrics counters. The redis (BullMQ) driver implements
// the same contract and is exercised only when a Redis server is available.

const os = require('os');
const path = require('path');
const fs = require('fs');

process.env.NODE_ENV = 'test';
process.env.QUEUE_DRIVER = 'memory';
const tmpDb = path.join(os.tmpdir(), `crm-queue-test-${process.pid}.db`);
for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
process.env.DB_PATH = tmpDb;

const db = require('../src/db');
require('../src/tenancy');
const queue = require('../src/queue');
const metrics = require('../src/metrics');

let failed = 0;
const ok = (m) => console.log('PASS:', m);
const fail = (m) => { failed++; console.error('FAIL:', m); };
const assert = (c, m) => (c ? ok(m) : fail(m));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) { if (pred()) return true; await sleep(10); }
  return pred();
}
const counter = (name, labels) => metrics.snapshot()[name + (labels ? `{${labels}}` : '')] || 0;

async function main() {
  assert(queue.driverKey() === 'memory', 'default queue driver is memory (no Redis needed)');
  assert(queue.isReady() === true, 'memory queue reports ready');

  // 1) enqueue → process → complete
  const processed = [];
  queue.registerWorker('t-basic', async (data) => { processed.push(data.v); });
  queue.add('t-basic', { v: 'hello' });
  await waitFor(() => processed.length === 1);
  assert(processed[0] === 'hello', 'job is processed with its payload');
  assert(counter('queue_jobs_enqueued_total', 'type="t-basic"') >= 1, 'enqueued counter incremented');
  assert(counter('queue_jobs_completed_total', 'type="t-basic"') >= 1, 'completed counter incremented');

  // 2) retry-with-backoff → dead-letter
  let calls = 0;
  queue.registerWorker('t-fail', async () => { calls += 1; throw new Error('boom'); });
  queue.add('t-fail', { x: 1 }, { attempts: 3, backoffMs: 10 });
  await waitFor(() => db.prepare("SELECT COUNT(*) c FROM dead_letter WHERE job_type='t-fail'").get().c > 0, 5000);
  assert(calls === 3, 'handler retried up to maxAttempts (3 calls)');
  const dl = db.prepare("SELECT * FROM dead_letter WHERE job_type='t-fail' ORDER BY id DESC LIMIT 1").get();
  assert(dl && dl.attempts === 3 && /boom/.test(dl.error || ''), 'exhausted job written to dead_letter with error + attempts');
  assert(counter('queue_jobs_retried_total', 'type="t-fail"') >= 2, 'retried counter incremented');
  assert(counter('queue_jobs_deadlettered_total', 'type="t-fail"') >= 1, 'dead-lettered counter incremented');
  assert(queue.deadLetterCount() >= 1, 'deadLetterCount reflects the DLQ row');

  // 3) priority ordering (concurrency 1): a priority job jumps ahead of a
  //    normal job enqueued before it.
  const order = [];
  queue.registerWorker('t-prio', async (d) => { order.push(d.id); await sleep(5); }, { concurrency: 1 });
  queue.add('t-prio', { id: 'A' });
  queue.add('t-prio', { id: 'B' });
  queue.add('t-prio', { id: 'P' }, { priority: true });
  await waitFor(() => order.length === 3);
  assert(order.indexOf('P') < order.indexOf('B'), 'priority job runs before a normal job queued earlier');

  // 4) metrics text exposition renders
  const text = metrics.render();
  assert(/# TYPE queue_jobs_completed_total counter/.test(text), '/metrics text includes queue counters');
  assert(/queue_depth/.test(text), '/metrics text includes queue_depth gauge');

  await queue.close({ timeoutMs: 2000 });
}

main()
  .catch((e) => fail('unexpected error: ' + (e && e.stack ? e.stack : e)))
  .finally(() => {
    try { db.close(); } catch (_) {}
    for (const s of ['', '-wal', '-shm']) { try { fs.unlinkSync(tmpDb + s); } catch (_) {} }
    console.log(failed ? `\nQUEUE TEST: FAILED (${failed})` : '\nQUEUE TEST: PASSED');
    process.exit(failed ? 1 : 0);
  });
