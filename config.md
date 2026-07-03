# Autonomous WhatsApp Assistant — Configuration

This file records the choices made during setup. Plain-English notes for a non-technical owner.

## Phase 0 — Ground rules

### 1. WhatsApp number to run on ✅ CONFIRMED
- **Number:** 8396066410
- **Country code:** +91 (India) — full international digits for pairing: `918396066410`
- **Spare or main?** SPARE number (confirmed).
- **Backup number ready?** Yes (confirmed).
- **Risk accepted:** This is an unofficial WhatsApp Web connection (whatsmeow). WhatsApp CAN ban a number for bot-like behavior. Using a spare with a backup ready.

### 2. Awake hours + timezone ✅ CONFIRMED
- **Timezone:** IST (Asia/Kolkata, +05:30)
- **Awake / active hours:** 09:00 → 24:00 (9am to midnight)
- **Quiet window:** 00:00 → 09:00 — assistant should NOT reply, or reply very slowly/rarely if 24/7 is ever turned on.

### 3. Normal messages per day (for sending caps)
- _pending (Step 3)_

### 4. Claude Code subscription confirmed
- _pending (Step 4)_

## Notes
- The BRAIN is Claude Code on the user's subscription (no API key, no per-message bill).
- WhatsApp bridge repo: https://github.com/verygoodplugins/whatsapp-mcp (personal WhatsApp Web via whatsmeow, NOT the Business API).
