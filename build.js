#!/usr/bin/env node
/* Production build for the in-browser React app.
 *
 * The app's .jsx files are NOT ES modules — they share one global scope and are
 * loaded as separate <script type="text/babel"> tags in a fixed order, compiled
 * live by Babel-standalone from a CDN. That's slow and adds a hard CDN
 * dependency. This script transforms each file's JSX ahead of time and
 * concatenates them — in the exact same order — into a single minified
 * public/app.bundle.js. It then writes public/index.prod.html that loads the
 * bundle plus React's production builds instead of the dev + Babel scripts.
 *
 * We deliberately do NOT module-bundle: that would wrap each file in its own
 * scope and break the cross-file global references the app relies on. We use
 * esbuild's transform() (classic JSX -> React.createElement) and join the
 * outputs, preserving the shared top-level scope exactly as the browser had it.
 */
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PUBLIC = path.join(__dirname, 'public');

// Load order MUST match the <script type="text/babel"> order in index.html.
const FILES = [
  'data.jsx', 'icons.jsx', 'layout.jsx', 'tweaks-panel.jsx',
  'dashboard.jsx', 'contacts.jsx', 'deals.jsx', 'tasks-cal-inbox.jsx',
  'other-views.jsx', 'messaging.jsx', 'modals.jsx', 'ai-cmd.jsx',
  'users.jsx', 'app.jsx',
];

async function build() {
  const parts = [];
  for (const f of FILES) {
    const src = fs.readFileSync(path.join(PUBLIC, f), 'utf8');
    const out = await esbuild.transform(src, {
      loader: 'jsx',
      jsx: 'transform',                 // classic runtime -> React.createElement
      jsxFactory: 'React.createElement',
      jsxFragment: 'React.Fragment',
      target: 'es2018',
    });
    parts.push(`/* ${f} */\n${out.code}`);
  }
  // Concatenate, then minify the whole as ONE file so the shared top-level
  // scope is preserved. Keep identifier names (minifyIdentifiers:false) so
  // nothing that an inline <script> might reference gets renamed.
  const joined = parts.join('\n;\n');
  const min = await esbuild.transform(joined, {
    minify: true,
    minifyIdentifiers: false,
    legalComments: 'none',
  });
  const bundle = min.code;
  fs.writeFileSync(path.join(PUBLIC, 'app.bundle.js'), bundle);
  const hash = crypto.createHash('sha1').update(bundle).digest('hex').slice(0, 10);

  // Generate index.prod.html from index.html.
  let html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  html = html
    .replace('react@18.3.1/umd/react.development.js', 'react@18.3.1/umd/react.production.min.js')
    .replace('react-dom@18.3.1/umd/react-dom.development.js', 'react-dom@18.3.1/umd/react-dom.production.min.js')
    // drop Babel standalone (no longer needed)
    .replace(/\s*<script src="https:\/\/unpkg\.com\/@babel\/standalone[^>]*><\/script>/, '');
  // Remove every <script type="text/babel" ...> line and insert the bundle once.
  const firstBabel = html.match(/[ \t]*<script type="text\/babel"[^>]*><\/script>\n?/);
  html = html.replace(/[ \t]*<script type="text\/babel"[^>]*><\/script>\n?/g, '');
  const bundleTag = `  <script src="/app.bundle.js?v=${hash}"></script>\n`;
  if (firstBabel) {
    // put the bundle where the JSX scripts used to start
    html = html.replace('<script src="/analytics.js"', `${bundleTag}  <script src="/analytics.js"`);
  } else {
    html = html.replace('</body>', `${bundleTag}</body>`);
  }
  fs.writeFileSync(path.join(PUBLIC, 'index.prod.html'), html);

  const kb = (Buffer.byteLength(bundle) / 1024).toFixed(0);
  console.log(`[build] app.bundle.js  ${kb} KB  (hash ${hash})`);
  console.log(`[build] index.prod.html written`);
  console.log(`[build] done — server serves the prod build when NODE_ENV=production`);
}

build().catch((e) => { console.error('[build] FAILED:', e.message); process.exit(1); });
