const express = require('express');
const db = require('../db');
const rateLimit = require('../ratelimit');

const router = express.Router();

function clientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || null;
}

// Public collector — the frontend beacon posts page views and events here.
// Rate-limited per IP to prevent flooding. Accepts a single event or a batch.
router.post('/collect', rateLimit({ bucket: 'analytics', max: 240, windowMs: 60 * 1000 }), (req, res) => {
  const body = req.body || {};
  const events = Array.isArray(body.events) ? body.events : [body];
  const ua = req.headers['user-agent'] || null;
  const ip = clientIp(req);
  const userId = req.user ? req.user.id : null;
  const ins = db.prepare(`
    INSERT INTO analytics_events (type, name, path, referrer, user_id, anon_id, props, ip, ua)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  let stored = 0;
  const tx = db.transaction((rows) => {
    for (const e of rows.slice(0, 50)) {
      if (!e || typeof e !== 'object') continue;
      const type = e.type === 'page' ? 'page' : 'event';
      ins.run(
        type,
        (e.name || null) && String(e.name).slice(0, 200),
        (e.path || null) && String(e.path).slice(0, 300),
        (e.referrer || null) && String(e.referrer).slice(0, 300),
        userId,
        (e.anon_id || null) && String(e.anon_id).slice(0, 64),
        e.props ? JSON.stringify(e.props).slice(0, 1000) : null,
        ip, ua,
      );
      stored++;
    }
  });
  try { tx(events); } catch (err) { return res.status(400).json({ error: err.message }); }
  res.json({ ok: true, stored });
});

// Authed summary — totals + top pages + daily series for the last N days.
router.get('/summary', (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  const since = Date.now() - days * 24 * 3600 * 1000;
  const totals = db.prepare(`
    SELECT
      SUM(CASE WHEN type='page' THEN 1 ELSE 0 END) AS page_views,
      SUM(CASE WHEN type='event' THEN 1 ELSE 0 END) AS events,
      COUNT(DISTINCT anon_id) AS visitors
    FROM analytics_events WHERE created_at >= ?
  `).get(since);
  const topPages = db.prepare(`
    SELECT path, COUNT(*) AS views FROM analytics_events
    WHERE type='page' AND created_at >= ? AND path IS NOT NULL
    GROUP BY path ORDER BY views DESC LIMIT 10
  `).all(since);
  const topEvents = db.prepare(`
    SELECT name, COUNT(*) AS count FROM analytics_events
    WHERE type='event' AND created_at >= ? AND name IS NOT NULL
    GROUP BY name ORDER BY count DESC LIMIT 10
  `).all(since);
  const daily = db.prepare(`
    SELECT date(created_at/1000,'unixepoch','localtime') AS day,
           SUM(CASE WHEN type='page' THEN 1 ELSE 0 END) AS views,
           COUNT(DISTINCT anon_id) AS visitors
    FROM analytics_events WHERE created_at >= ?
    GROUP BY day ORDER BY day ASC
  `).all(since);
  res.json({ totals, topPages, topEvents, daily, days });
});

module.exports = router;
