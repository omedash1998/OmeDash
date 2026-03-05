// src/premium/index.js
// Express router for the Premium system.
// Mounted at /premium in server.js only when PREMIUM_DEV === 'true'.

const express = require('express');
const { admin, fireDb } = require('../firebase');
const expiry = require('./expiry');
const mockController = require('./mockController');
const { userCache: matcherUserCache } = require('./matcher');

const router = express.Router();

// ── Allowed values ──────────────────────────────────────────
const ALLOWED_COUNTRIES = ['US', 'MX', 'BR'];
const ALLOWED_GENDERS = ['any', 'male', 'female'];

// ── Simple in-memory rate limiter (per uid, 10 saves / minute) ──
// For production, replace with Redis sliding-window (see README).
const rateBuckets = new Map(); // uid → { count, resetAt }

function rateLimit(uid, maxPerMinute = 10) {
  const now = Date.now();
  let bucket = rateBuckets.get(uid);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60000 };
    rateBuckets.set(uid, bucket);
  }
  bucket.count += 1;
  return bucket.count > maxPerMinute;
}

// ── Auth middleware — verifies Firebase ID token ──────────────
async function authMiddleware(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'auth_required' });
    }
    const idToken = header.split('Bearer ')[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.uid = decoded.uid;
    next();
  } catch (err) {
    console.error('[premium auth]', err.message);
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// ── GET /premium/status ──────────────────────────────────────
router.get('/status', authMiddleware, async (req, res) => {
  try {
    if (process.env.PREMIUM_DEV !== 'true') {
      return res.json({ isPremium: false, countryPref: null, genderPref: null });
    }

    const snap = await fireDb.collection('users').doc(req.uid).get();
    const data = snap.exists ? snap.data() : {};

    const active = await expiry.isActive(req.uid);

    return res.json({
      isPremium: active,
      countryPref: data.countryPref || null,
      genderPref: data.genderPref || null,
    });
  } catch (err) {
    console.error('[premium] status error:', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// ── POST /premium/set-preferences ────────────────────────────
router.post('/set-preferences', authMiddleware, async (req, res) => {
  try {
    const uid = req.uid;

    // Must be active premium
    const active = await expiry.isActive(uid);
    if (!active) {
      return res.status(403).json({ error: 'need_payment' });
    }

    // Rate limit
    if (rateLimit(uid, 10)) {
      return res.status(429).json({ error: 'rate_limit', message: 'Max 10 saves per minute' });
    }

    const { countryPref, genderPref } = req.body || {};

    // Validate
    if (countryPref !== null && countryPref !== undefined && !ALLOWED_COUNTRIES.includes(countryPref)) {
      return res.status(400).json({ error: 'invalid_country', allowed: ALLOWED_COUNTRIES });
    }
    if (genderPref !== null && genderPref !== undefined && !ALLOWED_GENDERS.includes(genderPref)) {
      return res.status(400).json({ error: 'invalid_gender', allowed: ALLOWED_GENDERS });
    }

    await fireDb.collection('users').doc(uid).set(
      {
        countryPref: countryPref || null,
        genderPref: genderPref || null,
      },
      { merge: true }
    );

    // Invalidate matcher & expiry caches so matchmaking immediately sees the new prefs
    try { matcherUserCache.del(`user:${uid}`); } catch (_) {}
    try { expiry.cache.del(`premium:${uid}`); } catch (_) {}

    return res.json({ ok: true });
  } catch (err) {
    console.error('[premium] set-preferences error:', err);
    return res.status(500).json({ error: 'internal' });
  }
});

// ── Dev-only endpoints (toggle & mock webhook) ───────────────
if (process.env.PREMIUM_DEV === 'true') {
  router.post('/toggle-dev', authMiddleware, mockController.toggleDev);
  router.post('/mock-webhook', mockController.mockWebhook);
}

// ── Optional init(app, io) for future server-level setup ─────
function init(app, io) {
  // Reserved for future use (e.g. premium-specific socket namespaces)
  console.log('[premium] init called');
}

module.exports = { router, init };
