// ---------------------------------------------------------------------------
// Minimal, dependency-free Prometheus metrics registry.
//
// Two metric kinds:
//   - counters: monotonically increasing, labeled (jobs processed, sends, etc.)
//   - gauges:   sampled on scrape via a callback (live queue depth, readiness)
//
// Exposed at GET /metrics in Prometheus text exposition format. Kept tiny so it
// adds no runtime deps; swap for prom-client later without changing call sites.
// ---------------------------------------------------------------------------

const counters = new Map(); // seriesKey -> number
const counterMeta = new Map(); // name -> help
const gauges = new Map();    // name -> { help, collect: () => number | [{labels, value}] }

function labelKey(labels) {
  const parts = Object.entries(labels || {})
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k}="${String(v).replace(/["\\\n]/g, '_')}"`)
    .sort();
  return parts.length ? `{${parts.join(',')}}` : '';
}

function inc(name, labels = {}, by = 1) {
  if (!counterMeta.has(name)) counterMeta.set(name, '');
  const key = name + labelKey(labels);
  counters.set(key, (counters.get(key) || 0) + by);
}

function registerCounter(name, help) {
  counterMeta.set(name, help || '');
}

// collect: () => number, or () => [{ labels: {...}, value: number }]
function registerGauge(name, help, collect) {
  gauges.set(name, { help: help || '', collect });
}

function render() {
  const lines = [];
  // Counters — group series by metric name for HELP/TYPE headers.
  const byName = new Map();
  for (const [key] of counters) {
    const name = key.split('{')[0];
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(key);
  }
  for (const [name, keys] of byName) {
    const help = counterMeta.get(name);
    if (help) lines.push(`# HELP ${name} ${help}`);
    lines.push(`# TYPE ${name} counter`);
    for (const key of keys.sort()) lines.push(`${key} ${counters.get(key)}`);
  }
  // Gauges — sampled now.
  for (const [name, g] of gauges) {
    if (g.help) lines.push(`# HELP ${name} ${g.help}`);
    lines.push(`# TYPE ${name} gauge`);
    let samples;
    try { samples = g.collect(); } catch (_) { samples = 0; }
    if (Array.isArray(samples)) {
      for (const s of samples) lines.push(`${name}${labelKey(s.labels)} ${Number(s.value) || 0}`);
    } else {
      lines.push(`${name} ${Number(samples) || 0}`);
    }
  }
  return lines.join('\n') + '\n';
}

// Snapshot of counters as a plain object (used by tests / health payloads).
function snapshot() {
  const out = {};
  for (const [k, v] of counters) out[k] = v;
  return out;
}

module.exports = { inc, registerCounter, registerGauge, render, snapshot };
