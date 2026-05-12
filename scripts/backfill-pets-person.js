// Extract person/owner names from source data and write to vendors.title (the "Person" column).
// Hisar notes start with "Owner: NAME." or "Doctor: NAME.".
// Chandigarh names sometimes contain "by Dr. NAME" / "by NAME".
const fs = require('fs');
const path = require('path');
const db = require('../src/db');

const DEFAULT_CC = '91';
function normalizePhone(p) {
  let d = String(p || '').replace(/\D/g, '').replace(/^0+/, '');
  if (d.length === 10) d = DEFAULT_CC + d;
  return d;
}

function parsePersonHisar(notes) {
  if (!notes) return null;
  // Capture name after "Owner:"/"Doctor:" etc., allowing common abbreviations (Dr. Mr. Mrs.)
  // to pass through; stop at the next sentence boundary (". " followed by any non-space).
  const re = /^\s*(?:Owner|Doctor|Dr|Vet|Manager|Contact|Founder|Proprietor)\s*:\s*((?:Dr\.\s*|Mr\.\s*|Mrs\.\s*|Ms\.\s*|Capt\.\s*|[^.])+?)\.\s+\S/i;
  const m = String(notes).match(re);
  if (!m) return null;
  return m[1].trim().replace(/\s+/g, ' ');
}

function parsePersonChandigarh(name) {
  if (!name) return null;
  // "... by Dr.Kochar" / "... by Dr. Mehra" / "... by Rajan"
  const m = String(name).match(/\bby\s+(Dr\.?\s*[A-Z][A-Za-z\.\s]+|[A-Z][A-Za-z\.\s]+)$/);
  if (!m) return null;
  let person = m[1].trim().replace(/\s+/g, ' ');
  // Tidy "Dr.Kochar" → "Dr. Kochar"
  person = person.replace(/^Dr\.?\s*/, 'Dr. ');
  return person;
}

const update = db.prepare(`
  UPDATE vendors
     SET title = @title,
         updated_at = strftime('%s','now') * 1000
   WHERE phone = @phone AND (title IS NULL OR title = '')
`);

let touched = 0, scanned = 0;

// Hisar pass: parse from raw notes in the source JSON
const hisar = JSON.parse(fs.readFileSync(path.join(__dirname, 'petscare-hisar-leads.json'), 'utf8'));
const tx1 = db.transaction(() => {
  for (const r of hisar) {
    scanned++;
    const phone = normalizePhone(r.phone);
    if (!phone) continue;
    const person = parsePersonHisar(r.notes);
    if (!person) continue;
    const res = update.run({ phone, title: person });
    if (res.changes) touched++;
  }
});
tx1();

// Chandigarh pass: parse "by NAME" suffix from the source name
const chand = JSON.parse(fs.readFileSync(path.join(__dirname, 'chandigarh-pets.json'), 'utf8'));
const tx2 = db.transaction(() => {
  for (const r of chand) {
    scanned++;
    const phone = normalizePhone(r['Phone Number']);
    if (!phone) continue;
    const person = parsePersonChandigarh(r['Name']);
    if (!person) continue;
    const res = update.run({ phone, title: person });
    if (res.changes) touched++;
  }
});
tx2();

console.log(JSON.stringify({ scanned, touched }, null, 2));
