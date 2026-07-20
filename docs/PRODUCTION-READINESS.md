# WhatsApp CRM — Production Readiness Assessment & Remediation

_Principal-engineer review of the codebase for a production SaaS handling 1,000+ WhatsApp conversations/day: architecture, security, data integrity, scalability. Grounded in the actual code (file:line references throughout)._

> **Scope note.** This document is both an audit and a record of changes already applied. A batch of safe, high-value fixes is **implemented and verified** (§3). The large architectural migration (Cloud API, queue/workers, Postgres) is **designed and staged** but requires infrastructure and credentials you provision — it cannot be responsibly one-shotted on a live system with real data. Those items are called out explicitly in §8 and "Owner: you".

---

## 1. Architecture Summary

### Current state
Single-process Node/Express monolith. The HTTP API, the WhatsApp client (whatsapp-web.js driving a headless Chromium via puppeteer), and the cron scheduler all boot in the same process (`server.js` `app.listen` → `wa.init(); scheduler.start()`). Data is embedded SQLite via better-sqlite3 (WAL). The outbound send queue is an **in-memory array** with concurrency 1 (`src/whatsapp.js` `queue`/`processQueue`). Multi-tenancy was bolted on (`src/tenancy.js`) over a schema that began single-tenant.

**Verdict:** functional and reasonably clean for a single operator, but three structural ceilings block the stated goal — (a) the WhatsApp transport is an unofficial browser automation that cannot scale or stay reliable, (b) shared state (queue, rate-limiter, WA session) lives in-process so it cannot be horizontally scaled, (c) tenant isolation has correctness holes.

### The WhatsApp decision — MIGRATE TO THE OFFICIAL CLOUD API
Do **not** upgrade/patch whatsapp-web.js, and do **not** swap it for another unofficial library (Baileys/wppconnect/venom) — those are the same category with the same ban risk and the same single-session-per-process topology.

| Dimension | whatsapp-web.js (current) | WhatsApp Business Cloud API (official) |
|---|---|---|
| Reliability | Chromium automating WA-Web DOM; breaks on WA updates; **confirmed send bug across 2 pinned versions** | Stateless HTTPS REST; versioned, backward-compatible |
| ToS / ban risk | **High — violates ToS, number bannable anytime** | Sanctioned; zero ToS risk |
| Delivery/read receipts | DOM `message_ack`, lost on disconnect | Guaranteed **webhooks** (sent/delivered/read/failed + error codes) |
| Multi-number / multi-account | Impossible without 1 Chromium/number/process | Native (many phone-number IDs per WABA) |
| Horizontal scaling | **Impossible** — session pinned to one Chromium in one process | **Native** — stateless HTTP, N workers behind a queue |
| Eng effort | Endless firefighting | ~2–4 weeks bounded, one-time |

**Why it's decisive:** web.js is *stateful* — the ability to send is bound to a live logged-in Chromium page that exists in exactly one process. Cloud API is *stateless HTTP* (`POST graph.facebook.com/.../messages` + bearer token); any number of workers on any number of hosts send concurrently, with the queue and DB as the only shared state. That is the difference between a channel that scales and one that fundamentally cannot. The one real cost to internalize: Cloud API enforces the **24-hour customer-service window** and **pre-approved templates** for business-initiated messages — your campaign flow must move to approved templates. That constraint is also what keeps you off ban lists.

### Target architecture
```
CRM users → [ Express API × N (stateless, no WA client) ] → persist msg + enqueue
                                    │
                          [ Redis + BullMQ queue ]  ← idempotency/dedupe keys
                        (delayed jobs, backoff, DLQ, rate limit)
                                    │  pull
                 [ Worker × N ] → MessagingProvider adapter → Cloud API (HTTPS)
                                    │
             Meta status + inbound webhooks → /api/wa/webhook → update status,
                                                                fire automations
Shared state: Postgres (replaces embedded SQLite) + Redis
Cross-cutting: /healthz + /readyz, Prometheus metrics, pino JSON logs, per-service Docker
```
**Reused from current code (a lot):** `src/transports/index.js` is already a provider port; `ingestInbound()` is already idempotent per `wa_message_id` and provider-agnostic; the `messages` table already has `status / attempts / next_attempt_at / delivered_at / read_at`; the `message_ack`→status mapping becomes the webhook status handler almost verbatim; suppressions, quiet-hours, templating, follow-ups are all channel-independent.
**Replaced:** in-memory queue → BullMQ; `client.sendMessage` (Chromium) → HTTPS; all Chromium lifecycle code → deleted; embedded SQLite → Postgres; in-memory rate limiter → Redis.
**Migration path keeps CRM live:** formalize the `MessagingProvider` port, add a Cloud API adapter alongside web.js selected by `WA_PROVIDER=cloud|webjs`, introduce the queue, shadow/canary a test number, then scale out and decommission web.js. Both providers share `ingestInbound`/status handling, so `WA_PROVIDER` is an instant rollback at any phase.

