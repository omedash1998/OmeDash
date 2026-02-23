// src/premium/matcher.js
// Computes a matchmaking boost for premium users based on their preferences.
// Called from the main matchmaking loop (only when PREMIUM_DEV === 'true').
//
// Scoring rules:
//   +5  if premiumUser.countryPref === candidate.countryCode
//   +3  if premiumUser.genderPref === candidate.gender
//   Returns 0 if the requesting user is not an active premium subscriber.

const LRUCache = require('./cache');
const expiry = require('./expiry');
const { fireDb } = require('../firebase');

/** Short-lived user-data cache so we don't re-read the same doc inside one matching sweep */
const userCache = new LRUCache({ max: 500, ttl: 30000 });

/**
 * Read a user document, with caching.
 * @param {string} uid
 * @returns {Promise<object|null>}
 */
async function getUser(uid) {
  const key = `user:${uid}`;
  const cached = userCache.get(key);
  if (cached !== undefined) return cached;

  const snap = await fireDb.collection('users').doc(uid).get();
  const data = snap.exists ? snap.data() : null;
  userCache.set(key, data);
  return data;
}

/**
 * Calculate a premium-based boost to add to the base match score.
 *
 * @param {string} premiumUid    – the user requesting a match (may or may not be premium)
 * @param {string} candidateUid  – a potential match partner
 * @returns {Promise<number>}      boost value (0 if not premium or no matching prefs)
 */
async function scoreCandidate(premiumUid, candidateUid) {
  try {
    const active = await expiry.isActive(premiumUid);
    if (!active) return 0;

    const [premiumUser, candidate] = await Promise.all([
      getUser(premiumUid),
      getUser(candidateUid),
    ]);

    if (!premiumUser || !candidate) return 0;

    let boost = 0;

    if (
      premiumUser.countryPref &&
      candidate.countryCode &&
      premiumUser.countryPref === candidate.countryCode
    ) {
      boost += 5;
    }

    if (
      premiumUser.genderPref &&
      premiumUser.genderPref !== 'any' &&
      candidate.gender &&
      premiumUser.genderPref === candidate.gender
    ) {
      boost += 3;
    }

    return boost;
  } catch (err) {
    console.error('[matcher] scoreCandidate error:', err);
    return 0;
  }
}

module.exports = { scoreCandidate, userCache };
