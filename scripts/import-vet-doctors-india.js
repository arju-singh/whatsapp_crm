// One-shot importer: Veterinary_Doctors_India.csv -> vendors table.

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

const csvPath = process.argv[2] || '/Users/arju/Downloads/Veterinary_Doctors_India.csv';
const text = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
const records = parse(text, { columns: true, skip_empty_lines: true, trim: true });

const insert = db.prepare(`
  INSERT INTO vendors (name, company, phone, email, category, tags, notes, address, city, status)
  VALUES (@name, @company, @phone, @email, @category, @tags, @notes, @address, @city, 'new')
  ON CONFLICT(phone) DO NOTHING
`);
const findByPhone = db.prepare('SELECT id FROM vendors WHERE phone = ?');

const tx = db.transaction((rows) => {
  let inserted = 0, skippedDuplicate = 0, placeholderPhones = 0;
  for (const r of rows) {
    const sno = r['S.No'];
    const name = String(r['Name'] || '').trim();
    if (!name) continue;

    const rawPhone = r['Phone'];
    let phone = normalizePhone(rawPhone);
    const phoneMissing = !phone || phone.length < 11;
    if (phoneMissing) {
      phone = `na-vet-india-${sno}`;
      placeholderPhones++;
    }

    if (findByPhone.get(phone)) { skippedDuplicate++; continue; }

    const qual = String(r['Qualification'] || '').trim();
    const clinic = String(r['Clinic/Hospital'] || '').trim();
    const address = String(r['Address'] || '').trim();
    const city = String(r['City'] || '').trim();
    const state = String(r['State'] || '').trim();
    const email = String(r['Email'] || '').trim().toLowerCase() || null;
    const animals = String(r['Animals Treated'] || '').trim();

    const noteParts = [];
    if (qual) noteParts.push(`Qualification: ${qual}`);
    if (clinic) noteParts.push(`Clinic: ${clinic}`);
    if (state) noteParts.push(`State: ${state}`);
    if (animals) noteParts.push(`Animals Treated: ${animals}`);
    if (phoneMissing) noteParts.push(`Original phone: ${rawPhone || 'Not Available'}`);
    const notes = noteParts.join(' | ');

    const citySlug = city ? city.toLowerCase().replace(/\s+/g, '-') : null;
    const stateSlug = state ? state.toLowerCase().replace(/\s+/g, '-') : null;
    const tags = ['veterinary-doctor', citySlug, stateSlug].filter(Boolean).join(',');

    insert.run({
      name,
      company: clinic || name,
      phone,
      email,
      category: 'Veterinary',
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
