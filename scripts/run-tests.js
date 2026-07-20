// Test runner. Spawns each smoke script as its own process and judges pass/fail
// by the printed sentinel rather than the process exit code.
//
// Why sentinel-based: on Windows, better-sqlite3 + libuv can abort during process
// teardown ("Assertion failed ... src\\win\\async.c") AFTER all assertions have
// run and printed their result. That abort corrupts the exit code, which — with a
// plain `a && b && c` chain — silently skipped later scripts. Judging by the
// explicit "... TEST: PASSED/FAILED" line each script prints keeps the suite
// reliable across platforms while still failing loudly on a real assertion.
const { spawnSync } = require('child_process');
const path = require('path');

const scripts = [
  'smoke-tenant-isolation.js',
  'smoke-cloud-provider.js',
  'smoke-queue.js',
  'smoke-security.js',
  'smoke-import-export.js',
  'smoke-webhook-verify.js',
];

let allOk = true;
for (const s of scripts) {
  const r = spawnSync(process.execPath, [path.join('scripts', s)], { encoding: 'utf8' });
  const out = `${r.stdout || ''}${r.stderr || ''}`;
  process.stdout.write(out);
  const passed = /TEST: PASSED/.test(out) && !/TEST: FAILED/.test(out) && !/^FAIL:/m.test(out);
  if (!passed) {
    allOk = false;
    console.error(`\n[run-tests] ${s} FAILED (no PASSED sentinel or a FAIL line was present)`);
  }
}
console.log(allOk ? '\nALL TEST SUITES PASSED' : '\nTEST SUITES FAILED');
process.exitCode = allOk ? 0 : 1;