---

## 2. Problems Found

### WhatsApp / runtime (architecture)
- **A1 (Critical):** Outbound send is broken — `Cannot read properties of undefined (reading 'id')` thrown inside `window.WWebJS.sendMessage`; reproduced across two pinned WA-Web versions → not version-fixable.
- **A2 (Critical):** A WhatsApp page-reload threw `Execution context was destroyed` as an unhandled rejection and **crashed the whole server** (observed 3×).
- **A3 (High):** Messages claimed as `status='sending'` are **never recovered** after a crash — a permanent lost-message class.
- **A4 (High):** `failed` messages are **never retried** — `attempts`/`next_attempt_at` columns exist but no code re-enqueues them. Transient failures are terminal.
- **A5 (High):** In-memory queue + in-memory rate limiter + single Chromium session → cannot run >1 process; no horizontal scaling.

### Security (OWASP)
- **S1 (Critical):** Broken tenant isolation — signup/OAuth create no org/membership, so a user with no membership defaults to **org 1** and reads/writes tenant 1's data (`src/tenancy.js` `tenantContext`, `src/routes/auth.js`, `src/routes/oauth.js`).
- **S2 (High):** Password-reset link poisoning via `Host` header — `publicBase()` trusts `req.get('host')` when `PUBLIC_BASE_URL` unset → attacker receives victim's reset token (`src/routes/auth.js`).
- **S3 (High):** `/api/wa/diagnostics` / `status` / `qr` had **no permission or org scoping** — any authenticated user (any org) could read the QR and the platform's most-recent inbound messages. **[FIXED — §3]**
- **S4 (High):** `xlsx@0.18.5` — prototype-pollution + ReDoS, **no npm fix** — parsed on the authenticated import route.
- **S5 (High/audit):** `nodemailer < 8.0.4` — SMTP command injection (fix available: upgrade).
- **S6 (Medium):** Voice webhook accepted forged events when no secret configured, even in prod. **[FIXED — §3]**
- **S7 (Medium):** Stripe webhook has no timestamp/replay check (`src/routes/billing.js`).
- **S8 (Medium):** `GET /api/settings/` had no authorization. **[FIXED — §3]**
- **S9 (Medium):** SSRF in `downloadAvatar` — fetches arbitrary `http(s)` URLs, follows redirects, no private-IP block (`src/whatsapp.js`).
- **S10 (Medium):** CSP allows `unsafe-inline`/`unsafe-eval` for scripts even in prod build (`src/security.js`).
- **S11 (Low):** Login brute-force keyed by IP only, no per-account lockout. Email-open tracking-pixel IDOR. Signup bypasses the central validator.
- **Verified OK:** parameterized SQL throughout (no injection), scrypt+salt+timingSafeEqual passwords, session rotation on login, HttpOnly/SameSite/Secure cookies, OAuth state CSRF, no CORS exposure, secrets git-ignored + redacted in API, no secrets logged.

### Data integrity / CRM
- **D1 (Critical):** `vendors.phone` is **globally UNIQUE** (`src/db.js`), not per-org → cross-tenant import can overwrite another org's contact (`ON CONFLICT(phone)`); cross-tenant create throws.
- **D2 (Critical):** Background jobs (scheduler, WhatsApp ingest, automations) write with **no `organization_id`** → every tenant's follow-ups/sends/inbound default to org 1.
- **D3 (Critical):** CSV/XLSX export vulnerable to **spreadsheet formula injection**. **[FIXED — §3]**
- **D4 (High):** Unbounded list endpoints (vendors default `limit=1000000`; deals/companies/tickets/calendar no LIMIT) → memory blowup at scale. **[vendors FIXED — §3; others staged]**
- **D5 (High):** Reports do N+1 / load whole tables into Node (`src/routes/reports.js`).
- **D6 (High):** WAL on but **no `busy_timeout`** → `SQLITE_BUSY` under concurrent writes. **[FIXED — §3]**
- **D7 (High):** Missing composite indexes on hot org-scoped sort/filter paths.
- **D8 (Medium):** `PUT /deals/:id/stage` could assign another org's stage. **[FIXED — §3]**

