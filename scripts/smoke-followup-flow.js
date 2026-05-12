const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/vendors', require('../src/routes/vendors'));
app.use('/api/calls', require('../src/routes/calls'));
app.use('/api/tasks', require('../src/routes/tasks'));
app.use('/api/stages', require('../src/routes/stages'));
app.use('/api/deals', require('../src/routes/deals'));
const srv = app.listen(0, async () => {
  const port = srv.address().port;
  const base = 'http://127.0.0.1:' + port;
  const fail = (m) => { console.log('FAIL:', m); process.exit(1); };
  const ok = (m) => console.log('PASS:', m);
  const fetchJ = async (path, opts = {}) => {
    const r = await fetch(base + path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  const v = await fetchJ('/api/vendors?limit=1');
  if (v.status !== 200 || !v.body.rows) return fail('GET /api/vendors');
  ok('GET /api/vendors total=' + v.body.total);
  const aVendorId = v.body.rows[0].id;

  const s = await fetchJ('/api/stages');
  if (s.status !== 200 || !Array.isArray(s.body)) return fail('GET /api/stages');
  const names = s.body.map(x => x.name);
  if (!names.includes('Connected') || !names.includes('Visit / Demo')) return fail('stages: ' + names);
  ok('stages: ' + names.join(' → '));

  const c = await fetchJ('/api/calls', { method: 'POST', body: JSON.stringify({
    vendor_id: aVendorId, direction: 'out', disposition: 'connected',
    outcome: 'interested', duration_sec: 42, notes: 'smoke test', caller: 'You',
  })});
  if (c.status !== 200 || !c.body.id) return fail('POST /api/calls: ' + JSON.stringify(c.body));
  ok('POST /api/calls id=' + c.body.id);

  const list = await fetchJ('/api/calls?vendor_id=' + aVendorId);
  const got = list.body.find(r => r.id === c.body.id);
  if (!got || got.disposition !== 'connected' || got.caller !== 'You') return fail('round-trip: ' + JSON.stringify(got));
  ok('round-trip preserves disposition + caller');

  const stats = await fetchJ('/api/calls/stats/summary');
  if (typeof stats.body.connected !== 'number' || typeof stats.body.callbacks !== 'number') return fail('stats: ' + JSON.stringify(stats.body));
  ok('stats: connected=' + stats.body.connected + ' callbacks=' + stats.body.callbacks);

  const t = await fetchJ('/api/tasks', { method: 'POST', body: JSON.stringify({
    vendor_id: aVendorId, title: 'Follow up smoke', due_at: Date.now() + 86400000,
    priority: 'high', type: 'call', owner: 'You',
  })});
  if (t.status !== 200 || !t.body.id) return fail('POST /api/tasks: ' + JSON.stringify(t.body));
  ok('POST /api/tasks id=' + t.body.id);

  await fetchJ('/api/tasks/' + t.body.id, { method: 'PUT', body: JSON.stringify({ due_at: Date.now() + 7*86400000 }) });
  await fetchJ('/api/tasks/' + t.body.id, { method: 'PUT', body: JSON.stringify({ completed: true }) });
  ok('PUT /api/tasks (snooze + complete)');

  await fetchJ('/api/calls/' + c.body.id, { method: 'DELETE' });
  await fetchJ('/api/tasks/' + t.body.id, { method: 'DELETE' });
  ok('cleanup');
  srv.close();
});
