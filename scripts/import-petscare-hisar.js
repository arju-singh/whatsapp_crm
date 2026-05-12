// One-shot importer: petscare-hisar-leads.numbers -> vendors table.
// Source has two near-identical sheets (Leads, Leads-1). De-dupe by normalized phone;
// when the same phone appears in both, prefer the row with longer notes/email content.

const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const DEFAULT_CC = '91';

function normalizePhone(p) {
  let digits = String(p || '').replace(/\D/g, '');
  if (!digits) return '';
  digits = digits.replace(/^0+/, '');
  if (digits.length === 10) digits = DEFAULT_CC + digits;
  return digits;
}

function looksLikeEmail(s) {
  return typeof s === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s.trim());
}

const dataPath = path.join(__dirname, 'petscare-hisar-leads.json');
const records = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const byPhone = new Map();
let placeholderCounter = 0;
for (const r of records) {
  const name = String(r.name || '').trim();
  if (!name) continue;
  let phone = normalizePhone(r.phone);
  let placeholder = false;
  if (!phone || phone.length < 11) {
    phone = `na-petscare-hisar-${++placeholderCounter}`;
    placeholder = true;
  }
  const candidate = {
    name,
    phone,
    placeholder,
    rawPhone: r.phone,
    emailField: String(r.email || '').trim(),
    tags: String(r.tags || '').trim(),
    notes: String(r.notes || '').trim(),
  };
  const prior = byPhone.get(phone);
  if (!prior) {
    byPhone.set(phone, candidate);
  } else {
    const score = (x) => (x.emailField.length + x.notes.length + x.tags.length);
    if (score(candidate) > score(prior)) byPhone.set(phone, candidate);
  }
}

const insert = db.prepare(`
  INSERT INTO vendors (name, company, phone, email, tags, notes, category, status)
  VALUES (@name, @name, @phone, @email, @tags, @notes, @category, 'new')
  ON CONFLICT(phone) DO UPDATE SET
    name = excluded.name,
    company = excluded.name,
    email = COALESCE(excluded.email, vendors.email),
    tags = COALESCE(excluded.tags, vendors.tags),
    notes = COALESCE(excluded.notes, vendors.notes),
    category = COALESCE(excluded.category, vendors.category),
    updated_at = strftime('%s','now') * 1000
`);

const tx = db.transaction((rows) => {
  let inserted = 0, updated = 0, placeholders = 0;
  for (const r of rows) {
    if (r.placeholder) placeholders++;

    let email = null;
    const noteParts = [];
    if (r.emailField) {
      if (looksLikeEmail(r.emailField)) email = r.emailField;
      else noteParts.push(`Status: ${r.emailField}`);
    }
    if (r.notes) noteParts.push(r.notes);
    if (r.placeholder) noteParts.push(`Original phone: ${r.rawPhone || 'Not Available'}`);

    const tagSet = new Set();
    if (r.tags) r.tags.split(',').map(t => t.trim()).filter(Boolean).forEach(t => tagSet.add(t));
    tagSet.add('petscare-hisar');
    const tags = [...tagSet].join(',');

    let category = null;
    const tagsLower = r.tags.toLowerCase();
    if (tagsLower.includes('vet')) category = 'Veterinary Clinic';
    else if (tagsLower.includes('pet-store') || tagsLower.includes('pet-shop')) category = 'Pet Store';
    else if (tagsLower.includes('grooming')) category = 'Pet Grooming';
    else if (tagsLower.includes('boarding')) category = 'Pet Boarding';

    const exists = db.prepare('SELECT id FROM vendors WHERE phone = ?').get(r.phone);
    insert.run({
      name: r.name,
      phone: r.phone,
      email,
      tags,
      notes: noteParts.join(' | ') || null,
      category,
    });
    if (exists) updated++; else inserted++;
  }
  return { inserted, updated, placeholders };
});

const deduped = [...byPhone.values()];
const result = tx(deduped);
console.log(JSON.stringify({
  totalRowsRead: records.length,
  uniqueByPhone: deduped.length,
  ...result,
}, null, 2));
