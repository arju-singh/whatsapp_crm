const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const db = require('../db');
const { body, S } = require('../validate');
const { orgFilter } = require('../tenancy');

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
  res.json(db.prepare(`SELECT * FROM templates WHERE ${orgFilter()} ORDER BY created_at DESC`).all({ orgId: req.orgId }));
});

const templateBodySchema = {
  name: S.string({ maxLength: 200 }),
  body: S.text(),
  category: S.string({ maxLength: 200 }),
};

router.post('/', body(templateBodySchema), (req, res) => {
  const { name, body, category } = req.body;
  if (!name || !body) return res.status(400).json({ error: 'name_and_body_required' });
  const r = db.prepare('INSERT INTO templates (organization_id, name, body, category) VALUES (?, ?, ?, ?)')
    .run(req.orgId, name, body, category || null);
  res.json({ id: r.lastInsertRowid });
});

router.put('/:id', body(templateBodySchema), (req, res) => {
  const { name, body, category } = req.body;
  db.prepare(`UPDATE templates SET name = COALESCE(@name, name), body = COALESCE(@body, body), category = COALESCE(@category, category), updated_at = @updated_at WHERE id = @id AND ${orgFilter()}`)
    .run({ name: name ?? null, body: body ?? null, category: category ?? null, updated_at: Date.now(), id: req.params.id, orgId: req.orgId });
  res.json({ ok: true });
});

router.post('/:id/media', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file_required' });
  const existing = db.prepare(`SELECT media_path FROM templates WHERE id = @id AND ${orgFilter()}`).get({ id: req.params.id, orgId: req.orgId });
  if (existing && existing.media_path && fs.existsSync(existing.media_path)) {
    try { fs.unlinkSync(existing.media_path); } catch (_) {}
  }
  db.prepare(`UPDATE templates SET media_path = @media_path, updated_at = @updated_at WHERE id = @id AND ${orgFilter()}`)
    .run({ media_path: req.file.path, updated_at: Date.now(), id: req.params.id, orgId: req.orgId });
  res.json({ ok: true, media_path: req.file.path, filename: req.file.originalname });
});

router.get('/:id/media-preview', (req, res) => {
  const t = db.prepare(`SELECT media_path FROM templates WHERE id = @id AND ${orgFilter()}`).get({ id: req.params.id, orgId: req.orgId });
  if (!t || !t.media_path || !fs.existsSync(t.media_path)) return res.status(404).end();
  res.sendFile(path.resolve(t.media_path));
});

router.delete('/:id/media', (req, res) => {
  const t = db.prepare(`SELECT media_path FROM templates WHERE id = @id AND ${orgFilter()}`).get({ id: req.params.id, orgId: req.orgId });
  if (t && t.media_path && fs.existsSync(t.media_path)) {
    try { fs.unlinkSync(t.media_path); } catch (_) {}
  }
  db.prepare(`UPDATE templates SET media_path = NULL, updated_at = @updated_at WHERE id = @id AND ${orgFilter()}`).run({ updated_at: Date.now(), id: req.params.id, orgId: req.orgId });
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  const t = db.prepare(`SELECT media_path FROM templates WHERE id = @id AND ${orgFilter()}`).get({ id: req.params.id, orgId: req.orgId });
  if (t && t.media_path && fs.existsSync(t.media_path)) {
    try { fs.unlinkSync(t.media_path); } catch (_) {}
  }
  db.prepare(`UPDATE templates SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`).run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

router.post('/delete-bulk', body({ ids: S.array({ of: S.int({ min: 1 }), maxItems: 10000 }) }), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_array_required' });
  const sel = db.prepare(`SELECT media_path FROM templates WHERE id = @id AND ${orgFilter()}`);
  const del = db.prepare(`UPDATE templates SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`);
  const tx = db.transaction((rows) => {
    for (const id of rows) {
      const t = sel.get({ id, orgId: req.orgId });
      if (t && t.media_path && fs.existsSync(t.media_path)) { try { fs.unlinkSync(t.media_path); } catch (_) {} }
      del.run({ id, orgId: req.orgId, now: Date.now() });
    }
  });
  tx(ids);
  res.json({ deleted: ids.length });
});

module.exports = router;
