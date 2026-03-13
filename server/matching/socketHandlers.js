/**
 * server/matching/socketHandlers.js
 *
 * Registers Socket.IO event handlers for the matching system.
 * Keeps matching concerns isolated from the rest of the signaling logic.
 *
 * Events handled:
 *   "findMatch"  — user wants to enter the queue and find a partner
 *   "next"       — user wants to skip current partner and re-queue
 *   "disconnect" — cleanup when a socket drops
 */

const queue = require("./queue");
const matchmaker = require("./matchmaker");

/**
 * Initialize matching event handlers on the Socket.IO server.
 * Call this once after the io instance is ready.
 *
 * @param {import("socket.io").Server} io
 */
function initializeMatching(io) {
  io.on("connection", (socket) => {
    // ── findMatch ─────────────────────────────────────────────
    // Client emits this when the user clicks "Start" or finishes
    // a call and wants the next partner.
    socket.on("findMatch", () => {
      console.log(`[Matching] findMatch from ${socket.id}`);

      // Add to queue (addUser already prevents duplicates)
      queue.addUser(socket);

      // Attempt to pair waiting users
      matchmaker.tryMatch(io);
    });

    // ── next ──────────────────────────────────────────────────
    // Client emits this when the user presses "Next" to skip
    // their current partner and search again.
    socket.on("next", () => {
      console.log(`[Matching] next from ${socket.id}`);

      // Remove first to prevent any stale pairing
      queue.removeUser(socket.id);

      // Re-enter the queue
      queue.addUser(socket);

      // Attempt matching with the refreshed queue
      matchmaker.tryMatch(io);
    });

    // ── disconnect ────────────────────────────────────────────
    // Clean up when a socket disconnects for any reason.
    socket.on("disconnect", () => {
      console.log(`[Matching] disconnect ${socket.id}`);
      queue.removeUser(socket.id);
    });
  });

  console.log("[Matching] Module initialized");
}

module.exports = { initializeMatching };
