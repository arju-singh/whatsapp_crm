const express = require('express');
const multer = require('multer');
const { parse } = require('csv-parse/sync');
const XLSX = require('xlsx');
const db = require('../db');
const { body, S } = require('../validate');
const { orgFilter } = require('../tenancy');

let phoneLib;
try { phoneLib = require('libphonenumber-js'); } catch (_) {}

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const DEFAULT_COUNTRY_CODE = process.env.DEFAULT_COUNTRY_CODE || '91';
const DEFAULT_REGION = process.env.DEFAULT_REGION || 'IN';

// CSV/Formula injection defence (OWASP): a cell whose text starts with = + - @
// or a leading tab/CR is interpreted as a formula by Excel/Sheets/LibreOffice
// when the export is opened, so a contact named `=cmd|'/c calc'!A1` would execute.
// Prefix any such value with a single quote so it is treated as literal text.
function neutralizeFormula(v) {
  if (v == null) return v;
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

// Prototype-pollution defense for imported spreadsheet/CSV rows: a crafted file
// with a `__proto__` / `constructor` / `prototype` header could otherwise taint
// object prototypes when the row is read. Copy only safe own keys onto a
// null-prototype object. (xlsx@0.18.5 has known proto-pollution/ReDoS with no npm
// fix — this narrows our exposure; replacing the parser remains recommended.)
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function sanitizeRecord(r) {
  const out = Object.create(null);
  if (r && typeof r === 'object') {
    for (const k of Object.keys(r)) {
      if (DANGEROUS_KEYS.has(k)) continue;
      out[k] = r[k];
    }
  }
  return out;
}

const normalizePhone = (p) => require('../phone').normalizePhone(p, DEFAULT_COUNTRY_CODE);

function validatePhone(p) {
  const normalized = normalizePhone(p);
  if (normalized.length < 11 || normalized.length > 15) {
    return { ok: false, normalized, reason: 'wrong_length' };
  }
  if (phoneLib) {
    try {
      const parsed = phoneLib.parsePhoneNumberFromString('+' + normalized);
      if (!parsed || !parsed.isValid()) return { ok: false, normalized, reason: 'invalid_for_region' };
    } catch (_) {
      return { ok: false, normalized, reason: 'parse_failed' };
    }
  }
  return { ok: true, normalized };
}

router.get('/', (req, res) => {
  const { q, status, category, limit, offset = 0 } = req.query;
  // Hard-cap the page size so a single request can never pull ~1M rows into
  // memory (the previous default). Default is generous (2000) so the current
  // non-paginated UI keeps showing every contact; max 5000. NOTE: once a tenant
  // exceeds ~2000 contacts the list needs real frontend pagination (offset is
  // already supported here) — tracked as a follow-up.
  const safeLimit = Math.min(Math.max(Number(limit) || 2000, 1), 5000);
  const safeOffset = Math.max(Number(offset) || 0, 0);
  const filters = [orgFilter()];
  const params = { orgId: req.orgId };
  if (q) {
    filters.push('(name LIKE @q OR phone LIKE @q OR company LIKE @q OR email LIKE @q)');
    params.q = `%${q}%`;
  }
  if (status) { filters.push('status = @status'); params.status = status; }
  if (category) { filters.push('category = @category'); params.category = category; }
  const where = `WHERE ${filters.join(' AND ')}`;
  const rows = db.prepare(`
    SELECT * FROM vendors ${where}
    ORDER BY updated_at DESC LIMIT @limit OFFSET @offset
  `).all({ ...params, limit: safeLimit, offset: safeOffset });
  const total = db.prepare(`SELECT COUNT(*) c FROM vendors ${where}`).get(params).c;
  res.json({ rows, total });
});

router.get('/export.csv', (req, res) => {
  const { q, status, category } = req.query;
  const filters = [orgFilter()];
  const params = { orgId: req.orgId };
  if (q) { filters.push('(name LIKE @q OR phone LIKE @q OR company LIKE @q OR email LIKE @q)'); params.q = `%${q}%`; }
  if (status) { filters.push('status = @status'); params.status = status; }
  if (category) { filters.push('category = @category'); params.category = category; }
  const where = `WHERE ${filters.join(' AND ')}`;
  const rows = db.prepare(`SELECT * FROM vendors ${where} ORDER BY updated_at DESC`).all(params);
  const cols = ['id', 'name', 'phone', 'company', 'email', 'category', 'tags', 'status', 'notes',
    'last_contacted_at', 'last_replied_at', 'total_sent', 'total_replied', 'created_at'];
  const esc = (v) => {
    if (v == null) return '';
    const s = neutralizeFormula(String(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const fmtTs = (v) => v ? new Date(v).toISOString() : '';
  const tsCols = new Set(['last_contacted_at', 'last_replied_at', 'created_at']);
  const lines = [cols.join(',')];
  for (const r of rows) lines.push(cols.map((c) => esc(tsCols.has(c) ? fmtTs(r[c]) : r[c])).join(','));
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="vendors-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(lines.join('\n'));
});

router.get('/stats/summary', (req, res) => {
  const totals = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) AS new_count,
      SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) AS contacted,
      SUM(CASE WHEN status = 'replied' THEN 1 ELSE 0 END) AS replied,
      SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) AS lost
    FROM vendors WHERE ${orgFilter()}
  `).get({ orgId: req.orgId });
  const byCategory = db.prepare(`
    SELECT COALESCE(category, 'uncategorized') AS category, COUNT(*) AS c
    FROM vendors WHERE ${orgFilter()} GROUP BY category ORDER BY c DESC
  `).all({ orgId: req.orgId });
  res.json({ totals, byCategory });
});

const IMPORT_COLUMNS = ['name', 'phone', 'company', 'email', 'category', 'tags', 'notes', 'title', 'address', 'city', 'hours'];

// Multiple template variants — each defines what columns appear and 1-2 sample rows.
// Importers still recognise ALL columns by name regardless of which template the
// file was generated from.
const TEMPLATES = {
  basic: {
    label: 'Basic — name + phone',
    description: 'Just the essentials. Best for quick bulk add.',
    columns: ['name', 'phone'],
    samples: [
      { name: 'Riya Sharma', phone: '+91 98765 43210' },
      { name: 'Karan Mehta', phone: '+91 91234 56789' },
    ],
  },
  standard: {
    label: 'Standard — full contact',
    description: 'Everything: company, email, address, hours, notes. Best for new customer onboarding.',
    columns: IMPORT_COLUMNS,
    samples: [{
      name: 'Acme Traders', phone: '+91 98765 43210',
      company: 'Acme Traders Pvt Ltd', email: 'contact@acme.example',
      category: 'wholesale', tags: 'priority,reorder',
      notes: 'Met at trade show — follow up next week',
      title: 'Owner', address: '12 MG Road', city: 'Bengaluru',
      hours: 'Mon–Sat 10:00–19:00',
    }],
  },
  'pet-store': {
    label: 'Pet store / Vet',
    description: 'Pet-business focused — category=clinic/shop/vet, hours, address.',
    columns: ['name', 'phone', 'company', 'category', 'address', 'city', 'hours', 'notes', 'tags'],
    samples: [
      {
        name: 'Petscare Hisar', phone: '+91 99887 76655',
        company: 'Petscare Hisar', category: 'pet-store',
        address: 'Sector 14', city: 'Hisar', hours: 'Mon–Sun 09:00–21:00',
        notes: 'Stocks premium food brands; potential reseller',
        tags: 'pet,priority',
      },
      {
        name: 'Dr. Reema Vet Clinic', phone: '+91 98112 33445',
        company: 'Reema Pet Hospital', category: 'vet',
        address: 'NH-44 Bypass', city: 'Chandigarh', hours: 'Mon–Sat 10:00–20:00',
        notes: 'Specialises in surgery; interested in equipment',
        tags: 'vet,doctor',
      },
    ],
  },
  'wa-bulk': {
    label: 'WhatsApp bulk send',
    description: 'Minimal columns for bulk WA campaigns. Just name + phone — fast to fill.',
    columns: ['name', 'phone', 'tags'],
    samples: [
      { name: 'Aman', phone: '+91 99887 76655', tags: 'campaign-may' },
      { name: 'Bhavna', phone: '+91 98109 87654', tags: 'campaign-may' },
    ],
  },
  sales: {
    label: 'Sales leads',
    description: 'Sales pipeline data — title, company, notes, tags for qualification.',
    columns: ['name', 'phone', 'company', 'title', 'email', 'category', 'tags', 'notes'],
    samples: [{
      name: 'Devika Rao', phone: '+91 98765 11122',
      company: 'Aperture Labs', title: 'CTO',
      email: 'devika@aperture.example', category: 'software',
      tags: 'enterprise,decision-maker',
      notes: 'Demo scheduled — interested in API tier',
    }],
  },
};

router.get('/templates', (req, res) => {
  res.json(Object.entries(TEMPLATES).map(([key, t]) => ({
    key, label: t.label, description: t.description, columns: t.columns,
  })));
});

function pickTemplate(req) {
  const key = req.query.type || 'standard';
  return TEMPLATES[key] || TEMPLATES.standard;
}

router.get('/template.xlsx', (req, res) => {
  const tpl = pickTemplate(req);
  const cols = tpl.columns;
  const rows = [cols, ...tpl.samples.map((s) => cols.map((c) => s[c] || ''))];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = cols.map((c) => ({ wch: c === 'notes' || c === 'address' ? 28 : Math.max(c.length + 2, 14) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Vendors');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('content-disposition', `attachment; filename="vendors-${req.query.type || 'standard'}.xlsx"`);
  res.send(buf);
});

router.get('/template.csv', (req, res) => {
  const tpl = pickTemplate(req);
  const cols = tpl.columns;
  const esc = (v) => {
    if (v == null) return '';
    const s = neutralizeFormula(String(v));
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(',')];
  for (const s of tpl.samples) lines.push(cols.map((c) => esc(s[c] || '')).join(','));
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', `attachment; filename="vendors-${req.query.type || 'standard'}.csv"`);
  res.send(lines.join('\n'));
});

router.get('/export.xlsx', (req, res) => {
  const { q, status, category } = req.query;
  const filters = [orgFilter()];
  const params = { orgId: req.orgId };
  if (q) { filters.push('(name LIKE @q OR phone LIKE @q OR company LIKE @q OR email LIKE @q)'); params.q = `%${q}%`; }
  if (status) { filters.push('status = @status'); params.status = status; }
  if (category) { filters.push('category = @category'); params.category = category; }
  const where = `WHERE ${filters.join(' AND ')}`;
  const rows = db.prepare(`SELECT * FROM vendors ${where} ORDER BY updated_at DESC`).all(params);
  const cols = ['id', 'name', 'phone', 'company', 'email', 'category', 'tags', 'status', 'notes',
    'title', 'address', 'city', 'hours',
    'last_contacted_at', 'last_replied_at', 'total_sent', 'total_replied', 'created_at'];
  const tsCols = new Set(['last_contacted_at', 'last_replied_at', 'created_at']);
  const fmtTs = (v) => v ? new Date(v).toISOString() : '';
  const data = [cols, ...rows.map((r) => cols.map((c) => tsCols.has(c) ? fmtTs(r[c]) : (r[c] == null ? '' : neutralizeFormula(r[c]))))];
  const ws = XLSX.utils.aoa_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Vendors');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('content-disposition', `attachment; filename="vendors-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.send(buf);
});

router.get('/:id', (req, res) => {
  const v = db.prepare(`SELECT * FROM vendors WHERE id = @id AND ${orgFilter()}`)
    .get({ id: req.params.id, orgId: req.orgId });
  if (!v) return res.status(404).json({ error: 'not_found' });
  // Children inherit the vendor's org; still filter on org + soft-delete defensively.
  const messages = db.prepare(`
    SELECT * FROM messages WHERE vendor_id = @id AND ${orgFilter()} ORDER BY created_at DESC LIMIT 200
  `).all({ id: req.params.id, orgId: req.orgId });
  const calls = db.prepare(`
    SELECT * FROM calls WHERE vendor_id = @id AND ${orgFilter()} ORDER BY created_at DESC LIMIT 100
  `).all({ id: req.params.id, orgId: req.orgId });
  const tasks = db.prepare(`
    SELECT * FROM tasks WHERE vendor_id = @id AND ${orgFilter()} ORDER BY completed ASC, due_at ASC NULLS LAST, created_at DESC LIMIT 50
  `).all({ id: req.params.id, orgId: req.orgId });
  const pendingFollowups = db.prepare(`
    SELECT f.*, r.name AS rule_name FROM followups f
    JOIN followup_rules r ON r.id = f.rule_id
    WHERE f.vendor_id = @id AND f.status = 'pending' AND ${orgFilter('f')}
    ORDER BY f.scheduled_at ASC
  `).all({ id: req.params.id, orgId: req.orgId });
  res.json({ vendor: v, messages, calls, tasks, pendingFollowups });
});

const vendorBodySchema = {
  name: S.string({ maxLength: 200 }),
  phone: S.string({ maxLength: 32 }),
  company: S.string({ maxLength: 200 }),
  email: S.email({ maxLength: 254 }),
  category: S.string({ maxLength: 200 }),
  tags: S.string({ maxLength: 500 }),
  notes: S.text(),
  status: S.string({ maxLength: 60 }),
  title: S.string({ maxLength: 200 }),
  address: S.string({ maxLength: 300 }),
  city: S.string({ maxLength: 200 }),
  hours: S.string({ maxLength: 200 }),
};

router.post('/', body(vendorBodySchema), (req, res) => {
  const { name, phone, company, email, category, tags, notes, status, title, address, city, hours } = req.body;
  if (!name || !phone) return res.status(400).json({ error: 'name_and_phone_required' });
  const v = validatePhone(phone);
  if (!v.ok) return res.status(400).json({ error: 'invalid_phone', detail: v.reason, normalized: v.normalized });
  try {
    const r = db.prepare(`
      INSERT INTO vendors (organization_id, name, phone, company, email, category, tags, notes, status, title, address, city, hours)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'new'), ?, ?, ?, ?)
    `).run(
      req.orgId, name, v.normalized,
      company || name, // default company to store name
      email || null, category || null, tags || null, notes || null, status || null,
      title || null, address || null, city || null, hours || null,
    );
    try {
      const created = db.prepare('SELECT * FROM vendors WHERE id = ?').get(r.lastInsertRowid);
      require('../automation').fire('contact_created', { vendor: created, orgId: req.orgId });
    } catch (_) {}
    res.json({ id: r.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.put('/:id', body(vendorBodySchema), (req, res) => {
  const allowed = ['name', 'phone', 'company', 'email', 'category', 'tags', 'notes', 'status', 'title', 'address', 'city', 'hours'];
  const sets = [];
  const params = { id: req.params.id, orgId: req.orgId, updated_at: Date.now() };
  for (const k of allowed) {
    if (req.body[k] !== undefined) {
      sets.push(`${k} = @${k}`);
      params[k] = k === 'phone' ? normalizePhone(req.body[k]) : req.body[k];
    }
  }
  if (!sets.length) return res.json({ ok: true });
  sets.push('updated_at = @updated_at');
  db.prepare(`UPDATE vendors SET ${sets.join(', ')} WHERE id = @id AND ${orgFilter()}`).run(params);
  res.json({ ok: true });
});

router.delete('/:id', (req, res) => {
  // Soft delete, org-scoped — the row is retained for audit but hidden everywhere.
  db.prepare(`UPDATE vendors SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`)
    .run({ id: req.params.id, orgId: req.orgId, now: Date.now() });
  res.json({ ok: true });
});

router.post('/import', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'file_required' });
  const filename = (req.file.originalname || '').toLowerCase();
  const isExcel = filename.endsWith('.xlsx') || filename.endsWith('.xls')
    || req.file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || req.file.mimetype === 'application/vnd.ms-excel';
  let records;
  try {
    if (isExcel) {
      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) return res.status(400).json({ error: 'excel_no_sheets' });
      records = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '', raw: false });
    } else {
      records = parse(req.file.buffer, { columns: true, skip_empty_lines: true, trim: true });
    }
  } catch (e) {
    return res.status(400).json({ error: isExcel ? 'excel_parse_failed' : 'csv_parse_failed', detail: e.message });
  }
  // Strip prototype-polluting keys before any row is read.
  records = Array.isArray(records) ? records.map(sanitizeRecord) : [];
  const insert = db.prepare(`
    INSERT INTO vendors (organization_id, name, phone, company, email, category, tags, notes, title, address, city, hours)
    VALUES (@orgId, @name, @phone, @company, @email, @category, @tags, @notes, @title, @address, @city, @hours)
    ON CONFLICT(organization_id, phone) DO UPDATE SET
      name = excluded.name,
      company = COALESCE(excluded.company, vendors.company),
      email = COALESCE(excluded.email, vendors.email),
      category = COALESCE(excluded.category, vendors.category),
      tags = COALESCE(excluded.tags, vendors.tags),
      notes = COALESCE(excluded.notes, vendors.notes),
      title = COALESCE(excluded.title, vendors.title),
      address = COALESCE(excluded.address, vendors.address),
      city = COALESCE(excluded.city, vendors.city),
      hours = COALESCE(excluded.hours, vendors.hours),
      updated_at = strftime('%s','now') * 1000
  `);
  const pick = (r, ...keys) => {
    for (const k of keys) {
      const v = r[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
    }
    return null;
  };
  const tx = db.transaction((rows) => {
    let inserted = 0, invalid = 0, missing = 0;
    for (const r of rows) {
      const name = pick(r, 'name', 'Name', 'full_name', 'contact', 'Contact');
      const rawPhone = pick(r, 'phone', 'Phone', 'mobile', 'Mobile');
      if (!rawPhone || !name) { missing++; continue; }
      const v = validatePhone(rawPhone);
      if (!v.ok) { invalid++; continue; }
      insert.run({
        orgId: req.orgId,
        name,
        phone: v.normalized,
        company: pick(r, 'company', 'Company'),
        email: pick(r, 'email', 'Email'),
        category: pick(r, 'category', 'Category'),
        tags: pick(r, 'tags', 'Tags'),
        notes: pick(r, 'notes', 'Notes'),
        title: pick(r, 'title', 'Title'),
        address: pick(r, 'address', 'Address'),
        city: pick(r, 'city', 'City'),
        hours: pick(r, 'hours', 'Hours'),
      });
      inserted++;
    }
    return { inserted, invalid, missing };
  });
  const result = tx(records);
  res.json({ ...result, total: records.length });
});

router.post('/delete-bulk', body({ ids: S.array({ of: S.int({ min: 1 }), maxItems: 10000 }) }), (req, res) => {
  const { ids } = req.body || {};
  if (!Array.isArray(ids) || !ids.length) return res.status(400).json({ error: 'ids_array_required' });
  const del = db.prepare(`UPDATE vendors SET deleted_at = @now WHERE id = @id AND ${orgFilter()}`);
  const tx = db.transaction((rows) => { for (const id of rows) del.run({ id, orgId: req.orgId, now: Date.now() }); });
  tx(ids);
  res.json({ deleted: ids.length });
});

module.exports = router;
