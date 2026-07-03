const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { body, S } = require('../validate');

const router = express.Router();

// --- Stripe config (all via env; nothing hard-coded) ------------------------
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
// Map plan keys -> Stripe Price IDs. Add more plans here as needed.
const PRICES = {
  pro: process.env.STRIPE_PRICE_PRO || '',
};
function isConfigured() { return !!STRIPE_SECRET; }
function publicBase(req) {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// Minimal Stripe REST client over fetch (no SDK dependency). Stripe expects
// application/x-www-form-urlencoded with bracket notation for nested fields.
function encodeForm(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) encodeForm(v, key, out);
    else if (Array.isArray(v)) v.forEach((item, i) => {
      if (typeof item === 'object') encodeForm(item, `${key}[${i}]`, out);
      else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(item)}`);
    });
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out;
}
async function stripe(path, params) {
  const r = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: encodeForm(params).join('&'),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `stripe_${r.status}`);
  return data;
}

// --- Status -----------------------------------------------------------------
router.get('/status', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  const u = db.prepare(`SELECT plan, subscription_status, current_period_end, stripe_customer_id FROM users WHERE id = ?`)
    .get(req.user.id) || {};
  res.json({
    configured: isConfigured(),
    plan: u.plan || 'free',
    status: u.subscription_status || null,
    current_period_end: u.current_period_end || null,
    has_customer: !!u.stripe_customer_id,
    plans: Object.keys(PRICES).filter((k) => PRICES[k]),
  });
});

// --- Checkout (upgrade) -----------------------------------------------------
router.post('/checkout', body({ plan: S.string({ maxLength: 60 }) }), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (!isConfigured()) return res.status(503).json({ error: 'billing_not_configured' });
  const plan = String(req.body?.plan || 'pro');
  const price = PRICES[plan];
  if (!price) return res.status(400).json({ error: 'unknown_plan', plan });
  try {
    const u = db.prepare(`SELECT stripe_customer_id, email FROM users WHERE id = ?`).get(req.user.id);
    const base = publicBase(req);
    const session = await stripe('checkout/sessions', {
      mode: 'subscription',
      'line_items': [{ price, quantity: 1 }],
      success_url: `${base}/?billing=success`,
      cancel_url: `${base}/?billing=cancel`,
      client_reference_id: String(req.user.id),
      customer: u?.stripe_customer_id || undefined,
      customer_email: !u?.stripe_customer_id && u?.email ? u.email : undefined,
      metadata: { user_id: String(req.user.id), plan },
      subscription_data: { metadata: { user_id: String(req.user.id), plan } },
    });
    res.json({ url: session.url, id: session.id });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// --- Customer portal (downgrade / cancel / update card) ---------------------
router.post('/portal', body({}), async (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  if (!isConfigured()) return res.status(503).json({ error: 'billing_not_configured' });
  const u = db.prepare(`SELECT stripe_customer_id FROM users WHERE id = ?`).get(req.user.id);
  if (!u?.stripe_customer_id) return res.status(400).json({ error: 'no_subscription' });
  try {
    const session = await stripe('billing_portal/sessions', {
      customer: u.stripe_customer_id,
      return_url: `${publicBase(req)}/?billing=portal`,
    });
    res.json({ url: session.url });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// --- Webhook (public; signature-verified) -----------------------------------
// Mounted with req.rawBody available (server.js captures it in express.json verify).
function verifyStripeSig(rawBody, header, secret) {
  if (!secret) return true; // dev mode: accept if no secret set (logged elsewhere)
  if (!header || !rawBody) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const signedPayload = `${parts.t}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1 || ''));
  } catch (_) { return false; }
}

function applySubscription(userId, sub) {
  if (!userId) return;
  const plan = sub?.metadata?.plan || 'pro';
  db.prepare(`
    UPDATE users SET stripe_subscription_id = ?, subscription_status = ?, current_period_end = ?,
      plan = CASE WHEN ? IN ('active','trialing') THEN ? ELSE 'free' END WHERE id = ?
  `).run(
    sub?.id || null,
    sub?.status || null,
    sub?.current_period_end ? sub.current_period_end * 1000 : null,
    sub?.status || '', plan, userId,
  );
}

router.post('/webhook', (req, res) => {
  if (!verifyStripeSig(req.rawBody, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET)) {
    return res.status(400).json({ error: 'invalid_signature' });
  }
  let event;
  try { event = JSON.parse(req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body)); }
  catch (e) { return res.status(400).json({ error: 'bad_payload' }); }
  try {
    const obj = event.data?.object || {};
    switch (event.type) {
      case 'checkout.session.completed': {
        const userId = Number(obj.client_reference_id || obj.metadata?.user_id) || null;
        if (userId && obj.customer) {
          db.prepare(`UPDATE users SET stripe_customer_id = ? WHERE id = ?`).run(obj.customer, userId);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const userId = Number(obj.metadata?.user_id) ||
          (db.prepare(`SELECT id FROM users WHERE stripe_customer_id = ?`).get(obj.customer)?.id) || null;
        applySubscription(userId, event.type.endsWith('deleted') ? { ...obj, status: 'canceled' } : obj);
        break;
      }
      default: break;
    }
    db.prepare(`INSERT INTO audit_log (event, detail) VALUES ('stripe_webhook', ?)`).run(String(event.type).slice(0, 120));
  } catch (e) {
    console.error('[billing] webhook handling error:', e.message);
  }
  res.json({ received: true });
});

module.exports = router;
