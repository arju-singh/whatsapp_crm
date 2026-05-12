// One-shot importer: Chandigarh_Pet_Businesses_Clinics_Stores_Vets.csv -> vendors table.

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

function splitPhones(raw) {
  return String(raw || '').split(/[\/,;]/).map((s) => s.trim()).filter(Boolean);
}

const csvPath = process.argv[2] || '/Users/arju/Downloads/Chandigarh_Pet_Businesses_Clinics_Stores_Vets.csv';
const text = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
const records = parse(text, { columns: true, skip_empty_lines: true, trim: true });

const insert = db.prepare(`
  INSERT INTO vendors (name, company, phone, category, tags, notes, address, city, status)
  VALUES (@name, @name, @phone, @category, @tags, @notes, @address, @city, 'new')
  ON CONFLICT(phone) DO NOTHING
`);
const findByPhone = db.prepare('SELECT id FROM vendors WHERE phone = ?');

const tx = db.transaction((rows) => {
  let inserted = 0, skippedDuplicate = 0, placeholderPhones = 0;
  for (const r of rows) {
    const sno = r['S.No'];
    const name = String(r['Business Name'] || '').trim();
    if (!name) continue;

    const rawPhone = r['Phone'];
    const phoneList = splitPhones(rawPhone).map(normalizePhone).filter((p) => p && p.length >= 11);
    let phone = phoneList[0] || '';
    const phoneMissing = !phone;
    if (phoneMissing) {
      phone = `na-chd-pet-biz-${sno}`;
      placeholderPhones++;
    }

    if (findByPhone.get(phone)) { skippedDuplicate++; continue; }

    const type = String(r['Type'] || '').trim();
    const address = String(r['Address'] || '').trim();
    const city = String(r['Area/City'] || '').trim();
    const rating = String(r['Rating'] || '').trim();
    const reviews = String(r['No. of Reviews'] || '').trim();
    const years = String(r['Years in Business'] || '').trim();
    const services = String(r['Services Offered'] || '').trim();
    const source = String(r['Source'] || '').trim();

    const noteParts = [];
    if (services) noteParts.push(`Services: ${services}`);
    if (rating) noteParts.push(`Rating: ${rating}${reviews ? ` (${reviews} reviews)` : ''}`);
    if (years) noteParts.push(`Years in business: ${years}`);
    if (source) noteParts.push(`Source: ${source}`);
    if (phoneList.length > 1) noteParts.push(`All phones: ${phoneList.join(', ')}`);
    if (phoneMissing) noteParts.push(`Original phone: ${rawPhone || 'Not Available'}`);
    const notes = noteParts.join(' | ');

    const citySlug = city ? city.toLowerCase().replace(/\s+/g, '-') : null;
    const tags = ['chandigarh-pet-biz', citySlug].filter(Boolean).join(',');

    insert.run({
      name,
      phone,
      category: type || null,
      tags: tags || null,
      notes: notes || null,
      address: address || null,
      city: city || null,
    });
    inserted++;
  }
  return { inserted, skippedDuplicate, placeholderPhones };
});

const result = tx(records);
console.log(JSON.stringify({ total: records.length, ...result }, null, 2));
