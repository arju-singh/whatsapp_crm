// Minimal, dependency-free .env loader. Reads KEY=VALUE lines from a .env file
// in the project root and sets them on process.env (without overriding values
// already present in the real environment). Supports # comments, optional
// surrounding quotes, and `export KEY=VALUE`. Require this FIRST in server.js,
// before any module that reads process.env at load time (email, billing, etc).
const fs = require('fs');
const path = require('path');

(function loadEnv() {
  const file = path.join(__dirname, '..', '.env');
  let raw;
  try { raw = fs.readFileSync(file, 'utf8'); } catch (_) { return; } // no .env — fine
  for (let line of raw.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    // A blank value (`KEY=`) means "leave unset" — don't clobber defaults or
    // pass empty strings to code that distinguishes '' from undefined (e.g. the
    // trust-proxy parser in server.js, which throws on an empty value).
    if (key && val !== '' && process.env[key] === undefined) process.env[key] = val;
  }
})();
