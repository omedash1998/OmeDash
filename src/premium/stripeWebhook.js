// src/premium/stripeWebhook.js
// ─────────────────────────────────────────────────────────────
// Placeholder for a real Stripe webhook handler.
// DO NOT implement real Stripe calls until STRIPE_WEBHOOK_SECRET
// is configured in .env and the Stripe SDK is installed.
// ─────────────────────────────────────────────────────────────

const express = require('express');
const router = express.Router();

// const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
// const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * POST /premium/stripe-webhook
 *
 * In production this endpoint receives raw body from Stripe.
 * Express must NOT parse JSON for this route — use express.raw().
 *
 * Example mount (in src/premium/index.js):
 *   router.post('/stripe-webhook',
 *     express.raw({ type: 'application/json' }),
 *     stripeWebhook);
 *
 * Verification sketch:
 * ─────────────────────
 *   const sig = req.headers['stripe-signature'];
 *   let event;
 *   try {
 *     event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
 *   } catch (err) {
 *     console.error('[stripeWebhook] Signature verification failed:', err.message);
 *     return res.status(400).send(`Webhook Error: ${err.message}`);
 *   }
 *
 * Event handling sketch:
 * ──────────────────────
 *   switch (event.type) {
 *
 *     case 'checkout.session.completed': {
 *       // Customer just paid — activate premium
 *       const session = event.data.object;
 *       const uid = session.metadata.uid; // must be set when creating Checkout session
 *       await fireDb.collection('users').doc(uid).set({
 *         isPremium: true,
 *         premiumExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
 *       }, { merge: true });
 *       await fireDb.collection('adminActions').add({
 *         uid, action: 'setPremium', by: 'stripe-webhook',
 *         newValue: true, ts: admin.firestore.FieldValue.serverTimestamp(),
 *       });
 *       expiry.cache.del(`premium:${uid}`);
 *       break;
 *     }
 *
 *     case 'invoice.payment_succeeded': {
 *       // Recurring payment succeeded — extend expiry
 *       const invoice = event.data.object;
 *       const uid = invoice.subscription_details?.metadata?.uid;
 *       if (uid) {
 *         await fireDb.collection('users').doc(uid).set({
 *           isPremium: true,
 *           premiumExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
 *         }, { merge: true });
 *         expiry.cache.del(`premium:${uid}`);
 *       }
 *       break;
 *     }
 *
 *     case 'customer.subscription.deleted': {
 *       // Subscription cancelled — revoke premium
 *       const subscription = event.data.object;
 *       const uid = subscription.metadata?.uid;
 *       if (uid) {
 *         await fireDb.collection('users').doc(uid).set({
 *           isPremium: false, premiumExpiresAt: null,
 *         }, { merge: true });
 *         await fireDb.collection('adminActions').add({
 *           uid, action: 'setPremium', by: 'stripe-webhook',
 *           newValue: false, ts: admin.firestore.FieldValue.serverTimestamp(),
 *         });
 *         expiry.cache.del(`premium:${uid}`);
 *       }
 *       break;
 *     }
 *
 *     default:
 *       console.log('[stripeWebhook] Unhandled event type:', event.type);
 *   }
 *
 *   res.json({ received: true });
 */

router.post(
  '/stripe-webhook',
  // express.raw({ type: 'application/json' }),   // uncomment when wiring real Stripe
  (req, res) => {
    // Placeholder — return 501 until real Stripe is configured
    res.status(501).json({
      error: 'stripe_not_configured',
      message:
        'Set STRIPE_WEBHOOK_SECRET and STRIPE_SECRET_KEY in .env, then implement verification in this file.',
    });
  }
);

module.exports = router;
