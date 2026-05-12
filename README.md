# WhatsApp CRM + Bulk Sender

A self-hosted WhatsApp CRM with bulk messaging, vendor pipeline tracking, message templates, and rule-based auto follow-ups. Built on `whatsapp-web.js` (no API fees), Express, SQLite, and a vanilla-JS dashboard.

## Features

- **Vendor CRM** — create/import vendors, pipeline statuses (new → contacted → replied → won/lost), per-vendor conversation thread, notes, tags, categories, sent/reply counters, last contact timestamps.
- **Bulk sender** — select vendors with filters, pick a template or write a custom message, queue with rate-limited delivery (random 4–9 s gap, configurable). Per-message variable substitution with `{{name}}`, `{{company}}`, `{{email}}`.
- **Templates** — reusable message bodies grouped by category.
- **Campaigns** — every bulk send is a campaign with delivery, read, and reply analytics.
- **Auto follow-ups** — define rules (e.g. "if no reply 48 h after first message → send template X, max 3 attempts"). A cron loop schedules and fires due follow-ups, and replies automatically cancel pending follow-ups when the rule says so.
- **Dashboard** — KPIs, pipeline funnel, message metrics, recent activity stream.
- **Live status** — read receipts and delivery acks update message status; inbound replies bump the vendor to "replied".
- **CSV import** — upload a CSV with `name,phone,company,email,category,tags,notes` headers (any subset; phone+name are required). Existing phones are upserted.

## Quick start

```bash
cd /Users/arju/Documents/whatsapp
npm install
npm start
```

Open http://localhost:3000 — click **Show QR** in the sidebar and scan with WhatsApp on your phone (Settings → Linked Devices). Once connected, the green dot lights up and you can send.

Session is persisted in `.wwebjs_auth/`, so you don't need to re-scan after restarts.

## Important: WhatsApp policy

This uses the unofficial WhatsApp Web bridge. WhatsApp can flag/ban numbers used for spam. Use it for legitimate vendor outreach with reasonable volume and personalization. Adjust pacing via env:

```bash
WA_MIN_DELAY_MS=8000 WA_MAX_DELAY_MS=15000 npm start
```

## Architecture

```
server.js                 Express + WA init + scheduler boot
src/
  db.js                   SQLite schema + connection
  whatsapp.js             whatsapp-web.js wrapper, send queue, ack/reply hooks
  scheduler.js            node-cron: schedules and fires follow-ups
  routes/
    vendors.js            CRUD, search, CSV import, summary stats
    templates.js          CRUD
    messages.js           single send, bulk send, listing, summary stats
    campaigns.js          listing + detail
    followups.js          rule CRUD + pending list
public/
  index.html, styles.css, app.js   single-page dashboard
data/crm.db               SQLite database (auto-created)
```

## API reference (selected)

- `GET  /api/wa/status` — `{ ready, hasQr, info, queueDepth }`
- `GET  /api/wa/qr` — base64 QR image (when not authenticated)
- `GET  /api/vendors?q=&status=&category=`
- `POST /api/vendors` — `{ name, phone, ... }`
- `POST /api/vendors/import` — multipart `file` (CSV)
- `GET  /api/vendors/stats/summary`
- `POST /api/messages/send` — `{ vendor_id, body | template_id }`
- `POST /api/messages/bulk` — `{ vendor_ids:[], body | template_id, campaign_name? }`
- `GET  /api/messages/stats/summary`
- `POST /api/followups/rules` — `{ name, trigger:'no_reply'|'after_send', delay_hours, template_id, max_attempts, stop_on_reply, active }`
- `GET  /api/followups/pending`

## CSV format

```csv
name,phone,company,email,category,tags,notes
Ravi Kumar,919876543210,Acme Logistics,ravi@acme.in,Logistics,priority,met at expo
Suresh Mehta,919812345678,Sun Packaging,,Packaging,,
```

`phone` should be in international form (digits only — country code + number). Non-digits are stripped automatically.

## Tuning / safety knobs

| Env | Default | Purpose |
| --- | --- | --- |
| `PORT` | 3000 | Dashboard port |
| `WA_MIN_DELAY_MS` | 4000 | Minimum delay between bulk sends |
| `WA_MAX_DELAY_MS` | 9000 | Maximum delay between bulk sends |

## Notes & limitations

- macOS users: first run downloads Chromium for Puppeteer (~150 MB).
- The WhatsApp client must remain logged in on your phone (linked-device behavior).
- Read receipts only fire if the recipient has them enabled.
- For very large lists, consider running multiple sessions on different numbers.
# whatsapp_crm
# whatsapp_crm
# whatsapp_crm
