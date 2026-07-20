// Standalone worker process.
//
// With QUEUE_DRIVER=redis you run the stateless API (`npm start`) and one or more
// of these worker processes (`npm run worker`) side by side: the API enqueues
// jobs, the workers consume them. This is what makes the app horizontally
// scalable — N workers on N hosts pull from the shared Redis queue.
//
// With QUEUE_DRIVER=memory there is no separate worker (jobs run inside the API
// process); this entrypoint just says so and exits, so a process manager that
// always launches it doesn't error.
//
// Requiring ./src/whatsapp registers the 'wa-send' worker against the queue; add
// future job types the same way (their module registers a worker on load).

require('./src/loadenv');

const queue = require('./src/queue');

if (queue.driverKey() !== 'redis') {
  console.log(`[worker] QUEUE_DRIVER=${queue.driverKey()} — jobs run in-process in the API; no separate worker needed. Exiting.`);
  process.exit(0);
}

console.log('[worker] starting — QUEUE_DRIVER=redis');
// Registering the messaging module wires up its queue worker(s).
require('./src/whatsapp');
require('./src/email'); // email queue processor is DB-polled today; safe to load
console.log('[worker] workers registered; consuming jobs. Ctrl-C to stop.');

let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[worker] ${sig} — draining and closing…`);
  const hard = setTimeout(() => process.exit(1), 10_000); hard.unref();
  try { await queue.close({ timeoutMs: 8_000 }); } catch (_) {}
  try { require('./src/db').close(); } catch (_) {}
  clearTimeout(hard);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
