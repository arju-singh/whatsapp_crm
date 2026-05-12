// One-shot importer: chandigarh pets .numbers -> vendors table.
// Source CSV is generated alongside via numbers-parser; this script only owns the DB write.

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

const dataPath = path.join(__dirname, 'chandigarh-pets.json');
const records = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const insert = db.prepare(`
  INSERT INTO vendors (name, company, phone, category, tags, notes, address, city, hours, status)
  VALUES (@name, @name, @phone, @category, @tags, @notes, @address, @city, @hours, 'new')
  ON CONFLICT(phone) DO UPDATE SET
    name = excluded.name,
    company = excluded.name,
    category = COALESCE(excluded.category, vendors.category),
    tags = COALESCE(excluded.tags, vendors.tags),
    notes = COALESCE(excluded.notes, vendors.notes),
    address = COALESCE(excluded.address, vendors.address),
    city = COALESCE(excluded.city, vendors.city),
    hours = COALESCE(excluded.hours, vendors.hours),
    updated_at = strftime('%s','now') * 1000
`);

const tx = db.transaction((rows) => {
  let inserted = 0, updated = 0, placeholderPhones = 0;
  for (const r of rows) {
    const sno = r['S.No'];
    const name = String(r['Name'] || '').trim();
    if (!name) continue;

    const rawPhone = r['Phone Number'];
    let phone = normalizePhone(rawPhone);
    const phoneMissing = !phone || phone.length < 11;
    if (phoneMissing) {
      phone = `na-chandigarh-pets-${sno}`;
      placeholderPhones++;
    }

    const address = String(r['Location/Address'] || '').trim();
    const city = String(r['City'] || '').trim();
    const hours = String(r['Hours'] || '').trim();
    const rating = String(r['Rating'] || '').trim();

    const noteParts = [];
    if (address) noteParts.push(`Address: ${address}`);
    if (city) noteParts.push(`City: ${city}`);
    if (hours) noteParts.push(`Hours: ${hours}`);
    if (rating) noteParts.push(`Rating: ${rating}`);
    if (phoneMissing) noteParts.push(`Original phone: ${rawPhone || 'Not Available'}`);
    const notes = noteParts.join(' | ');

    const tags = ['chandigarh-pets', city ? city.toLowerCase().replace(/\s+/g, '-') : null]
      .filter(Boolean).join(',');

    const before = db.prepare('SELECT id FROM vendors WHERE phone = ?').get(phone);
    insert.run({
      name,
      phone,
      category: String(r['Type'] || '').trim() || null,
      tags: tags || null,
      notes: notes || null,
      address: address || null,
      city: city || null,
      hours: hours || null,
    });
    if (before) updated++; else inserted++;
  }
  return { inserted, updated, placeholderPhones };
});

const result = tx(records);
console.log(JSON.stringify({ total: records.length, ...result }, null, 2));
