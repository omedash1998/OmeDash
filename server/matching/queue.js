/**
 * server/matching/queue.js
 *
 * In-memory waiting queue for the matching system.
 * Stores socket references so the matchmaker can emit events directly.
 *
 * Scalability note:
 *   This module uses a simple array + Map. To scale horizontally,
 *   replace the storage with a Redis List and Hash. The public API
 *   (addUser / removeUser / getMatchPair) stays the same.
 */

// Ordered list of socket IDs waiting for a match
const waitingQueue = [];

// Fast lookup: socketId → socket reference (prevents linear scans)
const socketMap = new Map();

/**
 * Add a user to the waiting queue.
 * Silently skips if the user is already queued (prevents duplicates).
 *
 * @param {import("socket.io").Socket} socket
 */
function addUser(socket) {
  if (!socket || !socket.id) return;

  // Prevent duplicate entries
  if (socketMap.has(socket.id)) return;

  waitingQueue.push(socket.id);
  socketMap.set(socket.id, socket);
}

/**
 * Remove a user from the waiting queue.
 * Safe to call even if the user is not in the queue.
 *
 * @param {string} socketId
 */
function removeUser(socketId) {
  if (!socketId) return;

  const idx = waitingQueue.indexOf(socketId);
  if (idx !== -1) {
    waitingQueue.splice(idx, 1);
  }
  socketMap.delete(socketId);
}

/**
 * Get the next pair of users ready to be matched.
 * Returns null if fewer than 2 users are waiting.
 *
 * Both users are removed from the queue atomically
 * (no window where another call could grab the same user).
 *
 * @returns {{ socketA: import("socket.io").Socket, socketB: import("socket.io").Socket } | null}
 */
function getMatchPair() {
  // Need at least 2 users to form a pair
  while (waitingQueue.length >= 2) {
    const idA = waitingQueue.shift();
    const socketA = socketMap.get(idA);
    socketMap.delete(idA);

    // Guard: socket may have disconnected while waiting
    if (!socketA || !socketA.connected) {
      continue; // skip stale entry, try next
    }

    // Find a valid second user
    while (waitingQueue.length > 0) {
      const idB = waitingQueue.shift();
      const socketB = socketMap.get(idB);
      socketMap.delete(idB);

      if (socketB && socketB.connected) {
        return { socketA, socketB };
      }
      // else: stale entry, continue inner loop
    }

    // No valid second user found — put A back at front
    waitingQueue.unshift(idA);
    socketMap.set(idA, socketA);
    return null;
  }

  return null;
}

/**
 * Current number of users in the queue (useful for logging/monitoring).
 * @returns {number}
 */
function size() {
  return waitingQueue.length;
}

module.exports = {
  addUser,
  removeUser,
  getMatchPair,
  size,
};
