// src/premium/expiry.js
// Determines whether a user's premium subscription is currently active.
// Uses an LRU cache (TTL 60 s) so repeated checks within the same minute
// do not hit Firestore.  The cache is exported so that toggle-dev /
// webhook handlers can invalidate it immediately after a state change.

const LRUCache = require('./cache');
const { admin, fireDb } = require('../firebase');

/** Shared cache – key format: `premium:<uid>` */
const cache = new LRUCache({ max: 1000, ttl: 60000 });

/**
 * Check whether the given uid has an active premium subscription.
 *
 * @param {string} uid  Firebase UID
 * @returns {Promise<boolean>}
 */
async function isActive(uid) {
  if (!uid) return false;

  const cacheKey = `premium:${uid}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const snap = await fireDb.collection('users').doc(uid).get();
    if (!snap.exists) {
      cache.set(cacheKey, false);
      return false;
    }

    const data = snap.data();
    const isPremium = data.isPremium === true;

    if (!isPremium) {
      cache.set(cacheKey, false);
      return false;
    }

    // premiumExpiresAt may be a Firestore Timestamp or null
    const expiresAt = data.premiumExpiresAt;
    if (!expiresAt) {
      // isPremium is true but no expiry → treat as active (lifetime / manual)
      cache.set(cacheKey, true);
      return true;
    }

    const expiresMs = expiresAt.toDate ? expiresAt.toDate().getTime() : expiresAt;
    const active = expiresMs > Date.now();

    cache.set(cacheKey, active);
    return active;
  } catch (err) {
    console.error('[expiry] isActive error for', uid, err);
    return false;
  }
}

module.exports = { isActive, cache };
