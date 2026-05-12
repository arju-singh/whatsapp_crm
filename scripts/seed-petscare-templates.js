// Seeds 15 reusable WhatsApp templates for petscare.club outreach to pet
// businesses (clinics, stores, groomers, breeders, hospitals).
// Idempotent: matches by name; updates body/category if already present.
const db = require('../src/db');

const SITE = 'petscare.club';
const URL  = 'https://petscare.club';
const SUPPORT_PHONE = '+91 80000 00000'; // edit this in templates after seeding

const TEMPLATES = [
  {
    name: 'Intro · Pet Stores & Clinics',
    category: 'outreach',
    body:
`Hi {{name}}, this is Arju from petscare.club 🐾

We help pet stores and clinics like {{company}} reach more local pet parents through our directory + booking platform.

Would you be open to a quick 5-minute call this week?

More: ${URL}`,
  },

  {
    name: 'Intro · Veterinary Clinics',
    category: 'outreach',
    body:
`Hello {{name}}, namaste from petscare.club!

We're onboarding trusted veterinary clinics like {{company}} so pet parents in your area can discover, book, and review you in one place.

✓ Free listing during launch
✓ Online booking + reminders
✓ Verified review badge

Curious to know more? Reply YES and I'll share details.`,
  },

  {
    name: 'Intro · Groomers & Spas',
    category: 'outreach',
    body:
`Hi {{name}} 👋

I run partnerships at petscare.club. We're putting together a curated list of the best groomers and pet spas — and {{company}} came up as one of the top-rated ones nearby.

Would you like a free verified profile + booking link? Takes 2 minutes to set up.

${URL}`,
  },

  {
    name: 'Intro · Pet Breeders',
    category: 'outreach',
    body:
`Namaste {{name}},

petscare.club is a verified-breeder marketplace for Indian pet parents. We feature kennel-club registered breeders like {{company}} and connect you with families looking for healthy puppies/kittens.

Interested in a verified profile? Reply 1 — I'll share onboarding details.`,
  },

  {
    name: 'Follow-up · No reply (gentle)',
    category: 'follow-up',
    body:
`Hi {{name}}, just floating this back up in case it got buried 😊

Quick recap: a free verified profile on petscare.club for {{company}} — more local pet parents, no setup fee.

Should I share a 60-second demo, or close the loop here?`,
  },

  {
    name: 'Follow-up · Said "interested"',
    category: 'follow-up',
    body:
`Thanks {{name}}! 🙏

Here's the next step — a 10-minute walkthrough where I'll set up {{company}}'s profile live with you so you can see exactly how it works.

Pick any slot that suits you: ${URL}/book

(Or reply with a time and I'll send a calendar invite.)`,
  },

  {
    name: 'Follow-up · Asked to call later',
    category: 'follow-up',
    body:
`Hi {{name}}, hope you're well 🌿

You'd asked me to reach out later regarding petscare.club. Is now a good time for a 5-minute call, or shall I propose a slot tomorrow?

— Arju, petscare.club`,
  },

  {
    name: 'Booking link · Demo call',
    category: 'booking',
    body:
`Perfect, {{name}}! Here's a quick way to lock in a slot:

📅 ${URL}/book

It opens up only available times this week. The call is 10 minutes max — I'll set up {{company}}'s profile live with you.

See you there!`,
  },

  {
    name: 'Onboarding · Welcome',
    category: 'onboarding',
    body:
`Welcome to petscare.club, {{name}}! 🎉

{{company}} is now part of India's fastest-growing pet care network. Your verified profile is live: ${URL}/${'{{company}}'}

Next steps:
1️⃣ Add 2-3 photos of your store/clinic
2️⃣ Set your service hours
3️⃣ Share the link with your existing customers for the first reviews

Need help? Just reply to this message.`,
  },

  {
    name: 'Onboarding · How to get reviews',
    category: 'onboarding',
    body:
`Hi {{name}} — quick tip 💡

The fastest way to rank higher on petscare.club is reviews from happy pet parents. Here's the easiest playbook for {{company}}:

1. Send your direct review link to recent customers: ${URL}/r/${'{{company}}'}
2. Print the QR code (we'll DM you a printable version)
3. Reply to every review — it doubles trust signals

Want the QR code? Reply *QR* and we'll send it.`,
  },

  {
    name: 'Promo · Festive (generic)',
    category: 'promo',
    body:
`🎁 Festive offer for petscare.club partners

Hi {{name}}! For the next 7 days, every booking from petscare.club for {{company}} gets a complimentary feature on our home page.

Translation: more eyes, more bookings, no extra cost.

Already an offer in your shop? Reply with the details and we'll feature it. ${URL}`,
  },

  {
    name: 'Promo · Vaccination drive',
    category: 'promo',
    body:
`Hi {{name}} 🐶🐱

We're running a community vaccination + checkup drive next month and listing trusted vets like {{company}} who'd like to participate.

Benefits:
✓ Featured listing for the drive duration
✓ Walk-in pet parents
✓ Press coverage on local channels

Interested? Reply YES — takes 2 mins to set up.`,
  },

  {
    name: 'Re-engage · Inactive partner',
    category: 'win-back',
    body:
`Hi {{name}}, miss having {{company}} active on petscare.club! 🌿

We've shipped a few upgrades since you last logged in:
• Faster online booking
• Auto WhatsApp reminders to your customers
• Free QR posters to put up in-store

Want me to reactivate your profile? Reply *YES*.`,
  },

  {
    name: 'Reminder · Appointment confirmation',
    category: 'transactional',
    body:
`Hi {{name}}, this is a friendly reminder of your appointment at {{company}} 🐾

If you need to reschedule, just reply to this message and we'll handle it.

— petscare.club`,
  },

  {
    name: 'Thank you · Closed/Won',
    category: 'thank-you',
    body:
`Thank you for trusting petscare.club, {{name}}! 🙏

Your profile for {{company}} is fully set up and live. If you ever need anything — billing, edits, marketing tips — this WhatsApp is the fastest way to reach me.

Wishing {{company}} more wagging tails ahead 🐶❤️
— Arju, petscare.club`,
  },
];

// templates.name has no UNIQUE constraint, so emulate idempotency manually.
const tx = db.transaction(() => {
  let inserted = 0, updated = 0;
  for (const t of TEMPLATES) {
    const existing = db.prepare('SELECT id FROM templates WHERE name = ?').get(t.name);
    if (existing) {
      db.prepare('UPDATE templates SET body = ?, category = ?, updated_at = ? WHERE id = ?')
        .run(t.body, t.category, Date.now(), existing.id);
      updated++;
    } else {
      db.prepare('INSERT INTO templates (name, body, category) VALUES (?, ?, ?)')
        .run(t.name, t.body, t.category);
      inserted++;
    }
  }
  return { inserted, updated };
});

const r = tx();
console.log(JSON.stringify({ total: TEMPLATES.length, ...r }, null, 2));
