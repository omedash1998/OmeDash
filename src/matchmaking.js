// src/matchmaking.js
const { admin, fireDb } = require('./firebase');
const state = require('./state');

// We need an io reference to emit matched events.
let io;
function setIoInstance(ioInstance) {
    io = ioInstance;
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

        const bId = waiting.shift();
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
    leaveQueue
};
