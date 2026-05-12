const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');

const router = express.Router();

const uploadDir = path.join(__dirname, '..', '..', 'data', 'media');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadDir,
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^A-Za-z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 16 * 1024 * 1024 },
});

router.get('/', (req, res) => {
  res.json(db.prepare('SELECT * FROM templates ORDER BY created_at DESC').all());
});

router.post('/', (req, res) => {
  const { name, body, category } = req.body;
  if (!name || !body) return res.status(400).json({ error: 'name_and_body_required' });
  const r = db.prepare('INSERT INTO templates (name, body, category) VALUES (?, ?, ?)')
    .run(name, body, category || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', (req, res) => {
  const { name, body, category } = req.body;
  db.prepare('UPDATE templates SET name = COALESCE(?, name), body = COALESCE(?, body), category = COALESCE(?, category), updated_at = ? WHERE id = ?')
    .run(name, body, category, Date.now(), req.params.id);
  res.json({ ok: true });
});

router.post('/:id/media', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file_required' });
  const existing = db.prepare('SELECT media_path FROM templates WHERE id = ?').get(req.params.id);
  if (existing && existing.media_path && fs.existsSync(existing.media_path)) {
    try { fs.unlinkSync(existing.media_path); } catch (_) {}
  }
  db.prepare('UPDATE templates SET media_path = ?, updated_at = ? WHERE id = ?')
    .run(req.file.path, Date.now(), req.params.id);
  res.json({ ok: true, media_path: req.file.path, filename: req.file.originalname });
});

router.get('/:id/media-preview', (req, res) => {
  const t = db.prepare('SELECT media_path FROM templates WHERE id = ?').get(req.params.id);
  if (!t || !t.media_path || !fs.existsSync(t.media_path)) return res.status(404).end();
  res.sendFile(path.resolve(t.media_path));
});

router.delete('/:id/media', (req, res) => {
  const t = db.prepare('SELECT media_path FROM templates WHERE id = ?').get(req.params.id);
  if (t && t.media_path && fs.existsSync(t.media_path)) {
    try { fs.unlinkSync(t.media_path); } catch (_) {}
  }
  db.prepare('UPDATE templates SET media_path = NULL, updated_at = ? WHERE id = ?').run(Date.now(), req.params.id);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const t = db.prepare('SELECT media_path FROM templates WHERE id = ?').get(req.params.id);
  if (t && t.media_path && fs.existsSync(t.media_path)) {
    try { fs.unlinkSync(t.media_path); } catch (_) {}
  }
  db.prepare('DELETE FROM templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