### Code quality / ops
- **Q1:** Junk dependency `"22": "^0.0.0"`. **[FIXED — §3]**
- **Q2:** `require('puppeteer')` (not a dependency) always threw and was swallowed → the Chrome fallback never ran. **[FIXED — §3]**
- **Q3:** No graceful shutdown (SIGTERM/SIGINT) → Chromium orphaned, DB not closed on `docker stop`. **[FIXED — §3]**
- **Q4:** No unauthenticated health endpoint / no compose healthcheck. **[/healthz FIXED — §3]**
- **Q5:** Async route handlers don't reach the error middleware (Express 4) → a throw becomes an unhandled rejection and the request **hangs** until client timeout. **[staged]**
- **Q6:** `console.log` everywhere, no structured logger / request-id correlation.
- **Q7:** `Three/` folder is git-tracked dead code (12 files mirroring `public/`); committed `.DS_Store`; stray `Whatsapp ai agent automation/` on disk.
- **Q8:** Thin tests (2 smoke scripts in `npm test`); no CI; singleton coupling to `db`/`client` hurts testability.
- **Q9:** Prod build still loads React from `unpkg.com` CDN at runtime.

---

## 3. Problems Fixed (implemented & verified this pass)

All applied to the working tree; server reboots clean, `/healthz` 200, login 200, Leads list intact at 370, `npm test` smoke suite PASSED.

| # | Fix | File(s) |
|---|---|---|
| F1 | **Crash guard** — `unhandledRejection`/`uncaughtException` handlers so a WhatsApp/puppeteer async error logs instead of killing the CRM (fixes A2) | `server.js` |
| F2 | **Graceful shutdown** — SIGTERM/SIGINT → `server.close()` + stop scheduler + `wa.shutdown()` (destroys Chromium) + `db.close()`, with a 10s hard-kill fallback; plus `server.on('error')` for boot failures (Q3) | `server.js`, `src/whatsapp.js` |
| F3 | **`/healthz`** unauthenticated liveness/readiness probe (db + WA status + uptime) for LB/Docker/monitors (Q4) | `server.js` |
| F4 | **WA endpoints locked down** — `status`/`qr`/`diagnostics` now require `whatsapp.admin`; diagnostics queries **org-scoped** (fixes S3 cross-tenant leak) | `server.js` |
| F5 | **CSV + XLSX formula-injection neutralized** — cells starting with `= + - @ \t \r` are prefixed with `'` (fixes D3) | `src/routes/vendors.js` |
| F6 | **Vendors list DoS cap** — `limit` default 2000 / hard-max 5000 (was 1,000,000), offset validated; non-breaking for current UI (fixes D4-vendors) | `src/routes/vendors.js` |
| F7 | **Deal stage IDOR guard** — 404 if the target stage isn't in the caller's org before the update (fixes D8) | `src/routes/deals.js` |
| F8 | **Voice webhook fails closed** in production when no secret is configured (fixes S6) | `src/routes/voice.js` |
| F9 | **`GET /api/settings/` authorization** — now `requirePerm('settings.manage')` (fixes S8) | `src/routes/settings.js` |
| F10 | **`busy_timeout=5000` + `synchronous=NORMAL`** pragmas — no more immediate `SQLITE_BUSY` under concurrent writes (fixes D6) | `src/db.js` |
| F11 | **puppeteer→puppeteer-core** require fixed (removes a silently-swallowed MODULE_NOT_FOUND) (fixes Q2) | `src/whatsapp.js` |
| F12 | **Removed junk `"22"` dependency** (Q1) | `package.json` |
| F13 | Pinned current `WA_WEB_VERSION` (did not fix the send bug — kept as documented knob) | `.env` |

---

## 4. Security Improvements
Delivered now: cross-tenant WhatsApp data-leak closed (F4); export formula-injection closed (F5); an IDOR on deal stages closed (F7); two unauthenticated/forgeable endpoints hardened (F8, F9); a DoS vector capped (F6). **Still owner-required / staged (high priority):** S1 (create org+membership on signup; deny missing-membership instead of defaulting to org 1), S2 (require `PUBLIC_BASE_URL`, stop trusting `Host`), S4 (replace `xlsx` with the patched SheetJS CDN build or restrict to CSV), S5 (`nodemailer ≥ 8.0.4`), S7 (Stripe replay window), S9 (SSRF private-IP block in `downloadAvatar`), S10 (tighten prod CSP), S11 (per-account login lockout; HMAC tracking-pixel token).

