/**
 * server/matching/matchmaker.js
 *
 * Attempts to match waiting users into pairs.
 * Called whenever the queue changes (user added, user skipped, etc.).
 *
 * Scalability note:
 *   This is a single-process loop that drains the local queue.
 *   To scale across multiple server instances, use a Redis-backed
 *   queue with atomic pop + a distributed lock (e.g. Redlock) to
 *   prevent double-matching.
 */

const queue = require("./queue");

/**
 * Try to match as many pairs as possible from the current queue.
 * For each pair found, emits "matchFound" to both sockets with
 * the partner's socket ID.
 *
 * @param {import("socket.io").Server} io  — Socket.IO server instance
 */
function tryMatch(io) {
  let pair = queue.getMatchPair();

  while (pair) {
    const { socketA, socketB } = pair;

    // Double-check both sockets are still connected
    if (!socketA.connected || !socketB.connected) {
      // Put the surviving socket back into the queue
      if (socketA.connected) queue.addUser(socketA);
      if (socketB.connected) queue.addUser(socketB);
      pair = queue.getMatchPair();
      continue;
    }

    // Notify both users of their match
    socketA.emit("matchFound", { partnerId: socketB.id });
    socketB.emit("matchFound", { partnerId: socketA.id });

    console.log(
      `[Matchmaker] Matched ${socketA.id} <-> ${socketB.id}  (queue: ${queue.size()})`
    );

    // Continue draining the queue for more pairs
    pair = queue.getMatchPair();
  }
}

module.exports = { tryMatch };
