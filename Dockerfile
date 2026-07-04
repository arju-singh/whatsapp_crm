# WhatsApp CRM — production image
# Bundles Chromium so whatsapp-web.js (puppeteer) works headless in a container.
# Our browser resolver (src/whatsapp.js) honours PUPPETEER_EXECUTABLE_PATH.
FROM node:20-bookworm-slim

# System Chromium + fonts for rendering, and build tools for the better-sqlite3
# native addon. --no-install-recommends keeps the image lean; Chromium's hard
# dependencies are still pulled in.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-liberation \
      python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=8080 \
    PUPPETEER_SKIP_DOWNLOAD=1 \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Install all deps (dev included — esbuild is needed for `npm run build`),
# copy the source, build the production bundle, then drop dev deps.
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

# Persistent state: SQLite database and the WhatsApp linked-device session.
RUN mkdir -p /app/data /app/.wwebjs_auth
VOLUME ["/app/data", "/app/.wwebjs_auth"]

EXPOSE 8080
CMD ["node", "server.js"]
