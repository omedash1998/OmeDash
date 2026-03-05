// src/rooms.js
const { admin, fireDb } = require('./firebase');
const state = require('./state');

// Helper: end a Firestore room using a transaction (atomic, prevents double-ending)
async function endFirestoreRoom(socketId) {
    const roomId = state.socketRooms.get(socketId);
    if (!roomId) {
        console.log('endFirestoreRoom: no roomId for', socketId);
        return null;
    }
    // Remove from map immediately so partner's disconnect won't try again
    state.socketRooms.delete(socketId);

    // In-memory guard: if another handler is already ending this room, skip
    if (state.endingRooms.has(roomId)) {
        console.log('endFirestoreRoom: already ending', roomId, '(skipping for', socketId + ')');
        return roomId;
    }
    state.endingRooms.add(roomId);

    let durationSeconds = 0;
    let participantUids = [];

    try {
        const roomRef = fireDb.collection('rooms').doc(roomId);
        await fireDb.runTransaction(async (txn) => {
            const snap = await txn.get(roomRef);
            if (!snap.exists) {
                console.log('endFirestoreRoom: room does not exist', roomId);
                return;
            }
            const data = snap.data();
            // Only end if currently active (prevents double-ending from Firestore side)
            if (data.state !== 'active') {
                console.log('endFirestoreRoom: room already', data.state, roomId);
                return;
            }
            // Calculate duration in seconds
            const now = Date.now();
            const createdMs = data.createdAtMs || now;
            durationSeconds = Math.round((now - createdMs) / 1000);

            // Extract participant UIDs from room data (stored as socket IDs in participants array)
            const participantSocketIds = data.participants || [];
            participantUids = participantSocketIds.map(sid => state.socketUids.get(sid)).filter(uid => uid);

            txn.update(roomRef, {
                state: 'ended',
                endedAt: admin.firestore.FieldValue.serverTimestamp(),
                durationSeconds: durationSeconds
            });
            console.log('Firestore room ended:', roomId, 'by', socketId,
                '| duration:', durationSeconds + 's');
        });

        // After room transaction: Create qualified conversation if duration >= 10 seconds
        if (durationSeconds >= 10 && participantUids.length === 2) {
            await createQualifiedConversation(participantUids[0], participantUids[1], roomId, durationSeconds);
        }
    } catch (err) {
        console.error('Error ending Firestore room:', roomId, err.message);
    } finally {
        state.endingRooms.delete(roomId);
    }
    return roomId;
}

// Helper: Create qualified conversation document in Firestore
async function createQualifiedConversation(uidA, uidB, roomId, durationSeconds) {
    try {
        // Sort UIDs for deterministic document ID
        const [uid1, uid2] = [uidA, uidB].sort();
        const conversationId = `${uid1}_${uid2}_${roomId}`;

        console.log('Creating qualified conversation:', conversationId, 'duration:', durationSeconds + 's');

        // Fetch user profiles
        const [userA, userB] = await Promise.all([
            fireDb.collection('users').doc(uidA).get(),
            fireDb.collection('users').doc(uidB).get()
        ]);

        // Helper: get photoURL from Firestore doc, fall back to Firebase Auth record
        async function resolvePhoto(userSnap, uid) {
            if (userSnap.exists && userSnap.data().photoURL) return userSnap.data().photoURL;
            try {
                const authUser = await admin.auth().getUser(uid);
                return authUser.photoURL || null;
            } catch (_) { return null; }
        }

        const [photoA, photoB] = await Promise.all([
            resolvePhoto(userA, uidA),
            resolvePhoto(userB, uidB)
        ]);

        const profileA = {
            displayName: userA.exists ? (userA.data().displayName || 'User ' + uidA.slice(0, 6)) : 'User ' + uidA.slice(0, 6),
            photoURL: photoA
        };

        const profileB = {
            displayName: userB.exists ? (userB.data().displayName || 'User ' + uidB.slice(0, 6)) : 'User ' + uidB.slice(0, 6),
            photoURL: photoB
        };

        const participantProfiles = {};
        participantProfiles[uidA] = profileA;
        participantProfiles[uidB] = profileB;

        // Create or update conversation document
        const conversationRef = fireDb.collection('conversations').doc(conversationId);
        let created = false;
        const existingSnap = await conversationRef.get();
        if (existingSnap.exists) {
            // Conversation already created by the chat handler – merge profiles & metadata
            console.log('Conversation already exists, merging profiles:', conversationId);
            await conversationRef.set({
                participantProfiles: participantProfiles,
                startedAt: existingSnap.data().startedAt || admin.firestore.FieldValue.serverTimestamp(),
                savedAt: admin.firestore.FieldValue.serverTimestamp(),
                durationSeconds: durationSeconds,
                qualified: true
            }, { merge: true });
        } else {
            await conversationRef.set({
                participants: [uidA, uidB],
                participantProfiles: participantProfiles,
                roomId: roomId,
                startedAt: admin.firestore.FieldValue.serverTimestamp(),
                savedAt: admin.firestore.FieldValue.serverTimestamp(),
                durationSeconds: durationSeconds,
                qualified: true
            });
            created = true;
        }

        // Add lightweight refs to each user's conversations subcollection
        if (created) {
            for (const uid of [uidA, uidB]) {
                try {
                    await fireDb.collection('users').doc(uid)
                        .collection('conversations').doc(conversationId)
                        .set({
                            convId: conversationId,
                            lastUpdated: admin.firestore.FieldValue.serverTimestamp()
                        }, { merge: true });
                } catch (e) {
                    console.error('Error writing user conversation ref for', uid, ':', e.message);
                }
            }
        }

        console.log('✓ Qualified conversation created:', conversationId);
    } catch (err) {
        console.error('Error creating qualified conversation:', err.message);
    }
}

// Stale room cleanup background job
function startStaleRoomCleanup() {
    const STALE_INTERVAL_MS = 60 * 60 * 1000;  // 1 hour
    const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;  // 24 hours
    setInterval(async () => {
        try {
            const cutoff = Date.now() - STALE_THRESHOLD_MS;
            const staleSnap = await fireDb.collection('rooms')
                .where('state', '==', 'active')
                .where('createdAtMs', '<', cutoff)
                .limit(100)
                .get();
            if (staleSnap.empty) return;
            console.log('Stale room cleanup: found', staleSnap.size, 'rooms');
            const batch = fireDb.batch();
            staleSnap.docs.forEach(doc => {
                const data = doc.data();
                const durationSeconds = Math.round((Date.now() - (data.createdAtMs || 0)) / 1000);
                batch.update(doc.ref, {
                    state: 'ended',
                    endedAt: admin.firestore.FieldValue.serverTimestamp(),
                    endedReason: 'stale-cleanup',
                    durationSeconds: durationSeconds
                });
            });
            await batch.commit();
            console.log('Stale room cleanup: ended', staleSnap.size, 'rooms');
        } catch (err) {
            console.error('Stale room cleanup error:', err.message);
        }
    }, STALE_INTERVAL_MS);
}

module.exports = {
    endFirestoreRoom,
    createQualifiedConversation,
    startStaleRoomCleanup
};
