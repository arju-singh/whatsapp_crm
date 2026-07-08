# Voice AI Agent

An autonomous, multilingual AI **sales caller** built into the CRM. It phones a
contact, introduces itself honestly as an AI, detects and speaks the caller's
language, discovers their needs, pitches the right offering, handles objections,
books a meeting, and files a transcribed, sentiment-scored call record — using
the **same tool/CRM layer** the WhatsApp AI agent already uses. One brain across
text and voice.

> The live speech pipeline (STT → LLM → TTS, turn-taking, barge-in) runs inside a
> managed provider (**Vapi** or **Retell**). This app is the provider's **tool
> layer** and **system-of-record**. That's the fast, reliable split — you don't
> build real-time audio; you own the reasoning tools, the data, and the analytics.

## Architecture

```
 POST /api/voice/dial ──► telephony(vapi|retell) ──► provider places the call
                                                          │
              caller speaks ◄── STT ─ LLM ─ TTS ◄─────────┘   (in the provider)
                                     │
                     tool call / status / end-of-call
                                     ▼
              POST /api/voice/webhook  (public, shared-secret verified)
                                     ▼
                    src/voice-agent.js  ── executeTool() ──► CRM
                       ├ lookup_contact / get_deal_context      (read)
                       ├ knowledge_base_search  (RAG over kb_articles)
                       ├ log_call_outcome       (calls + vendor score/status)
                       ├ schedule_meeting       (calendar_events + task)
                       ├ schedule_followup      (task)
                       ├ send_whatsapp_summary   (reuses WhatsApp transport)
                       └ human_handoff          (flag + task + notification)
                                     ▼
              end-of-call ─► transcript + summary + sentiment + lead score
                             stored on the calls row + call_events
```

### Files

| File | Role |
|---|---|
| `src/modules/voice/module.js` | Module manifest: schema migration, permissions (`voice.read/make/manage`), nav. |
| `src/voice-agent.js` | The brain: assistant/prompt builder, tool schemas, `executeTool()`, webhook ingestion, analytics. |
| `src/telephony/index.js` | `vapi` + `retell` providers (real REST) alongside the existing `log`/`twilio` dialers. |
| `src/routes/voice.js` | Public `/webhook` + authed `/dial`, `/`, `/:id`, `/stats/summary`, `/config`, `/providers`, `/kb`. |
| `public/voice-console.html` | Dashboard: KPIs, place-a-call, recent calls + transcript viewer, knowledge base. |
| `scripts/smoke-voice.js` | End-to-end smoke test (schema → tools → webhooks → analytics). |

Design mirrors the existing `calling` module and `ai-agent.js`: dependency-light
(no SDKs — raw HTTPS), settings/env-driven, multi-tenant (`organization_id` +
`orgFilter`), and it **degrades gracefully** — with nothing configured it records
dry-run calls so the whole flow works out of the box.

## Quick start

1. **Open the console:** `/voice-console.html` (behind your normal login).
2. **Dry-run first (no setup):** enter a contact ID and click *Call now*. It
   records a dry-run `calls` row so you can see the pipeline before wiring a carrier.
3. **Add knowledge:** add a few facts (pricing, features) so the agent answers
   from truth instead of offering to follow up. It **never invents** facts.

## Going live (Vapi)

1. Create a [Vapi](https://vapi.ai) account, buy/import a phone number, grab your
   **API key** and the **phoneNumberId**.
2. Add your LLM/voice credentials **inside Vapi** (e.g. Anthropic for the model,
   ElevenLabs for TTS, Deepgram for STT) — the assistant we send references these
   providers by name.
3. In **Settings** (or `.env`) set:
   - `voice_provider = vapi`
   - `voice_vapi_key`, `voice_vapi_phone_number_id`
   - `public_base_url = https://your-crm-domain` (the provider must reach the webhook)
   - `voice_webhook_secret = <a long random string>` (verified on every webhook)
   - Persona: `voice_agent_name`, `voice_company_name`, `voice_products`
     (one `Name — what it solves` per line).
4. Place a call. Mid-call tool calls and the end-of-call transcript/summary will
   flow into the call record and the console.

> **Retell** works the same way: set `voice_provider = retell`, `voice_retell_key`,
> `voice_retell_agent_id`, `voice_retell_from_number`. The agent's turn-taking is
> configured in Retell's dashboard; we pass the greeting + system prompt as dynamic
> variables and the CRM linkage as metadata.

All keys are settable per-org in **Settings** (DB overrides env); the three
secrets (`voice_webhook_secret`, `voice_vapi_key`, `voice_retell_key`) are
redacted by the settings API.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/api/voice/webhook` | shared secret | Provider events (tool-calls, status, end-of-call). Public. |
| `POST` | `/api/voice/dial` | `voice.make` | Place an AI call to `{ vendor_id, product? }`. |
| `GET` | `/api/voice` | session | Recent AI calls. |
| `GET` | `/api/voice/:id` | session | Call detail + turn-by-turn transcript. |
| `GET` | `/api/voice/stats/summary?days=30` | session | Answer rate, qualified, meetings, sentiment, languages, spend. |
| `GET` | `/api/voice/config` / `/providers` | session | Persona + provider readiness. |
| `GET/POST/PUT/DELETE` | `/api/voice/kb` | `voice.read`/`voice.manage` | Knowledge-base facts (RAG source). |

## Compliance notes (India / general)

- **Honesty:** the agent identifies as an AI in its greeting and whenever asked —
  by design, and better for trust/compliance than denial.
- **Recording consent:** recording is on by default (`voice_recording`). Add a
  one-line disclosure to `voice_first_message` if you record for QA in a
  jurisdiction that requires it.
- **Opt-out:** the `do_not_contact` outcome and `send_whatsapp_summary` both honour
  the existing **suppression list**; `/dial` refuses suppressed numbers.
- **DLT/TRAI:** outbound business calls at scale in India need DLT registration —
  handle at the carrier/number level before scaling volume.
- **Human handoff:** set `voice_handoff_number` so the agent can transfer angry or
  complex callers; every handoff also creates a high-priority task + notification.

## Not yet built (roadmap)

The engine is production-shaped and multi-tenant, but a full enterprise rollout
would still add: a **vector** knowledge base (today's RAG is keyword `LIKE` over
`kb_articles` — good enough for hundreds of facts, swap for embeddings at scale),
**A/B script testing**, per-call **cost budgets/caps**, inbound-call assistant
serving (`assistant-request`), and infra manifests (**K8s/Helm**) beyond the
existing Docker/Compose setup. These are additive — none change the seams above.

## Test

```bash
node scripts/smoke-voice.js      # schema → tools → webhooks → analytics, self-cleaning
```
