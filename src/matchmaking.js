// src/matchmaking.js
const { admin, fireDb } = require('./firebase');
const state = require('./state');

// We need an io reference to emit matched events.
let io;
function setIoInstance(ioInstance) {
    io = ioInstance;
}

// Premium matcher integration — loaded lazily and only when PREMIUM_DEV is enabled
let premiumMatcher = null;
function getPremiumMatcher() {
    if (process.env.PREMIUM_DEV !== 'true') return null;
    if (!premiumMatcher) {
        try { premiumMatcher = require('./premium/matcher'); } catch (_) { /* not available */ }
    }
    return premiumMatcher;
}

/**
 * When premium is enabled and the queue has ≥3 users, try to find the
 * best candidate for `aId` by scoring each waiting user.  Returns the
 * index of the best candidate (or 0 to fall back to FIFO).
 */
async function findBestCandidate(aId) {
    const matcher = getPremiumMatcher();
    if (!matcher) return 0;

    const { waiting, paused, socketUids } = state;
    const aUid = socketUids.get(aId);
    if (!aUid) return 0;

    let bestIdx = 0;
    let bestScore = 0;
    for (let i = 0; i < waiting.length; i++) {
        const cId = waiting[i];
        if (paused.has(cId)) continue;
        const cUid = socketUids.get(cId);
        if (!cUid) continue;
        try {
            const boost = await matcher.scoreCandidate(aUid, cUid);
            if (boost > bestScore) { bestScore = boost; bestIdx = i; }
        } catch (_) { /* ignore scoring errors */ }
    }
    return bestIdx;
}

// User data cache for gender filter (avoids re-reading Firestore every match attempt)
const _userGenderCache = new Map(); // uid -> { gender, genderPref, isPremium, ts }
const GENDER_CACHE_TTL = 30000; // 30s

async function getCachedUserGender(uid) {
    const cached = _userGenderCache.get(uid);
    if (cached && Date.now() - cached.ts < GENDER_CACHE_TTL) return cached;
    try {
        const snap = await fireDb.collection('users').doc(uid).get();
        if (!snap.exists) return null;
        const d = snap.data();
        const entry = {
            gender: d.gender || null,
            genderPref: d.genderPref || null,
            isPremium: d.isPremium === true || d.premium === true,
            ts: Date.now()
        };
        _userGenderCache.set(uid, entry);
        return entry;
    } catch (_) { return null; }
}

// Invalidate cache for a user (called when preferences change)
function invalidateGenderCache(uid) {
    _userGenderCache.delete(uid);
}

/**
 * Check if two users are gender-compatible for matching.
 * Premium users with a genderPref set get a hard filter.
 * Non-premium users or users with genderPref=null/any match anyone.
 */
async function areGenderCompatible(aUid, bUid) {
    const [aData, bData] = await Promise.all([
        getCachedUserGender(aUid),
        getCachedUserGender(bUid)
    ]);

    // If we can't read user data, allow match (fail open)
    if (!aData || !bData) return true;

    // Check A's filter: if A is premium and has a genderPref, B must match it
    if (aData.isPremium && aData.genderPref && aData.genderPref !== 'any') {
        if (bData.gender !== aData.genderPref) return false;
    }

    // Check B's filter: if B is premium and has a genderPref, A must match it
    if (bData.isPremium && bData.genderPref && bData.genderPref !== 'any') {
        if (aData.gender !== bData.genderPref) return false;
    }

    return true;
}

