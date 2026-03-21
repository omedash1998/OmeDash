// src/state.js
const waiting = [];            // sockets waiting to be matched (array of socket ids)
const pairs = {};              // mapping socket.id -> partnerSocketId
const paused = new Set();      // socket ids that are on break (paused)
const socketRooms = new Map(); // server-side map: socketId -> roomId (reliable, not on socket object)
const pendingMessages = new Map(); // targetId -> [{ from, text, when }]
const reportCooldowns = new Map();  // reporterSocketId → last report timestamp(ms)
const roomReports = new Map();      // roomId → Set of reporterSocketIds (dedup per room)
const socketUids = new Map();       // socketId → Firebase UID mapping (set on 'register' event)
const sessionIds = new Map();       // socketId → unique browser sessionId mapping
const endingRooms = new Set();      // In-memory guard for double ending rooms

module.exports = {
    waiting,
    pairs,
    paused,
    socketRooms,
    pendingMessages,
    reportCooldowns,
    roomReports,
    socketUids,
    sessionIds,
    endingRooms
};
