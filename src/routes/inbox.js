const express = require('express');
const db = require('../db');
const wa = require('../whatsapp');

const router = express.Router();

// Conversations list — one row per vendor with latest message + unread count
router.get('/', (req, res) => {
  const { q, limit = 100 } = req.query;
  const filter = q ? `AND (v.name LIKE @q OR v.phone LIKE @q OR v.company LIKE @q)` : '';
  const rows = db.prepare(`
    SELECT
      v.id AS vendor_id, v.name, v.phone, v.company, v.city, v.category, v.status,
      v.last_replied_at, v.last_contacted_at,
      (SELECT body FROM messages m WHERE m.vendor_id = v.id ORDER BY m.created_at DESC LIMIT 1) AS last_body,
      (SELECT direction FROM messages m WHERE m.vendor_id = v.id ORDER BY m.created_at DESC LIMIT 1) AS last_dir,
      (SELECT created_at FROM messages m WHERE m.vendor_id = v.id ORDER BY m.created_at DESC LIMIT 1) AS last_at,
      (SELECT COUNT(*) FROM messages m WHERE m.vendor_id = v.id AND m.direction = 'out') AS sent_count,
      (SELECT COUNT(*) FROM messages m WHERE m.vendor_id = v.id AND m.direction = 'in')  AS reply_count,
      (SELECT body  FROM messages m WHERE m.vendor_id = v.id AND m.direction = 'in' ORDER BY m.created_at DESC LIMIT 1) AS last_reply_body,
      (SELECT created_at FROM messages m WHERE m.vendor_id = v.id AND m.direction = 'in' ORDER BY m.created_at DESC LIMIT 1) AS last_reply_at,
      (SELECT COUNT(*) FROM messages m WHERE m.vendor_id = v.id AND m.direction = 'out' AND m.status = 'scheduled') AS scheduled_count,
      (SELECT COUNT(*) FROM messages m WHERE m.vendor_id = v.id AND m.direction = 'out' AND m.status = 'failed') AS failed_count,
      (SELECT COUNT(*) FROM messages m WHERE m.vendor_id = v.id AND m.direction = 'in' AND (v.last_contacted_at IS NULL OR m.created_at > COALESCE(v.last_contacted_at, 0))) AS unread
    FROM vendors v
    WHERE EXISTS (SELECT 1 FROM messages m WHERE m.vendor_id = v.id) ${filter}
    ORDER BY (last_at IS NULL), last_at DESC
    LIMIT @limit
  `).all({ q: q ? `%${q}%` : '', limit: Number(limit) });
  res.json(rows);
});

// Thread for one vendor
router.get('/:vendorId', (req, res) => {
  const vendor = db.prepare('SELECT * FROM vendors WHERE id = ?').get(req.params.vendorId);
  if (!vendor) return res.status(404).json({ error: 'vendor_not_found' });
  const messages = db.prepare(`
    SELECT id, direction, body, status, sent_at, delivered_at, read_at, created_at, error
    FROM messages WHERE vendor_id = ? ORDER BY created_at ASC LIMIT 500
  `).all(req.params.vendorId);
  const emails = db.prepare(`
    SELECT id, direction, to_email, subject, body_text, status, sent_at, opened_at, created_at, error
    FROM emails WHERE vendor_id = ? ORDER BY created_at ASC LIMIT 500
  `).all(req.params.vendorId);
  // Mark as "read" by bumping last_contacted_at to now (cheap heuristic for unread badge).
  db.prepare(`UPDATE vendors SET last_contacted_at = MAX(COALESCE(last_contacted_at, 0), ?) WHERE id = ?`)
    .run(Date.now(), req.params.vendorId);
  res.json({ vendor, messages, emails });
});

// Quick-reply via WhatsApp
router.post('/:vendorId/reply', (req, res) => {
  const { body } = req.body;
  if (!body) return res.status(400).json({ error: 'body_required' });
  const vendor = db.prepare('SELECT id FROM vendors WHERE id = ?').get(req.params.vendorId);
  if (!vendor) return res.status(404).json({ error: 'vendor_not_found' });
  const r = db.prepare(`
    INSERT INTO messages (vendor_id, direction, body, status) VALUES (?, 'out', ?, 'queued')
  `).run(vendor.id, body);
  wa.enqueueMessage(r.lastInsertRowid);
  res.json({ id: r.lastInsertRowid, queued: true });
});

module.exports = router;