// Core matchmaking logic
// Future Scalability: This memory-based queue limits the app to a single process.
// To scale horizontally across multiple instances:
// 1. Replace the memory array with a Redis List (e.g., using `ioredis`).
// 2. Use a Redis locking mechanism (like Redlock) or a Lua script to ensure 
//    only one server pops and pairs two users at a time to prevent double-matching.
// 3. Store routing information (which server owns which socket) using Redis Pub/Sub
//    or Socket.io Redis Adapter to emit the "matched" event reliably.
async function tryMatch() {
    const { waiting, paused, pairs, socketRooms, socketUids } = state;

    while (waiting.length >= 2) {
        const aId = waiting.shift();
        // skip if paused or disconnected
        try {
            if (paused.has(aId)) continue;
        } catch (e) { /* ignore */ }

        // Find a compatible partner from the queue
        let bId = null;
        let bestIdx = -1;

        const aUid = socketUids.get(aId);

        // Premium boost: when enabled, pick the best candidate from the queue
        if (process.env.PREMIUM_DEV === 'true' && waiting.length > 1 && aUid) {
            try { bestIdx = await findBestCandidate(aId); } catch (_) { bestIdx = 0; }
        }

        // Gender filter: if user A has a premium gender filter, enforce it
        if (aUid) {
            const aData = await getCachedUserGender(aUid);
            const hasPremiumGenderFilter = aData && aData.isPremium && aData.genderPref && aData.genderPref !== 'any';

            if (hasPremiumGenderFilter) {
                // Scan queue for first gender-compatible candidate
                let foundIdx = -1;
                for (let i = 0; i < waiting.length; i++) {
                    const cId = waiting[i];
                    if (paused.has(cId)) continue;
                    const cUid = socketUids.get(cId);
                    if (!cUid) continue;
                    const compatible = await areGenderCompatible(aUid, cUid);
                    if (compatible) { foundIdx = i; break; }
                }

                if (foundIdx === -1) {
                    // No compatible partner — put A back at the end and stop this round
                    waiting.push(aId);
                    break;
                }
                bestIdx = foundIdx;
            } else if (bestIdx < 0) {
                bestIdx = 0;
            }
        } else if (bestIdx < 0) {
            bestIdx = 0;
        }

        // Also check if the chosen candidate B has a premium gender filter against A
        const candidateBId = waiting[bestIdx];
        if (candidateBId && aUid) {
            const bUid = socketUids.get(candidateBId);
            if (bUid) {
                const compatible = await areGenderCompatible(aUid, bUid);
                if (!compatible) {
                    // B's filter rejects A — skip B, try next candidate
                    // Put A back and let the loop re-process
                    waiting.push(aId);
                    break;
                }
            }
        }

        bId = waiting.splice(bestIdx, 1)[0];
        if (!bId) {
            waiting.unshift(aId);
            break;
        }

        try {
            if (paused.has(bId)) { waiting.unshift(aId); continue; }
        } catch (e) { /* ignore */ }

        // guard in case socket disconnected while waiting
        const a = io.sockets.sockets.get(aId);
        const b = io.sockets.sockets.get(bId);
        if (!a || !b) {
            if (a) waiting.unshift(aId);
            if (b) waiting.unshift(bId);
            continue;
        }

        pairs[aId] = bId;
        pairs[bId] = aId;

        // Create Firestore room — store roomId in Map BEFORE the await
        try {
            const roomRef = fireDb.collection('rooms').doc();
            // Set in Map immediately (doc() generates ID locally, no network needed)
            socketRooms.set(aId, roomRef.id);
            socketRooms.set(bId, roomRef.id);
            console.log('Firestore room creating:', roomRef.id, 'for', aId, '&', bId);

            const uidA = socketUids.get(aId);
            const uidB = socketUids.get(bId);

            let participantCountries = {};
            if (uidA && uidB) {
                try {
                    const [userASnap, userBSnap] = await Promise.all([
                        fireDb.collection('users').doc(uidA).get(),
                        fireDb.collection('users').doc(uidB).get()
                    ]);

                    if (userASnap.exists && userASnap.data().countryCode) {
                        const data = userASnap.data();
                        participantCountries[aId] = {
                            countryName: data.countryName || '',
                            countryCode: data.countryCode || '',
                            countryEmoji: data.countryEmoji || ''
                        };
                    }
                    if (userBSnap.exists && userBSnap.data().countryCode) {
                        const data = userBSnap.data();
                        participantCountries[bId] = {
                            countryName: data.countryName || '',
                            countryCode: data.countryCode || '',
                            countryEmoji: data.countryEmoji || ''
                        };
                    }
                } catch (e) {
                    console.error('Error fetching user countries for room:', e);
                }
            }

            await roomRef.set({
                participants: [aId, bId],
                participantCountries: participantCountries,
                createdAt: admin.firestore.FieldValue.serverTimestamp(),
                createdAtMs: Date.now(),  // JS timestamp for duration calculation
                state: 'active'
            });
            console.log('Firestore room created:', roomRef.id);

            // 10-second fallback: persist conversation proactively if room is still active
            if (uidA && uidB) {
                const { createQualifiedConversation } = require('./rooms');
                const capturedRoomId = roomRef.id;
                const capturedUidA = uidA;
                const capturedUidB = uidB;
                setTimeout(async () => {
                    try {
                        const roomSnap = await fireDb.collection('rooms').doc(capturedRoomId).get();
                        if (roomSnap.exists) {
                            const data = roomSnap.data();
                            if (data.state === 'active') {
                                const duration = Math.round((Date.now() - (data.createdAtMs || Date.now())) / 1000);
                                if (duration >= 10) {
                                    console.log('Fallback: persisting conversation for room', capturedRoomId);
                                    await createQualifiedConversation(capturedUidA, capturedUidB, capturedRoomId, duration);
                                }
                            }
                        }
                    } catch (e) { console.error('Fallback conversation save failed:', e.message); }
                }, 12000); // 12s to ensure 10s threshold is met
            }
        } catch (err) {
            console.error('Error creating Firestore room:', err);
        }

        // decide roles: a = caller, b = viewer (include partner UID for report system)
        a.emit("matched", { role: "caller", partner: bId, partnerUid: socketUids.get(bId) || null, roomId: socketRooms.get(aId) });
        b.emit("matched", { role: "viewer", partner: aId, partnerUid: socketUids.get(aId) || null, roomId: socketRooms.get(bId) });

        console.log("Matched", aId, "<->", bId);
    }
}

function joinQueue(socketId) {
    if (state.paused.has(socketId)) return;
    if (!state.waiting.includes(socketId)) {
        state.waiting.push(socketId);
        module.exports.tryMatch();
    }
}

function leaveQueue(socketId) {
    const idx = state.waiting.indexOf(socketId);
    if (idx !== -1) state.waiting.splice(idx, 1);
}

module.exports = {
    setIoInstance,
    tryMatch,
    joinQueue,
    leaveQueue,
    invalidateGenderCache
};
