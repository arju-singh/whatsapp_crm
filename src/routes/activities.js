const express = require('express');
const db = require('../db');
const { orgFilter } = require('../tenancy');

const router = express.Router();

// Unified activity feed: messages + calls + tasks for a vendor (or globally)
router.get('/', (req, res) => {
  const { vendor_id, limit = 100 } = req.query;
  const filters = [orgFilter()];
  const params = { orgId: req.orgId, limit: Number(limit) };
  if (vendor_id) { filters.push('vendor_id = @vendor_id'); params.vendor_id = vendor_id; }
  const where = `WHERE ${filters.join(' AND ')}`;
  const rows = db.prepare(`
    SELECT * FROM (
      SELECT 'message' AS kind, id, vendor_id, direction AS sub, status, body AS detail, created_at FROM messages ${where}
      UNION ALL
      SELECT 'call' AS kind, id, vendor_id, direction AS sub, COALESCE(disposition,'') AS status,
        COALESCE(notes,'') AS detail, created_at FROM calls ${where}
      UNION ALL
      SELECT 'task' AS kind, id, vendor_id,
        CASE WHEN completed = 1 THEN 'done' ELSE 'open' END AS sub,
        COALESCE(priority,'') AS status, title AS detail, created_at FROM tasks ${where}
    ) ORDER BY created_at DESC LIMIT @limit
  `).all(params);
  res.json(rows);
});

module.exports = router;
