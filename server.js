const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const admin = require("firebase-admin");

app.use(express.static("public"));

// Initialize Firebase Admin with project ID (works locally without service account key)
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'omedash-a435a'
  });
}
const fireDb = admin.firestore();

// In-memory guard: prevents concurrent endFirestoreRoom calls for the same roomId
const endingRooms = new Set();

// Helper: end a Firestore room using a transaction (atomic, prevents double-ending)
async function endFirestoreRoom(socketId) {
  const roomId = socketRooms.get(socketId);
  if (!roomId) {
    console.log('endFirestoreRoom: no roomId for', socketId);
    return null;
  }
  // Remove from map immediately so partner's disconnect won't try again
  socketRooms.delete(socketId);

  // In-memory guard: if another handler is already ending this room, skip
  if (endingRooms.has(roomId)) {
    console.log('endFirestoreRoom: already ending', roomId, '(skipping for', socketId + ')');
    return roomId;
  }
  endingRooms.add(roomId);

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
      const durationSeconds = Math.round((now - createdMs) / 1000);

      txn.update(roomRef, {
        state: 'ended',
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        durationSeconds: durationSeconds
      });
      console.log('Firestore room ended:', roomId, 'by', socketId,
        '| duration:', durationSeconds + 's');
    });
  } catch (err) {
    console.error('Error ending Firestore room:', roomId, err.message);
  } finally {
    endingRooms.delete(roomId);
  }
  return roomId;
}

const waiting = [];            // sockets waiting to be matched (array of socket ids)
const pairs = {};              // mapping socket.id -> partnerSocketId
const paused = new Set();      // socket ids that are on break (paused)
// server-side map: socketId -> roomId (reliable, not on socket object)
const socketRooms = new Map();
// in-memory buffer for direct messages to offline users: targetId -> [{ from, text, when }]
const pendingMessages = new Map();
// report counts (socketId -> number)
const reports = new Map();
// bannedExpiry: socketId -> timestamp(ms) when ban expires
const bannedExpiry = new Map();
// timers for automatic unban: socketId -> Timeout
const banTimers = new Map();
// how many reports needed to ban
const REPORT_THRESHOLD = 1;

async function attemptMatch() {
  while (waiting.length >= 2) {
    const aId = waiting.shift();
    // skip if paused, banned, or disconnected
    try {
      if (paused.has(aId)) continue;
      const be = bannedExpiry.get(aId);
      if (be && be > Date.now()) continue;
      if (be && be <= Date.now()) {
        bannedExpiry.delete(aId);
        const t = banTimers.get(aId);
        if (t) { clearTimeout(t); banTimers.delete(aId); }
      }
    } catch (e) { /* ignore */ }

    const bId = waiting.shift();
    if (!bId) {
      waiting.unshift(aId);
      break;
    }

    try {
      if (paused.has(bId)) { waiting.unshift(aId); continue; }
      const beb = bannedExpiry.get(bId);
      if (beb && beb > Date.now()) { waiting.unshift(aId); continue; }
      if (beb && beb <= Date.now()) { bannedExpiry.delete(bId); const t2 = banTimers.get(bId); if (t2) { clearTimeout(t2); banTimers.delete(bId); } }
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
      await roomRef.set({
        participants: [aId, bId],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAtMs: Date.now(),  // JS timestamp for duration calculation
        state: 'active'
      });
      console.log('Firestore room created:', roomRef.id);
    } catch (err) {
      console.error('Error creating Firestore room:', err);
    }

    // decide roles: a = caller, b = viewer
    a.emit("matched", { role: "caller", partner: bId });
    b.emit("matched", { role: "viewer", partner: aId });

    console.log("Matched", aId, "<->", bId);
  }
}

