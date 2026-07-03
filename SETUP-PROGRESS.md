# Setup Progress — Autonomous WhatsApp Assistant

We tick these off as we go, so we never lose our place. One small step at a time.

## Phase 0 — Ground rules (asked one at a time, saved to config.md)
- [x] Step 1: Which number to run on — 918396066410 (spare, +91, backup ready) ✅
- [x] Step 2: Awake hours + timezone — IST, 9am–midnight ✅
- [ ] Step 3: Normal messages per day (sending cap)
- [ ] Step 4: Confirm Claude Code plan + logged in (no API key)

## Phase 1 — Learn how you text (the core magic)
- [ ] Collect your real WhatsApp chats (as many as possible)
- [ ] Write style-guide.md (your voice) + show summary & sample replies

## Phase 2 — Install the plumbing
- [ ] Detect OS; install/verify Go 1.24+, Python 3.11+, uv, FFmpeg
- [ ] Confirm each tool + `claude` works; note absolute paths

## Phase 3 — Connect WhatsApp (pairing code, not QR)
- [ ] Clone repo, build bridge
- [ ] Add opt-in pairing-code path to main.go
- [ ] Pre-flight checklist, then link with 8-char code
- [ ] Register WhatsApp tools with Claude Code (.mcp.json)

## Phase 4 + 5 — Build the always-on dispatcher (with safety)
- [ ] Read bridge source (ports, /api/send, /api/typing, token, messages.db)
- [ ] Build polling dispatcher that drafts replies via `claude -p`
- [ ] Ban-avoidance safety (timing, hours, caps, allowlist, log, PAUSE kill switch)

## Phase 6 — Go live 24/7
- [ ] Start bridge + dispatcher, auto-restart, live test

## Phase 7 — Hand over
- [ ] Write HOW-TO-RUN-THIS.md
