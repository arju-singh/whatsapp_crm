// Smoke-test the messaging API surface used by the new UI:
// templates CRUD + media URLs + preview + bulk-send + campaigns list.
// Does NOT actually send via WhatsApp — just exercises the queue + DB.
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use('/api/templates', require('../src/routes/templates'));
app.use('/api/messages',  require('../src/routes/messages'));
app.use('/api/campaigns', require('../src/routes/campaigns'));
app.use('/api/vendors',   require('../src/routes/vendors'));

const srv = app.listen(0, async () => {
  const base = 'http://127.0.0.1:' + srv.address().port;
  let failed = false;
  const fail = (m) => { failed = true; console.log('FAIL:', m); };
  const ok = (m) => console.log('PASS:', m);
  const fetchJ = async (p, opts = {}) => {
    const r = await fetch(base + p, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };

  // Use one real vendor for preview/bulk
  const v = await fetchJ('/api/vendors?limit=1');
  if (!v.body.rows?.length) return fail('no vendors to test against');
  const vendorId = v.body.rows[0].id;
  ok(`using vendor #${vendorId} (${v.body.rows[0].name})`);

  // 1) CREATE template
  const t1 = await fetchJ('/api/templates', { method: 'POST', body: JSON.stringify({
    name: 'Smoke · Intro',
    body: 'Hi {{name}}, this is Arju from Petscare. Visit https://example.com',
    category: 'outreach',
  })});
  if (t1.status !== 200 || !t1.body.id) return fail('POST template: ' + JSON.stringify(t1));
  const tplId = t1.body.id;
  ok('POST /api/templates id=' + tplId);

  // 2) GET list returns it
  const list = await fetchJ('/api/templates');
  if (!Array.isArray(list.body) || !list.body.find((t) => t.id === tplId)) return fail('GET templates list');
  ok('GET /api/templates list');

  // 3) UPDATE
  const u = await fetchJ('/api/templates/' + tplId, { method: 'PUT', body: JSON.stringify({ category: 'updated' }) });
  if (u.status !== 200) return fail('PUT template');
  ok('PUT /api/templates');

  // 4) Render preview with vendor data
  const pv = await fetchJ('/api/messages/preview', { method: 'POST', body: JSON.stringify({ vendor_id: vendorId, template_id: tplId }) });
  if (pv.status !== 200 || !pv.body.rendered) return fail('preview: ' + JSON.stringify(pv));
  if (!pv.body.rendered.includes('Arju') || pv.body.rendered.includes('{{')) return fail('vars not interpolated: ' + pv.body.rendered);
  ok('POST /api/messages/preview → "' + pv.body.rendered.slice(0, 60) + '…"');

  // 5) Single send queues a message row
  const single = await fetchJ('/api/messages/send', { method: 'POST', body: JSON.stringify({
    vendor_id: vendorId, template_id: tplId,
  })});
  if (single.status !== 200 || !single.body.id) return fail('single send: ' + JSON.stringify(single));
  ok('POST /api/messages/send id=' + single.body.id);

  // 5b) Schedule a single send 1 hour out → status='scheduled', no immediate enqueue
  const future = Date.now() + 3600_000;
  const sched = await fetchJ('/api/messages/send', { method: 'POST', body: JSON.stringify({
    vendor_id: vendorId, template_id: tplId, scheduled_at: future,
  })});
  if (sched.status !== 200 || !sched.body.id || sched.body.queued !== false) return fail('scheduled send: ' + JSON.stringify(sched));
  ok('POST /api/messages/send (scheduled +1h) id=' + sched.body.id);
  // verify status in DB
  const db = require('../src/db');
  const row = db.prepare('SELECT status, scheduled_at FROM messages WHERE id = ?').get(sched.body.id);
  if (row.status !== 'scheduled' || row.scheduled_at !== future) return fail('scheduled row: ' + JSON.stringify(row));
  ok('scheduled row stored: status=' + row.status + ' at=' + new Date(row.scheduled_at).toISOString());

  // 5c) DELETE the scheduled message → status=cancelled
  const del = await fetchJ('/api/messages/' + sched.body.id, { method: 'DELETE' });
  if (del.status !== 200) return fail('delete scheduled: ' + JSON.stringify(del));
  const after = db.prepare('SELECT status FROM messages WHERE id = ?').get(sched.body.id);
  if (after.status !== 'cancelled') return fail('cancel did not change status: ' + JSON.stringify(after));
  ok('DELETE /api/messages/:id (cancelled scheduled)');

  // 6) Bulk send creates a campaign + N messages
  const bulkVendors = v.body.rows.slice(0, 1).map((r) => r.id); // just 1 for smoke
  const bulk = await fetchJ('/api/messages/bulk', { method: 'POST', body: JSON.stringify({
    vendor_ids: bulkVendors, template_id: tplId, campaign_name: 'Smoke campaign',
  })});
  if (bulk.status !== 200 || !bulk.body.campaign_id) return fail('bulk: ' + JSON.stringify(bulk));
  ok('POST /api/messages/bulk campaign=' + bulk.body.campaign_id + ' queued=' + bulk.body.queued);

  // 7) Campaign list reflects it
  const camps = await fetchJ('/api/campaigns');
  if (!Array.isArray(camps.body) || !camps.body.find((c) => c.id === bulk.body.campaign_id)) return fail('campaigns list');
  ok('GET /api/campaigns includes new campaign');

  // 8) Stats by template returns the row (joined through campaigns, so 1 from bulk)
  const stats = await fetchJ('/api/messages/stats/by-template');
  const stat = stats.body.find((s) => s.template_id === tplId);
  if (!stat || stat.sent < 1) return fail('stats by-template: ' + JSON.stringify(stat));
  ok('GET /api/messages/stats/by-template sent=' + stat.sent);

  // 9) Cleanup messages, campaign, template
  // (Templates DELETE cascades to campaigns via FK SET NULL; messages stay queued — clear them so worker won't try to deliver)
  await new Promise((r) => setTimeout(r, 100));
  db.prepare("DELETE FROM messages WHERE campaign_id = ? OR (vendor_id = ? AND status IN ('queued','scheduled','cancelled'))").run(bulk.body.campaign_id, vendorId);
  await fetchJ('/api/campaigns/' + bulk.body.campaign_id, { method: 'DELETE' });
  await fetchJ('/api/templates/' + tplId, { method: 'DELETE' });
  ok('cleanup');

  srv.close();
  if (failed) process.exit(1);
});
