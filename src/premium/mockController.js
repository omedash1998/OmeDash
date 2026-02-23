// src/premium/mockController.js
// Dev-only handlers for toggling premium and simulating Stripe webhooks.
// Only mounted when PREMIUM_DEV === 'true'.

const { admin, fireDb } = require('../firebase');
const expiry = require('./expiry');

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * POST /premium/toggle-dev
 * Body: { on: true | false }
 * Requires authentication (req.uid set by auth middleware).
 */
async function toggleDev(req, res) {
  try {
    const uid = req.uid;
    if (!uid) return res.status(401).json({ error: 'auth_required' });

    const on = req.body && req.body.on === true;
    const userRef = fireDb.collection('users').doc(uid);

    if (on) {
      await userRef.set(
        {
          isPremium: true,
          premiumExpiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
        },
        { merge: true }
      );
    } else {
      await userRef.set(
        {
          isPremium: false,
          premiumExpiresAt: null,
        },
        { merge: true }
      );
    }

    // Audit
    await fireDb.collection('adminActions').add({
      uid,
      action: 'setPremium',
      by: 'dev',
      newValue: on,
      ts: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Invalidate cache
    expiry.cache.del(`premium:${uid}`);

    return res.json({ ok: true, isPremium: on });
  } catch (err) {
    console.error('[mockController] toggleDev error:', err);
    return res.status(500).json({ error: 'internal' });
  }
}

/**
 * POST /premium/mock-webhook
 * Body: { uid, event }
 * Simulates a Stripe checkout.session.completed webhook.
 * Dev-only, no auth required (simulates external webhook).
 */
async function mockWebhook(req, res) {
  try {
    const { uid, event } = req.body || {};

    if (!uid || !event) {
      return res.status(400).json({ error: 'missing uid or event' });
    }

    if (event === 'checkout.session.completed') {
      const userRef = fireDb.collection('users').doc(uid);
      await userRef.set(
        {
          isPremium: true,
          premiumExpiresAt: new Date(Date.now() + THIRTY_DAYS_MS),
        },
        { merge: true }
      );

      await fireDb.collection('adminActions').add({
        uid,
        action: 'setPremium',
        by: 'stripe-webhook',
        newValue: true,
        ts: admin.firestore.FieldValue.serverTimestamp(),
      });

      expiry.cache.del(`premium:${uid}`);

      return res.json({ ok: true, isPremium: true });
    }

    return res.status(400).json({ error: 'unsupported_event' });
  } catch (err) {
    console.error('[mockController] mockWebhook error:', err);
    return res.status(500).json({ error: 'internal' });
  }
}

module.exports = { toggleDev, mockWebhook };
