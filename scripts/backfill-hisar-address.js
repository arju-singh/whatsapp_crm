// Hisar source crammed address into a free-text notes blob. Extract the address slice
// (text before "Rating" / "Sells" / "Hours" / "Best ...") and write it to vendors.address.
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const DEFAULT_CC = '91';
function normalizePhone(p) {
  let d = String(p || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10) d = DEFAULT_CC + d;
  return d;
}

function extractAddress(rawNotes) {
  if (!rawNotes) return null;
  let s = String(rawNotes).trim();
  // Strip leading "Owner: NAME." prefix.
  s = s.replace(/^Owner:\s*[^.]+\.\s*/i, '');
  // Cut at the first "stop word" that signals end of address.
  const stops = [
    /\.\s+(Sells|Best|Offers|Stocks|Provides|Services|Specializes|Famous|Has|Also|Open|Hours|Rating)\b/i,
    /\bHours?\s/i,
    /\bRating\s/i,
    /\bSells\s/i,
  ];
  let cut = s.length;
  for (const re of stops) {
    const m = s.match(re);
    if (m && m.index < cut) cut = m.index;
  }
  let addr = s.slice(0, cut).trim();
  // Tidy trailing punctuation.
  addr = addr.replace(/[.,;\s]+$/, '');
  return addr || null;
}

const dataPath = path.join(__dirname, 'petscare-hisar-leads.json');
const records = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const update = db.prepare(`
  UPDATE vendors
     SET address = COALESCE(NULLIF(@address, ''), address),
         updated_at = strftime('%s','now') * 1000
   WHERE phone = @phone AND (address IS NULL OR address = '')
`);

const tx = db.transaction(() => {
  let touched = 0, missing = 0;
  for (const r of records) {
    const phone = normalizePhone(r.phone);
    if (!phone) { missing++; continue; }
    const addr = extractAddress(r.notes);
    if (!addr) continue;
    const res = update.run({ phone, address: addr });
    if (res.changes) touched++;
  }
  return { touched, missing };
});

console.log(JSON.stringify(tx(), null, 2));
