// Parse address/city/hours out of notes for the imported chandigarh-pets vendors,
// and pull city/address from the original Hisar notes where possible.
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

function parseField(notes, key) {
  if (!notes) return null;
  const re = new RegExp(`(?:^|\\|\\s*)${key}:\\s*([^|]+?)(?=\\s*(?:\\||$))`, 'i');
  const m = notes.match(re);
  return m ? m[1].trim() : null;
}

const rows = db.prepare(`
  SELECT id, name, phone, notes, tags
  FROM vendors
  WHERE tags LIKE '%chandigarh-pets%' OR tags LIKE '%petscare-hisar%'
`).all();

const update = db.prepare(`
  UPDATE vendors
     SET address = COALESCE(@address, address),
         city = COALESCE(@city, city),
         hours = COALESCE(@hours, hours),
         updated_at = strftime('%s','now') * 1000
   WHERE id = @id
`);

// Hisar source has structured notes like "Owner: ... Community Center, St. No. 3, opposite PLA, Vijay Colony.
// Sells ... Rating 4.9 (139). Hours 9AM-9PM."  — try to extract Hours: pattern.
function parseHisarHours(notes) {
  if (!notes) return null;
  const m = notes.match(/Hours\s+([^\.]+)/i);
  return m ? m[1].trim() : null;
}

// Hisar tags often carry the area as the second tag (after pet-store/vet-clinic).
function parseHisarCity(tags) {
  if (!tags) return null;
  const parts = tags.split(',').map(s => s.trim().toLowerCase());
  if (parts.includes('hisar') || parts.includes('hisar-cantt')) return 'Hisar';
  return null;
}

const tx = db.transaction(() => {
  let n = 0;
  for (const r of rows) {
    const isChand = (r.tags || '').includes('chandigarh-pets');
    let address = parseField(r.notes, 'Address');
    let city    = parseField(r.notes, 'City');
    let hours   = parseField(r.notes, 'Hours');

    if (isChand) {
      // notes also has " | Rating: ... | Original phone: ..." — already excluded by regex.
    } else {
      // Hisar
      if (!hours) hours = parseHisarHours(r.notes);
      if (!city) city = parseHisarCity(r.tags);
    }

    update.run({ id: r.id, address: address || null, city: city || null, hours: hours || null });
    n++;
  }
  return n;
});

console.log(JSON.stringify({ scanned: rows.length, updated: tx() }, null, 2));
