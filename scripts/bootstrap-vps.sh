#!/usr/bin/env bash
# One-shot deploy for crm.arjusingh.com on a fresh Ubuntu 22.04/24.04 VPS.
# Run as root:  DOMAIN=crm.arjusingh.com bash bootstrap-vps.sh
# Installs Docker, clones the repo, and brings the app up behind Caddy (auto-HTTPS).
set -euo pipefail

DOMAIN="${DOMAIN:-crm.arjusingh.com}"
REPO="${REPO:-https://github.com/arju-singh/whatsapp_crm.git}"
APP_DIR="${APP_DIR:-/opt/whatsapp_crm}"

echo "==> Deploying $DOMAIN"

# 1. Docker (+ compose plugin)
if ! command -v docker >/dev/null 2>&1; then
  echo "==> Installing Docker"
  curl -fsSL https://get.docker.com | sh
fi

# 2. Clone or update the repo
if [ -d "$APP_DIR/.git" ]; then
  echo "==> Updating existing checkout"
  git -C "$APP_DIR" pull --ff-only
else
  echo "==> Cloning repo to $APP_DIR"
  git clone "$REPO" "$APP_DIR"
fi
cd "$APP_DIR"

# 3. Config (.env). Created from the example on first run; edit it to set
#    SEED_ADMIN_PASSWORD and any API keys, then re-run this script.
if [ ! -f .env ]; then
  cp .env.example .env
  echo "==> Created .env from .env.example — EDIT IT to set SEED_ADMIN_PASSWORD + keys, then re-run."
fi
grep -q '^DOMAIN=' .env || echo "DOMAIN=$DOMAIN" >> .env

# 4. Bring it up
echo "==> Building & starting containers"
docker compose -f docker-compose.prod.yml up -d --build

IP="$(curl -fsS ifconfig.me 2>/dev/null || echo '<this-server-ip>')"
cat <<DONE

==> Done.
    1. In GoDaddy, add a DNS A record:  crm  ->  $IP   (TTL 600, "DNS only")
    2. Once DNS resolves, Caddy issues the HTTPS cert automatically (~30s).
       Open:  https://$DOMAIN
    3. Link WhatsApp — scan the QR from the logs:
       docker compose -f docker-compose.prod.yml logs -f crm
DONE
