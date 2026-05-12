// One-shot importer: Instagram_Pet_Business_Data.csv -> vendors table.
// Usage: node scripts/import-instagram-pets.js [path-to-csv]

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
  return String(raw || '')
    .split(/[\/,;]/)
    .map((s) => s.trim())
    .filter((s) => s && s.toUpperCase() !== 'N/A');
}

const csvPath = process.argv[2] || '/Users/arju/Downloads/Instagram_Pet_Business_Data.csv';
const text = fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
const records = parse(text, { columns: true, skip_empty_lines: true, trim: true });

const insert = db.prepare(`
  INSERT INTO vendors (name, company, phone, category, tags, notes, address, city, instagram, status)
  VALUES (@name, @name, @phone, @category, @tags, @notes, @address, @city, @instagram, 'new')
  ON CONFLICT(phone) DO UPDATE SET
    instagram = COALESCE(excluded.instagram, vendors.instagram),
    updated_at = strftime('%s','now') * 1000
`);

const findByPhone = db.prepare('SELECT id, instagram FROM vendors WHERE phone = ?');

const tx = db.transaction((rows) => {
  let inserted = 0, skippedDuplicate = 0, placeholderPhones = 0;
  for (const r of rows) {
    const sno = r['#'];
    const name = String(r['Profile Name'] || '').trim();
    if (!name) continue;

    const rawPhone = r['Contact/Phone'];
    const phoneList = splitPhones(rawPhone).map(normalizePhone).filter((p) => p && p.length >= 11);
    let phone = phoneList[0] || '';
    const phoneMissing = !phone;
    if (phoneMissing) {
      phone = `na-instagram-pets-${sno}`;
      placeholderPhones++;
    }

    const existing = findByPhone.get(phone);
    const username = String(r['Instagram Username'] || '').trim();
    const category = String(r['Category'] || '').trim() || null;
    const followers = String(r['Followers'] || '').trim();
    const location = String(r['Location'] || '').trim();
    const bio = String(r['Bio / Description'] || '').trim();
    const igUrl = String(r['Instagram URL'] || '').trim();
    const source = String(r['Source'] || '').trim();

    const cleanLocation = location && location.toUpperCase() !== 'N/A' ? location : '';
    const city = cleanLocation ? cleanLocation.split(',')[0].trim() : '';

    const noteParts = [];
    if (username) noteParts.push(`Instagram: ${username}`);
    if (igUrl) noteParts.push(`URL: ${igUrl}`);
    if (followers && followers.toUpperCase() !== 'N/A') noteParts.push(`Followers: ${followers}`);
    if (bio) noteParts.push(`Bio: ${bio}`);
    if (phoneList.length > 1) noteParts.push(`All phones: ${phoneList.join(', ')}`);
    if (phoneMissing) noteParts.push(`Original phone: ${rawPhone || 'Not Available'}`);
    if (source) noteParts.push(`Source: ${source}`);
    const notes = noteParts.join(' | ');

    const citySlug = city ? city.toLowerCase().replace(/\s+/g, '-') : null;
    const tags = ['instagram-pets', citySlug].filter(Boolean).join(',');

    insert.run({
      name,
      phone,
      category,
      tags: tags || null,
      notes: notes || null,
      address: cleanLocation || null,
      city: city || null,
      instagram: username || null,
    });
    if (existing) skippedDuplicate++; else inserted++;
  }
  return { inserted, skippedDuplicate, placeholderPhones };
});

const result = tx(records);
console.log(JSON.stringify({ total: records.length, ...result }, null, 2));
