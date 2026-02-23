// src/premium/cache.js
// Tiny LRU cache with TTL support used by expiry and matcher.
// For production at scale, swap this for Redis (see README).

class LRUCache {
  /**
   * @param {object} opts
   * @param {number} opts.max   – maximum number of entries (default 500)
   * @param {number} opts.ttl   – time-to-live in milliseconds (default 60 000)
   */
  constructor({ max = 500, ttl = 60000 } = {}) {
    this.max = max;
    this.ttl = ttl;
    /** @type {Map<string, {value: any, expires: number}>} */
    this._map = new Map();
  }

  /** Get a cached value. Returns undefined if missing or expired. */
  get(key) {
    const entry = this._map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this._map.delete(key);
      return undefined;
    }
    // Move to end (most-recently used)
    this._map.delete(key);
    this._map.set(key, entry);
    return entry.value;
  }

  /** Store a value with optional per-key TTL override. */
  set(key, value, ttl) {
    if (this._map.has(key)) this._map.delete(key);
    // Evict oldest if at capacity
    if (this._map.size >= this.max) {
      const oldest = this._map.keys().next().value;
      this._map.delete(oldest);
    }
    this._map.set(key, {
      value,
      expires: Date.now() + (ttl != null ? ttl : this.ttl),
    });
  }

  /** Delete a single key. */
  del(key) {
    this._map.delete(key);
  }

  /** Clear all entries. */
  clear() {
    this._map.clear();
  }

  /** Number of entries currently stored. */
  get size() {
    return this._map.size;
  }
}

module.exports = LRUCache;
