# Deploying WhatsApp CRM

The app is a single Node/Express server with an embedded SQLite database and a
whatsapp-web.js client (headless Chromium). It needs **persistent disk** for the
database and the WhatsApp linked-device session, so deploy it on a host that
supports a persistent volume (a VPS, or a container platform with volumes —
**not** ephemeral serverless).

## Option A — Docker (recommended, portable)

On any Docker host (your laptop, a VPS, etc.):

```bash
git clone https://github.com/arju-singh/whatsapp_crm.git
cd whatsapp_crm
cp .env.example .env        # edit: set SEED_ADMIN_*, API keys, SMTP, etc.
docker compose up -d --build
```

Then open `http://<host>:8080`. The Dockerfile bundles Chromium, so WhatsApp
works headless. Named volumes (`crm-data`, `crm-wa`) persist the DB and the
WhatsApp session across restarts and rebuilds.

Update to a new version:

```bash
git pull && docker compose up -d --build
```

Logs / QR for linking WhatsApp:

```bash
docker compose logs -f crm      # the QR prints here on first run
```

## Option B — Bare VPS (no Docker)

Requires Node 18+ and a system Chrome/Chromium.

```bash
sudo apt-get install -y chromium              # Debian/Ubuntu
git clone https://github.com/arju-singh/whatsapp_crm.git && cd whatsapp_crm
cp .env.example .env && $EDITOR .env
npm ci && npm run build
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium NODE_ENV=production PORT=8080 node server.js
```

Keep it running with a process manager (survives reboots):

```bash
npm i -g pm2
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium pm2 start server.js \
  --name whatsapp-crm --env production
pm2 save && pm2 startup
```

## Option C — PaaS (Fly.io / Render / Railway)

All three can build the included `Dockerfile`. You must attach a **persistent
volume** mounted at `/app/data` and `/app/.wwebjs_auth` (or a single volume
covering both), or the DB and WhatsApp session reset on every redeploy.
Set env vars in the platform dashboard (see `.env.example`). Ask and platform-
specific config (`fly.toml` / `render.yaml`) can be added.

## First login

On first boot the app seeds an admin from `SEED_ADMIN_PHONE` / `SEED_ADMIN_NAME`
/ `SEED_ADMIN_PASSWORD` (see `.env.example`). Set these before the first run.

## HTTPS

Put the app behind a reverse proxy (Caddy, nginx, or the platform's built-in TLS)
and set `PUBLIC_BASE_URL=https://your-domain` so email tracking links and OAuth
callbacks resolve correctly. Set `TRUST_PROXY=1` when behind a proxy.

## Env vars

See `.env.example` for the full list. Notably: `PORT`, `PUBLIC_BASE_URL`,
`SEED_ADMIN_*`, `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` (AI drafts), `SMTP_*`
(email), and `PUPPETEER_EXECUTABLE_PATH` (Chromium path for WhatsApp).
Settings saved in-app (DB) override `.env` for the same key.
