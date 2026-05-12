// One-shot importer: leads-import-filled.xlsx (converted to CSV) -> vendors table.

const fs = require('fs');
const { parse } = require('csv-parse/sync');
const db = require('../src/db');

const DEFAULT_CC = '91';

function normalizePhone(p) {
  let digits = String(p || '').replace(/\D/g, '');
  if (!digits) return '';
  digits = digits.replace(/^0+/, '');
  if (digits.length === 10) digits = DEFAULT_CC + digits;
  return digits;
}

const csvPath = process.argv[2] || '/Users/arju/Downloads/leads-import-filled.csv';
const text = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
const records = parse(text, { columns: true, skip_empty_lines: true, trim: true });

const insert = db.prepare(`
  INSERT INTO vendors (name, company, phone, email, category, tags, notes, status)
  VALUES (@name, @name, @phone, @email, @category, @tags, @notes, 'new')
  ON CONFLICT(phone) DO NOTHING
`);
const findByPhone = db.prepare('SELECT id FROM vendors WHERE phone = ?');

const tx = db.transaction((rows) => {
  let inserted = 0, skippedDuplicate = 0, placeholderPhones = 0, idx = 0;
  for (const r of rows) {
    idx++;
    const name = String(r['name'] || '').trim();
    if (!name) continue;

    const rawPhone = r['phone'];
    let phone = normalizePhone(rawPhone);
    const phoneMissing = !phone || phone.length < 11;
    if (phoneMissing) {
      phone = `na-leads-xlsx-${idx}`;
      placeholderPhones++;
    }

    if (findByPhone.get(phone)) { skippedDuplicate++; continue; }

    const email = String(r['email'] || '').trim().toLowerCase() || null;
    const source = String(r['source'] || '').trim();
    const stage = String(r['stage'] || '').trim();
    const csvTags = String(r['tags'] || '').trim();
    const csvNotes = String(r['notes'] || '').trim();

    const noteParts = [];
    if (csvNotes) noteParts.push(csvNotes);
    if (source) noteParts.push(`Source: ${source}`);
    if (stage) noteParts.push(`Stage: ${stage}`);
    if (phoneMissing) noteParts.push(`Original phone: ${rawPhone || 'Not Available'}`);
    const notes = noteParts.join(' | ');

    const allTags = ['leads-xlsx', csvTags].filter(Boolean).join(',');

    insert.run({
      name,
      phone,
      email,
      category: csvTags.includes('veterinary') ? 'Veterinary' : null,
      tags: allTags || null,
      notes: notes || null,
    });
    inserted++;
  }
  return { inserted, skippedDuplicate, placeholderPhones };
});

const result = tx(records);
console.log(JSON.stringify({ total: records.length, ...result }, null, 2));
