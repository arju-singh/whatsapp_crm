// ---------------------------------------------------------------------------
// WhatsApp Cloud API webhook router (Meta official provider).
//
// Mounted at /api/wa/cloud/webhook. Machine-to-machine — it authenticates itself
// (verify-token handshake on GET, X-Hub-Signature-256 HMAC on POST) and is
// whitelisted in PUBLIC_PATHS. Inbound messages and delivery/read/failed
// statuses flow through the SAME ingestInbound / applyStatusUpdate used by the
// whatsapp-web.js path, so both engines produce identical CRM side effects.
//
// Requires req.rawBody (the exact bytes) for signature verification — server.js
// captures it via the express.json `verify` hook; any host mounting this router
// must do the same.
// ---------------------------------------------------------------------------

const express = require('express');
const cloud = require('./cloud');

const router = express.Router();

// GET — Meta subscription verification: echo hub.challenge iff the token matches.
router.get('/', (req, res) => {
  const r = cloud.verifyToken({
    mode: req.query['hub.mode'],
    token: req.query['hub.verify_token'],
    challenge: req.query['hub.challenge'],
  });
  if (r.ok) return res.status(200).send(String(r.challenge == null ? '' : r.challenge));
  return res.status(403).json({ error: 'verification_failed' });
});

// POST — inbound messages + statuses, signature-verified.
router.post('/', (req, res) => {
  const wa = require('../whatsapp');
  const sig = cloud.verifySignature(req.rawBody || Buffer.from(''), req.get('x-hub-signature-256'));
  // Fail closed whenever an app secret is configured, or verification is forced
  // (WEBHOOK_SIGNATURE_REQUIRED=1 / production) — no forged events accepted.
  const mustVerify = cloud.hasAppSecret()
    || process.env.WEBHOOK_SIGNATURE_REQUIRED === '1'
    || process.env.NODE_ENV === 'production';
  if (!sig.ok && mustVerify) return res.status(401).json({ error: 'bad_signature' });

  const payload = req.body || {};
  try {
    for (const ev of cloud.parseInbound(payload)) {
      if (!ev.phone) continue;
      wa.ingestInbound({
        phone: ev.phone, body: ev.body, waMessageId: ev.waMessageId,
        pushname: ev.pushname, source: 'cloud',
      }).catch((e) => console.error('[wa:cloud] ingest failed:', e.message));
    }
    for (const st of cloud.parseStatuses(payload)) {
      if (st.status) wa.applyStatusUpdate(st.waMessageId, st.status, st.timestamp);
    }
    return res.json({ ok: true });
  } catch (e) {
    // 200 so Meta doesn't retry-storm on our processing bug (event is logged).
    console.error('[wa:cloud] webhook handler error:', e.message);
    return res.status(200).json({ ok: true, error: 'handler_error' });
  }
});

module.exports = router;