io.on("connection", (socket) => {
  console.log("User connected", socket.id);

  // if this socket id is banned, notify client with remaining time
  try {
    const be = bannedExpiry.get(socket.id);
    if (be && be > Date.now()) {
      try { socket.emit('banned', { until: be }); } catch (e) { }
      // keep the connection open so client can show ban modal and request unban
    } else if (be && be <= Date.now()) {
      bannedExpiry.delete(socket.id);
      const t = banTimers.get(socket.id);
      if (t) { clearTimeout(t); banTimers.delete(socket.id); }
    }
  } catch (e) { /* ignore */ }

  // deliver any pending direct messages for this socket
  try {
    const pending = pendingMessages.get(socket.id);
    if (pending && Array.isArray(pending) && pending.length) {
      pending.forEach(msg => {
        try { socket.emit('chat', { from: msg.from, text: msg.text }); } catch (e) { }
      });
      pendingMessages.delete(socket.id);
    }
  } catch (e) { console.error('deliver pending failed', e); }

  socket.on("ready", () => {
    if (paused.has(socket.id)) return;
    const beR = bannedExpiry.get(socket.id);
    if (beR && beR > Date.now()) return;
    if (!waiting.includes(socket.id)) {
      waiting.push(socket.id);
      attemptMatch();
    }
  });

  socket.on("pause", async () => {
    console.log("User paused", socket.id);
    paused.add(socket.id);
    const idx = waiting.indexOf(socket.id);
    if (idx !== -1) waiting.splice(idx, 1);
    const partnerId = pairs[socket.id];
    if (partnerId) {
      // End Firestore room before clearing pair
      await endFirestoreRoom(socket.id);
      // Also remove partner from socketRooms (room already ended)
      socketRooms.delete(partnerId);

      delete pairs[partnerId];
      delete pairs[socket.id];
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit("partner-left", { reason: "other-paused" });
        if (!paused.has(partnerId) && !waiting.includes(partnerId)) waiting.push(partnerId);
      }
    }
    attemptMatch();
  });

  socket.on("resume", () => {
    console.log("User resumed", socket.id);
    if (paused.has(socket.id)) paused.delete(socket.id);
    const ber = bannedExpiry.get(socket.id);
    if (ber && ber > Date.now()) return;
    if (!waiting.includes(socket.id)) waiting.push(socket.id);
    attemptMatch();
  });

  socket.on("offer", offer => {
    const partnerId = pairs[socket.id];
    if (partnerId) io.to(partnerId).emit("offer", offer);
  });

  socket.on("answer", answer => {
    const partnerId = pairs[socket.id];
    if (partnerId) io.to(partnerId).emit("answer", answer);
  });

  socket.on("ice-candidate", candidate => {
    const partnerId = pairs[socket.id];
    if (partnerId) io.to(partnerId).emit("ice-candidate", candidate);
  });
  socket.on("chat", (payload) => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      io.to(partnerId).emit("chat", { from: socket.id, text: payload.text });
    }
  });

  socket.on('profile', (payload) => {
    const partnerId = pairs[socket.id];
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
          const list = pendingMessages.get(target) || [];
          list.push({ from: socket.id, text, when: Date.now() });
          if (list.length > 500) list.splice(0, list.length - 500);
          pendingMessages.set(target, list);
        } catch (e) { console.error('buffer pending failed', e); }
      }
    } catch (e) { console.error('chat-to failed', e); }
  });

  socket.on('report-user', (payload) => {
    try {
      const target = payload && payload.partner;
      if (!target) return;
      if (target === socket.id) return; // ignore self-report
      const prev = reports.get(target) || 0;
      const now = prev + 1;
      reports.set(target, now);
      console.log('Report received for', target, 'count', now);

      // Immediately unpair the reported user so the reporter jumps away.
      try {
        const widxImmediate = waiting.indexOf(target);
        if (widxImmediate !== -1) waiting.splice(widxImmediate, 1);
        if (paused.has(target)) paused.delete(target);

        const theirPartnerImmediate = pairs[target];
        if (theirPartnerImmediate) {
          delete pairs[theirPartnerImmediate];
          delete pairs[target];
          const partnerSocketImmediate = io.sockets.sockets.get(theirPartnerImmediate);
          if (partnerSocketImmediate) {
            partnerSocketImmediate.emit('partner-left', { reason: 'other-reported' });
            if (!paused.has(theirPartnerImmediate) && !waiting.includes(theirPartnerImmediate)) waiting.push(theirPartnerImmediate);
          }
        }
        // do not disconnect the reported socket here; allow server to emit `banned` so client shows modal
      } catch (e) { console.error('immediate-unpair failed', e); }

      if (now >= REPORT_THRESHOLD && !bannedExpiry.has(target)) {
        const hours = 300;
        const until = Date.now() + hours * 3600 * 1000; // 300 hours
        bannedExpiry.set(target, until);
        const timer = setTimeout(() => {
          try {
            bannedExpiry.delete(target);
            reports.delete(target);
            banTimers.delete(target);
            console.log('Auto-unbanned', target);
          } catch (e) { console.error('auto-unban failed', e); }
        }, until - Date.now());
        banTimers.set(target, timer);

        const widx = waiting.indexOf(target);
        if (widx !== -1) waiting.splice(widx, 1);
        if (paused.has(target)) paused.delete(target);

        const theirPartner = pairs[target];
        if (theirPartner) {
          delete pairs[theirPartner];
          delete pairs[target];
          const partnerSocket = io.sockets.sockets.get(theirPartner);
          if (partnerSocket) {
            partnerSocket.emit('partner-left', { reason: 'other-banned' });
            if (!paused.has(theirPartner) && !waiting.includes(theirPartner)) waiting.push(theirPartner);
          }
        }

        const targetSocket = io.sockets.sockets.get(target);
        if (targetSocket) {
          try { targetSocket.emit('banned', { until }); } catch (e) { }
          // keep connection open so client receives `banned` and can show unban modal
        }

        console.log('User', target, 'banned until', new Date(until).toISOString());
      }
    } catch (e) { console.error('report-user handler failed', e); }
  });

  socket.on('request-unban', () => {
    try {
      const be = bannedExpiry.get(socket.id);
      if (!be) return;
      bannedExpiry.delete(socket.id);
      const t = banTimers.get(socket.id);
      if (t) { clearTimeout(t); banTimers.delete(socket.id); }
      reports.delete(socket.id);
      try { socket.emit('unbanned'); } catch (e) { }
      if (!waiting.includes(socket.id)) waiting.push(socket.id);
      attemptMatch();
      console.log('User', socket.id, 'unbanned via request-unban');
    } catch (e) { console.error('request-unban failed', e); }
  });

  socket.on("next", async () => {
    const partnerId = pairs[socket.id];
    if (partnerId) {
      // End Firestore room before clearing pair
      await endFirestoreRoom(socket.id);
      // Also remove partner from socketRooms (room already ended)
      socketRooms.delete(partnerId);

      delete pairs[partnerId];
      delete pairs[socket.id];
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit("partner-left", { reason: "other-next" });
        if (!paused.has(partnerId) && !waiting.includes(partnerId)) waiting.push(partnerId);
      }
    }
    if (!paused.has(socket.id) && !waiting.includes(socket.id)) waiting.push(socket.id);
    console.log("User", socket.id, "pressed NEXT. Requeueing if not paused...");
    attemptMatch();
  });

  socket.on("disconnect", async () => {
    console.log("DISCONNECT TRIGGERED",
      "socketId:", socket.id,
      "roomId:", socketRooms.get(socket.id) || 'none'
    );
    console.log("User disconnected", socket.id);
    const idx = waiting.indexOf(socket.id);
    if (idx !== -1) waiting.splice(idx, 1);
    if (paused.has(socket.id)) paused.delete(socket.id);

    // End Firestore room (reads from socketRooms Map)
    await endFirestoreRoom(socket.id);

    const partnerId = pairs[socket.id];
    if (partnerId) {
      // Also remove partner from socketRooms (room already ended)
      socketRooms.delete(partnerId);
      delete pairs[partnerId];
      delete pairs[socket.id];
      const partnerSocket = io.sockets.sockets.get(partnerId);
      if (partnerSocket) {
        partnerSocket.emit("partner-left", { reason: "disconnect" });
        if (!paused.has(partnerId) && !waiting.includes(partnerId)) waiting.push(partnerId);
      }
    }
    attemptMatch();
  });
});

server.listen(3000, () => {
  console.log("Server running at http://localhost:3000");

  // Stale room cleanup: every hour, end rooms older than 24h still marked 'active'
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
});