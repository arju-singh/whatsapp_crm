// One-shot importer: vets_in_tricity.csv -> vendors table.
// Usage: node scripts/import-vets-tricity.js [path-to-csv]

const fs = require('fs');
const path = require('path');
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

function splitPhones(raw) {
  return String(raw || '')
    .split(/[\/,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const csvPath = process.argv[2] || '/Users/arju/Downloads/vets_in_tricity.csv';
const buf = fs.readFileSync(csvPath);
// strip BOM if present
const text = buf.toString('utf8').replace(/^﻿/, '');
const records = parse(text, { columns: true, skip_empty_lines: true, trim: true });

const insert = db.prepare(`
  INSERT INTO vendors (name, company, phone, category, tags, notes, address, city, hours, status)
  VALUES (@name, @name, @phone, @category, @tags, @notes, @address, @city, @hours, 'new')
  ON CONFLICT(phone) DO NOTHING
`);

const findByPhone = db.prepare('SELECT id FROM vendors WHERE phone = ?');

const tx = db.transaction((rows) => {
  let inserted = 0, skippedDuplicate = 0, placeholderPhones = 0;
  for (const r of rows) {
    const sno = r['S.No'];
    const name = String(r['Clinic / Hospital Name'] || '').trim();
    if (!name) continue;

    const rawPhone = r['Phone Number'];
    const phoneList = splitPhones(rawPhone).map(normalizePhone).filter((p) => p && p.length >= 11);
    let phone = phoneList[0] || '';
    const phoneMissing = !phone;
    if (phoneMissing) {
      phone = `na-vets-tricity-${sno}`;
      placeholderPhones++;
    }

    if (findByPhone.get(phone)) {
      skippedDuplicate++;
      continue;
    }

    const city = String(r['City'] || '').trim();
    const area = String(r['Area / Sector'] || '').trim();
    const fullAddress = String(r['Full Address'] || '').trim();
    const address = fullAddress || [area, city].filter(Boolean).join(', ');
    const hours = String(r['Timings'] || '').trim();
    const rating = String(r['Rating'] || '').trim();
    const services = String(r['Services Offered'] || '').trim();
    const website = String(r['Website / Social Media'] || '').trim();

    const noteParts = [];
    if (services) noteParts.push(`Services: ${services}`);
    if (rating) noteParts.push(`Rating: ${rating}`);
    if (website) noteParts.push(`Website: ${website}`);
    if (phoneList.length > 1) noteParts.push(`All phones: ${phoneList.join(', ')}`);
    if (phoneMissing) noteParts.push(`Original phone: ${rawPhone || 'Not Available'}`);
    const notes = noteParts.join(' | ');

    const citySlug = city ? city.toLowerCase().replace(/\s+/g, '-') : null;
    const tags = ['vets-tricity', citySlug].filter(Boolean).join(',');

    insert.run({
      name,
      phone,
      category: 'Veterinary',
      tags: tags || null,
      notes: notes || null,
      address: address || null,
      city: city || null,
      hours: hours || null,
    });
    inserted++;
  }
  return { inserted, skippedDuplicate, placeholderPhones };
});

const result = tx(records);
console.log(JSON.stringify({ total: records.length, ...result }, null, 2));