## 5. Performance Improvements
Delivered: `busy_timeout` + `synchronous=NORMAL` (F10) removes spurious write failures and improves WAL throughput; list-size cap (F6) prevents multi-hundred-MB responses. **Staged:** push report aggregation into SQL (kill N+1 and in-memory table loads, D5); add composite indexes `(organization_id, updated_at)` on vendors, `(organization_id, created_at)` on deals, `(organization_id, city)` on vendors, `(direction, status, sent_at)` on messages (D7); FTS5 for search instead of leading-wildcard `LIKE`.

## 6. Scalability Improvements
Delivered: graceful shutdown + health endpoint make the app safe to run under an orchestrator that restarts/rolls it. **Staged (the core of the 1,000+/day goal):** Cloud API provider (stateless sends), Redis/BullMQ queue with backoff + DLQ + idempotent job ids, N stateless workers, Redis-backed rate limiter, Postgres for shared multi-writer state, per-tenant phone numbers. Also fix the queue durability bugs (A3 re-queue stranded `sending`; A4 retry `failed` with exponential backoff off `next_attempt_at`).

## 7. Remaining Risks
- **Sending is still non-functional** on web.js (A1) — only the Cloud API migration truly resolves it. Until then, outbound WhatsApp cannot be relied on.
- **Multi-tenant data leakage (S1/D1/D2)** is latent — harmless while only org 1 exists, **actively dangerous the moment a second org/user is onboarded**. Do S1+D1+D2 before any multi-tenant use.
- **`xlsx` (S4)** has no npm fix; a malicious upload is a live risk on the import route until replaced.
- **Async-handler gap (Q5):** some routes can hang a request on a thrown error until client timeout.
- **Single-instance today:** in-memory queue/rate-limiter/WA session mean you cannot yet run more than one process — documented constraint until the queue/Redis work lands.

## 8. Production Readiness Checklist
**Owner: me (done)** ✅ crash guard · ✅ graceful shutdown · ✅ /healthz · ✅ WA endpoints authz+org-scoped · ✅ export injection · ✅ list DoS cap · ✅ deal IDOR · ✅ voice webhook fail-closed · ✅ settings authz · ✅ busy_timeout · ✅ puppeteer-core · ✅ drop junk dep · ✅ smoke tests green.

**Owner: you (decisions / provisioning) — blockers for "enterprise-grade":**
- [ ] **Provision WhatsApp Cloud API** — Meta Business account, WABA, registered phone number, permanent access token, verified webhook. _(Account creation + secrets — I can build the adapter, you must provision.)_
- [ ] Stand up **Redis** + **Postgres** (managed or containers).
- [ ] Decide campaign→**approved-template** migration (Cloud API 24h window rules).
- [ ] Set prod env: `NODE_ENV=production`, `PUBLIC_BASE_URL`, `TRUST_PROXY`, `WEBHOOK_SIGNATURE_REQUIRED=1`, all webhook secrets. (Several protections — Secure cookies, HSTS, fail-closed webhooks — only engage in production with these set.)

**Owner: me (staged, safe to implement next, in priority order):**
- [ ] S1 + D1 + D2 tenant isolation (org/membership on signup; `UNIQUE(organization_id, phone)`; thread `organization_id` through background writes). _Includes a live-data migration — do on a backup/staging copy first._
- [ ] MessagingProvider port + Cloud API adapter behind `WA_PROVIDER`; generalize `/api/wa/webhook` for Meta envelopes.
- [ ] BullMQ queue + workers; fix A3/A4 durability; Redis rate limiter.
- [ ] Replace `xlsx` (S4); `nodemailer≥8.0.4` (S5); `npm audit fix` the moderates.
- [ ] `asyncHandler` wrapper (Q5); pino + request-id (Q6); composite indexes + SQL-side reports (D5/D7).
- [ ] Postgres migration; Docker healthcheck; CI (node:test + smoke) with `DB_PATH` override.
- [ ] Remove `Three/` dead code + committed `.DS_Store` (Q7); vendor React locally (Q9).

---
_Fixes in this pass are additive and reversible via git. The tenant-isolation and Cloud API work should proceed on a staging copy of the database, not directly against the live 370-contact DB._
