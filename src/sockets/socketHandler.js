// src/sockets/socketHandler.js
const { admin, fireDb } = require('../firebase');
const state = require('../state');
const { endFirestoreRoom } = require('../rooms');
const matchmaking = require('../matchmaking');

// Strike thresholds per report reason
const STRIKE_THRESHOLDS = { minor: 1, sexual: 2, bad_behavior: 3 };
const REPORT_COOLDOWN_MS = 30000;
const MIN_ROOM_DURATION_MS = 5000;
const BAN_DURATION_MS = 12 * 24 * 60 * 60 * 1000;

module.exports = function (io) {
    matchmaking.setIoInstance(io);

    // Initialize background jobs
    const { startStaleRoomCleanup } = require('../rooms');
    // Avoid duplicate interval if module reloaded
    if (!state.cleanupStarted) {
        state.cleanupStarted = true;
        startStaleRoomCleanup();
    }

    io.on("connection", (socket) => {
        console.log("User connected", socket.id);

        // deliver any pending direct messages for this socket
        try {
            const pending = state.pendingMessages.get(socket.id);
            if (pending && Array.isArray(pending) && pending.length) {
                pending.forEach(msg => {
                    try { socket.emit('chat', { from: msg.from, text: msg.text }); } catch (e) { }
                });
                state.pendingMessages.delete(socket.id);
            }
        } catch (e) { console.error('deliver pending failed', e); }

        // ── Register: client sends Firebase UID so server can map socket → user ──
        socket.on('register', async (payload) => {
            try {
                const uid = payload && payload.uid;
                if (!uid) return;
                state.socketUids.set(socket.id, uid);
                socket.uid = uid;
                console.log('Registered socket', socket.id, '→ uid', uid);

                // Check Firestore ban status
                const userRef = fireDb.collection('users').doc(uid);
                const userSnap = await userRef.get();
                if (userSnap.exists) {
                    const data = userSnap.data();
                    if (data.isBanned === true) {
                        if (data.bannedReason === 'minor') {
                            console.log('Permanently banned user connected:', uid);
                            socket.emit('banned', { reason: 'minor', permanent: true });
                            socket.disconnect(true);
                            return;
                        }

                        const expiresAt = data.bannedExpiresAt;
                        const expiresMs = expiresAt ? (expiresAt.toDate ? expiresAt.toDate().getTime() : expiresAt) : null;

                        if (expiresMs && Date.now() >= expiresMs) {
                            console.log('Ban expired for', uid, '— auto-unbanning');
                            await userRef.update({
                                isBanned: false,
                                strikes: 0,
                                bannedReason: admin.firestore.FieldValue.delete(),
                                bannedAt: admin.firestore.FieldValue.delete(),
                                bannedExpiresAt: admin.firestore.FieldValue.delete()
                            });
                        } else {
                            console.log('Temp-banned user connected:', uid, 'expires:', expiresMs);
                            socket.emit('banned', {
                                reason: data.bannedReason || 'bad_behavior',
                                permanent: false,
                                expiresAt: expiresMs
                            });
                            socket.disconnect(true);
                            return;
                        }
                    }
                }

                const ALLOWED_GENDERS = ['male', 'female', 'other'];
                if (userSnap.exists) {
                    const uData = userSnap.data();
                    if (uData.onboardingComplete !== true || !uData.gender || !ALLOWED_GENDERS.includes(uData.gender) || !uData.age || uData.age < 18) {
                        console.log('Onboarding incomplete for', uid);
                        socket.emit('forceOnboarding');
                        socket.disconnect(true);
                        return;
                    }
                } else {
                    console.log('No user doc for', uid, '— forcing onboarding');
                    socket.emit('forceOnboarding');
                    socket.disconnect(true);
                    return;
                }

                socket.emit('registered');
            } catch (e) { console.error('register handler failed', e); }
        });

        socket.on("ready", () => {
            matchmaking.joinQueue(socket.id);
        });

        socket.on("pause", async () => {
            console.log("User paused", socket.id);
            state.paused.add(socket.id);
            matchmaking.leaveQueue(socket.id);
            const partnerId = state.pairs[socket.id];
            if (partnerId) {
                await endFirestoreRoom(socket.id);
                state.socketRooms.delete(partnerId);

                delete state.pairs[partnerId];
                delete state.pairs[socket.id];
                const partnerSocket = io.sockets.sockets.get(partnerId);
                if (partnerSocket) {
                    partnerSocket.emit("partner-left", { reason: "other-paused" });
                    if (!state.paused.has(partnerId) && !state.waiting.includes(partnerId)) state.waiting.push(partnerId);
                }
            }
            matchmaking.tryMatch();
        });

        socket.on("resume", () => {
            console.log("User resumed", socket.id);
            if (state.paused.has(socket.id)) state.paused.delete(socket.id);
            matchmaking.joinQueue(socket.id);
        });

        socket.on("offer", offer => {
            const partnerId = state.pairs[socket.id];
            if (partnerId) io.to(partnerId).emit("offer", offer);
        });

        socket.on("answer", answer => {
            const partnerId = state.pairs[socket.id];
            if (partnerId) io.to(partnerId).emit("answer", answer);
        });

        socket.on("ice-candidate", candidate => {
            const partnerId = state.pairs[socket.id];
            if (partnerId) io.to(partnerId).emit("ice-candidate", candidate);
        });

        socket.on("chat", (payload) => {
            const partnerId = state.pairs[socket.id];
            if (partnerId) {
                io.to(partnerId).emit("chat", { from: socket.id, text: payload.text });
            }
        });

        socket.on('profile', (payload) => {
            const partnerId = state.pairs[socket.id];
            if (partnerId) {
                io.to(partnerId).emit('profile', Object.assign({}, payload, { from: socket.id }));
            }
        });

        socket.on('chat-to', (payload) => {
            try {
                const target = payload && payload.target;
                const text = payload && payload.text;
                if (!target || !text) return;
                const targetSocket = io.sockets.sockets.get(target);
                if (targetSocket) {
                    targetSocket.emit('chat', { from: socket.id, text });
                } else {
                    try {
                        const list = state.pendingMessages.get(target) || [];
                        list.push({ from: socket.id, text, when: Date.now() });
                        if (list.length > 500) list.splice(0, list.length - 500);
                        state.pendingMessages.set(target, list);
                    } catch (e) { console.error('buffer pending failed', e); }
                }
            } catch (e) { console.error('chat-to failed', e); }
        });

        socket.on('report-user', async (payload) => {
            try {
                const reason = payload && payload.reason;
                const partnerUid = payload && payload.partnerUid;
                const reporterUid = socket.uid || state.socketUids.get(socket.id);

                if (!reason || !STRIKE_THRESHOLDS[reason]) {
                    socket.emit('report-error', { message: 'Invalid report reason' });
                    return;
                }
                if (!reporterUid || !partnerUid) {
                    socket.emit('report-error', { message: 'Not registered' });
                    return;
                }
                if (reporterUid === partnerUid) {
                    socket.emit('report-error', { message: 'Cannot report yourself' });
                    return;
                }

                const lastReport = state.reportCooldowns.get(socket.id);
                if (lastReport && (Date.now() - lastReport) < REPORT_COOLDOWN_MS) {
                    const remaining = Math.ceil((REPORT_COOLDOWN_MS - (Date.now() - lastReport)) / 1000);
                    socket.emit('report-error', { message: `Please wait ${remaining}s before reporting again` });
                    return;
                }

                const roomId = state.socketRooms.get(socket.id);
                if (roomId) {
                    try {
                        const roomSnap = await fireDb.collection('rooms').doc(roomId).get();
                        if (roomSnap.exists) {
                            const roomData = roomSnap.data();
                            const elapsed = Date.now() - (roomData.createdAtMs || 0);
                            if (elapsed < MIN_ROOM_DURATION_MS) {
                                socket.emit('report-error', { message: 'Room too new to report' });
                                return;
                            }
                        }
                    } catch (e) { console.error('room duration check failed', e); }
                }

                if (roomId) {
                    const reporters = state.roomReports.get(roomId) || new Set();
                    if (reporters.has(socket.id)) {
                        socket.emit('report-error', { message: 'Already reported in this room' });
                        return;
                    }
                    reporters.add(socket.id);
                    state.roomReports.set(roomId, reporters);
                }

                state.reportCooldowns.set(socket.id, Date.now());

                await fireDb.collection('reports').add({
                    reporterUid: reporterUid,
                    reportedUid: partnerUid,
                    reason: reason,
                    roomId: roomId || null,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
                console.log('Report stored:', reporterUid, '→', partnerUid, 'reason:', reason);

                const threshold = STRIKE_THRESHOLDS[reason];
                const userRef = fireDb.collection('users').doc(partnerUid);
                let shouldBan = false;

                await fireDb.runTransaction(async (txn) => {
                    const snap = await txn.get(userRef);
                    const data = snap.exists ? snap.data() : {};
                    const currentStrikes = (data.strikes || 0) + 1;
                    const updateData = { strikes: currentStrikes };

                    if (currentStrikes >= threshold) {
                        updateData.isBanned = true;
                        updateData.bannedReason = reason;
                        updateData.bannedAt = admin.firestore.FieldValue.serverTimestamp();
                        if (reason === 'minor') {
                            updateData.bannedExpiresAt = null;
                        } else {
                            updateData.bannedExpiresAt = new Date(Date.now() + BAN_DURATION_MS);
                        }
                        shouldBan = true;
                    }

                    if (snap.exists) {
                        txn.update(userRef, updateData);
                    } else {
                        txn.set(userRef, updateData, { merge: true });
                    }
                });

                console.log('Strike applied to', partnerUid, '| shouldBan:', shouldBan);
                socket.emit('report-received', { success: true });

                if (shouldBan) {
                    for (const [sid, uid] of state.socketUids.entries()) {
                        if (uid === partnerUid) {
                            const targetSocket = io.sockets.sockets.get(sid);
                            if (targetSocket) {
                                const theirPartner = state.pairs[sid];
                                if (theirPartner) {
                                    delete state.pairs[theirPartner];
                                    delete state.pairs[sid];
                                    const partnerSock = io.sockets.sockets.get(theirPartner);
                                    if (partnerSock) {
                                        partnerSock.emit('partner-left', { reason: 'other-banned' });
                                        if (!state.paused.has(theirPartner) && !state.waiting.includes(theirPartner)) state.waiting.push(theirPartner);
                                    }
                                }
                                matchmaking.leaveQueue(sid);

                                targetSocket.emit('banned', {
                                    reason: reason,
                                    permanent: reason === 'minor',
                                    expiresAt: reason === 'minor' ? null : (Date.now() + BAN_DURATION_MS)
                                });
                                setTimeout(() => {
                                    try { targetSocket.disconnect(true); } catch (e) { }
                                }, 500);
                            }
                        }
                    }
                    console.log('User', partnerUid, 'BANNED for reason:', reason);
                }

            } catch (e) { console.error('report-user handler failed', e); }
        });

        socket.on('request-unban', async () => {
            try {
                const uid = socket.uid || state.socketUids.get(socket.id);
                if (!uid) { socket.emit('unban-error', { message: 'Not registered' }); return; }

                const userRef = fireDb.collection('users').doc(uid);
                const userSnap = await userRef.get();
                if (!userSnap.exists) { socket.emit('unban-error', { message: 'User not found' }); return; }

                const data = userSnap.data();
                if (!data.isBanned) { socket.emit('unban-error', { message: 'Not banned' }); return; }

                if (data.bannedReason === 'minor') {
                    socket.emit('unban-error', { message: 'This ban cannot be removed' });
                    return;
                }

                await userRef.update({
                    isBanned: false,
                    strikes: 0,
                    bannedReason: admin.firestore.FieldValue.delete(),
                    bannedAt: admin.firestore.FieldValue.delete(),
                    bannedExpiresAt: admin.firestore.FieldValue.delete()
                });

                console.log('User unbanned:', uid);
                socket.emit('unbanned');
            } catch (e) { console.error('request-unban handler failed', e); }
        });

        socket.on('private-message', async (payload) => {
            try {
                const recipientUid = payload && payload.recipientUid;
                const text = payload && payload.text;
                const senderUid = socket.uid || state.socketUids.get(socket.id);

                if (!senderUid || !recipientUid || !text) {
                    socket.emit('message-error', { message: 'Invalid message data' });
                    return;
                }

                if (senderUid === recipientUid) {
                    socket.emit('message-error', { message: 'Cannot message yourself' });
                    return;
                }

                console.log('Private message:', senderUid, '→', recipientUid);

                const conversationsSnap = await fireDb.collection('conversations')
                    .where('participants', 'array-contains', senderUid)
                    .get();

                const matchingConvs = conversationsSnap.docs.filter(doc => {
                    const participants = doc.data().participants || [];
                    return participants.includes(senderUid) && participants.includes(recipientUid);
                });

                if (matchingConvs.length === 0) {
                    socket.emit('message-error', { message: 'No conversation found. Connect first.' });
                    return;
                }

                const conversationDoc = matchingConvs[0];
                const conversationId = conversationDoc.id;

                const senderDoc = await fireDb.collection('users').doc(senderUid).get();
                const senderData = senderDoc.exists ? senderDoc.data() : {};
                const senderIsPremium = senderData.isPremium === true;

                if (!senderIsPremium) {
                    const messagesSnap = await fireDb.collection('messages').doc(conversationId)
                        .collection('chat')
                        .orderBy('createdAt', 'asc')
                        .get();

                    if (messagesSnap.empty) {
                        console.log('Non-premium user tried to initiate conversation:', senderUid);
                        socket.emit('need_payment', { reason: 'initiate_message' });
                        return;
                    }

                    let hasPremiumSender = false;
                    for (const msgDoc of messagesSnap.docs) {
                        const msgData = msgDoc.data();
                        const msgSenderUid = msgData.fromUid;

                        if (msgSenderUid === senderUid) continue;

                        const msgSenderDoc = await fireDb.collection('users').doc(msgSenderUid).get();
                        const msgSenderData = msgSenderDoc.exists ? msgSenderDoc.data() : {};
                        if (msgSenderData.isPremium === true) {
                            hasPremiumSender = true;
                            break;
                        }
                    }

                    if (!hasPremiumSender) {
                        console.log('Non-premium user tried to message in non-premium conversation:', senderUid);
                        socket.emit('need_payment', { reason: 'no_premium_in_conversation' });
                        return;
                    }

                    console.log('Non-premium user replying in conversation with premium user:', senderUid);
                }

                const messageRef = fireDb.collection('messages').doc(conversationId)
                    .collection('chat').doc();

                await messageRef.set({
                    fromUid: senderUid,
                    text: text,
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });

                console.log('✓ Message saved:', conversationId, messageRef.id);

                let delivered = false;
                for (const [sid, uid] of state.socketUids.entries()) {
                    if (uid === recipientUid) {
                        const targetSocket = io.sockets.sockets.get(sid);
                        if (targetSocket) {
                            targetSocket.emit('private-message-received', {
                                conversationId: conversationId,
                                fromUid: senderUid,
                                text: text,
                                messageId: messageRef.id
                            });
                            delivered = true;
                        }
                    }
                }

                if (!delivered) {
                    console.log('Recipient offline, buffering message');
                    for (const [sid, uid] of state.socketUids.entries()) {
                        if (uid === recipientUid) {
                            try {
                                const list = state.pendingMessages.get(sid) || [];
                                list.push({ from: senderUid, text: text, when: Date.now(), conversationId: conversationId });
                                if (list.length > 500) list.splice(0, list.length - 500);
                                state.pendingMessages.set(sid, list);
                            } catch (e) { console.error('buffer pending failed', e); }
                            break;
                        }
                    }
                }

                socket.emit('message-sent', { conversationId: conversationId, messageId: messageRef.id });

            } catch (e) {
                console.error('private-message handler failed', e);
                socket.emit('message-error', { message: 'Failed to send message' });
            }
        });

        // Soft-delete a single conversation for the current user
        socket.on('delete-conversation', async (payload) => {
            try {
                const uid = socket.uid || state.socketUids.get(socket.id);
                if (!uid) { socket.emit('message-error', { message: 'Not authenticated' }); return; }
                const conversationId = payload && payload.conversationId;
                if (!conversationId) { socket.emit('message-error', { message: 'Missing conversationId' }); return; }

                const convRef = fireDb.collection('conversations').doc(conversationId);
                const convSnap = await convRef.get();
                if (!convSnap.exists) { socket.emit('message-error', { message: 'Conversation not found' }); return; }

                const participants = convSnap.data().participants || [];
                if (!participants.includes(uid)) { socket.emit('message-error', { message: 'Not a participant' }); return; }

                await convRef.update({ [`deletedFor.${uid}`]: true });
                console.log('✓ Soft deleted conversation', conversationId, 'for', uid);
                socket.emit('conversation-deleted', { conversationId });
            } catch (e) {
                console.error('delete-conversation handler failed', e);
                socket.emit('message-error', { message: 'Failed to delete conversation' });
            }
        });

        socket.on('clear-history', async () => {
            try {
                const uid = socket.uid || state.socketUids.get(socket.id);
                if (!uid) {
                    socket.emit('history-error', { message: 'Not authenticated' });
                    return;
                }

                console.log('Clear history requested by:', uid);

                const snapshot = await fireDb.collection('conversations')
                    .where('participants', 'array-contains', uid)
                    .get();

                if (snapshot.empty) {
                    console.log('No conversations to clear for:', uid);
                    socket.emit('history-cleared');
                    return;
                }

                const batch = fireDb.batch();
                snapshot.docs.forEach(doc => {
                    batch.update(doc.ref, {
                        [`deletedFor.${uid}`]: true
                    });
                });

                await batch.commit();
                console.log('✓ Soft deleted', snapshot.docs.length, 'conversations for:', uid);

                socket.emit('history-cleared');

            } catch (err) {
                console.error('Clear history failed:', err);
                socket.emit('history-error', { message: 'Failed to clear history' });
            }
        });

        socket.on("next", async () => {
            const partnerId = state.pairs[socket.id];
            if (partnerId) {
                await endFirestoreRoom(socket.id);
                state.socketRooms.delete(partnerId);

                delete state.pairs[partnerId];
                delete state.pairs[socket.id];
                const partnerSocket = io.sockets.sockets.get(partnerId);
                if (partnerSocket) {
                    partnerSocket.emit("partner-left", { reason: "other-next" });
                    if (!state.paused.has(partnerId) && !state.waiting.includes(partnerId)) state.waiting.push(partnerId);
                }
            }
            if (!state.paused.has(socket.id) && !state.waiting.includes(socket.id)) state.waiting.push(socket.id);
            console.log("User", socket.id, "pressed NEXT. Requeueing if not paused...");
            matchmaking.tryMatch();
        });

        socket.on("disconnect", async () => {
            console.log("DISCONNECT TRIGGERED",
                "socketId:", socket.id,
                "roomId:", state.socketRooms.get(socket.id) || 'none'
            );
            console.log("User disconnected", socket.id);
            matchmaking.leaveQueue(socket.id);
            if (state.paused.has(socket.id)) state.paused.delete(socket.id);

            state.socketUids.delete(socket.id);
            state.reportCooldowns.delete(socket.id);

            await endFirestoreRoom(socket.id);

            const partnerId = state.pairs[socket.id];
            if (partnerId) {
                state.socketRooms.delete(partnerId);
                delete state.pairs[partnerId];
                delete state.pairs[socket.id];
                const partnerSocket = io.sockets.sockets.get(partnerId);
                if (partnerSocket) {
                    partnerSocket.emit("partner-left", { reason: "disconnect" });
                    if (!state.paused.has(partnerId) && !state.waiting.includes(partnerId)) state.waiting.push(partnerId);
                }
            }
            matchmaking.tryMatch();
        });
    });
};
