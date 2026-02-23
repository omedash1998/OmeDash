// tests/premium.test.js
// Jest tests for the Premium system.
//
// Run:  npx jest tests/premium.test.js
//       npm test

// ──────────────────────────────────────────────────────────────
// Mock firebase-admin BEFORE any module under test is required
// ──────────────────────────────────────────────────────────────
const mockFirestoreData = {};

const mockDoc = (path) => ({
  get: jest.fn(async () => {
    const data = mockFirestoreData[path];
    return {
      exists: !!data,
      data: () => data || {},
    };
  }),
  set: jest.fn(async (fields, _opts) => {
    mockFirestoreData[path] = { ...(mockFirestoreData[path] || {}), ...fields };
  }),
});

const mockCollection = (name) => ({
  doc: (id) => mockDoc(`${name}/${id}`),
  add: jest.fn(async (data) => {
    const id = 'mock_' + Math.random().toString(36).slice(2, 8);
    mockFirestoreData[`${name}/${id}`] = data;
    return { id };
  }),
});

jest.mock('firebase-admin', () => {
  const fakeAdmin = {
    apps: [{}], // pretend already initialised
    initializeApp: jest.fn(),
    firestore: Object.assign(
      jest.fn(() => ({
        collection: jest.fn((name) => mockCollection(name)),
        doc: jest.fn((path) => mockDoc(path)),
      })),
      {
        FieldValue: {
          serverTimestamp: jest.fn(() => 'SERVER_TS'),
        },
      }
    ),
    auth: jest.fn(() => ({
      verifyIdToken: jest.fn(async () => ({ uid: 'test-uid' })),
    })),
  };
  return fakeAdmin;
});

// ─── Now require modules under test ──────────────────────────
const LRUCache = require('../src/premium/cache');
const expiry = require('../src/premium/expiry');
const matcher = require('../src/premium/matcher');

// ──────────────────────────────────────────────────────────────
//  LRU Cache tests
// ──────────────────────────────────────────────────────────────
describe('LRUCache', () => {
  test('set and get returns value', () => {
    const cache = new LRUCache({ max: 10, ttl: 5000 });
    cache.set('a', 42);
    expect(cache.get('a')).toBe(42);
  });

  test('get returns undefined for missing key', () => {
    const cache = new LRUCache();
    expect(cache.get('nope')).toBeUndefined();
  });

  test('expired entries return undefined', () => {
    const cache = new LRUCache({ ttl: 1 }); // 1 ms TTL
    cache.set('x', 'val');
    // Advance past TTL
    return new Promise((r) => setTimeout(r, 10)).then(() => {
      expect(cache.get('x')).toBeUndefined();
    });
  });

  test('del removes a key', () => {
    const cache = new LRUCache();
    cache.set('k', 1);
    cache.del('k');
    expect(cache.get('k')).toBeUndefined();
  });

  test('evicts oldest when capacity exceeded', () => {
    const cache = new LRUCache({ max: 2, ttl: 60000 });
    cache.set('a', 1);
    cache.set('b', 2);
    cache.set('c', 3); // should evict 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
  });
});

// ──────────────────────────────────────────────────────────────
//  expiry.isActive tests
// ──────────────────────────────────────────────────────────────
describe('expiry.isActive', () => {
  beforeEach(() => {
    expiry.cache.clear();
    // Reset mock data
    Object.keys(mockFirestoreData).forEach((k) => delete mockFirestoreData[k]);
  });

  test('returns false for unknown user', async () => {
    const result = await expiry.isActive('nonexistent');
    expect(result).toBe(false);
  });

  test('returns true for active premium user', async () => {
    mockFirestoreData['users/uid1'] = {
      isPremium: true,
      premiumExpiresAt: { toDate: () => new Date(Date.now() + 100000) },
    };
    const result = await expiry.isActive('uid1');
    expect(result).toBe(true);
  });

  test('returns false for expired premium user', async () => {
    mockFirestoreData['users/uid2'] = {
      isPremium: true,
      premiumExpiresAt: { toDate: () => new Date(Date.now() - 100000) },
    };
    const result = await expiry.isActive('uid2');
    expect(result).toBe(false);
  });

  test('returns false when isPremium is false', async () => {
    mockFirestoreData['users/uid3'] = {
      isPremium: false,
      premiumExpiresAt: { toDate: () => new Date(Date.now() + 100000) },
    };
    const result = await expiry.isActive('uid3');
    expect(result).toBe(false);
  });

  test('caches result and returns from cache on second call', async () => {
    mockFirestoreData['users/uid4'] = {
      isPremium: true,
      premiumExpiresAt: { toDate: () => new Date(Date.now() + 100000) },
    };
    const r1 = await expiry.isActive('uid4');
    expect(r1).toBe(true);

    // Change underlying data — cache should still return true
    mockFirestoreData['users/uid4'].isPremium = false;
    const r2 = await expiry.isActive('uid4');
    expect(r2).toBe(true); // cached
  });

  test('cache.del invalidates and next call re-reads Firestore', async () => {
    mockFirestoreData['users/uid5'] = {
      isPremium: true,
      premiumExpiresAt: { toDate: () => new Date(Date.now() + 100000) },
    };
    await expiry.isActive('uid5');

    // Change data and invalidate
    mockFirestoreData['users/uid5'].isPremium = false;
    expiry.cache.del('premium:uid5');

    const result = await expiry.isActive('uid5');
    expect(result).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────
//  matcher.scoreCandidate tests
// ──────────────────────────────────────────────────────────────
describe('matcher.scoreCandidate', () => {
  beforeEach(() => {
    expiry.cache.clear();
    matcher.userCache.clear();
    Object.keys(mockFirestoreData).forEach((k) => delete mockFirestoreData[k]);
  });

  test('returns 0 when premiumUid is not premium', async () => {
    mockFirestoreData['users/free'] = { isPremium: false };
    mockFirestoreData['users/cand'] = { countryCode: 'US', gender: 'male' };
    const score = await matcher.scoreCandidate('free', 'cand');
    expect(score).toBe(0);
  });

  test('returns 5 for country match', async () => {
    mockFirestoreData['users/prem'] = {
      isPremium: true,
      premiumExpiresAt: { toDate: () => new Date(Date.now() + 100000) },
      countryPref: 'US',
      genderPref: null,
    };
    mockFirestoreData['users/cand'] = { countryCode: 'US', gender: 'male' };

    const score = await matcher.scoreCandidate('prem', 'cand');
    expect(score).toBe(5);
  });

  test('returns 3 for gender match', async () => {
    mockFirestoreData['users/prem'] = {
      isPremium: true,
      premiumExpiresAt: { toDate: () => new Date(Date.now() + 100000) },
      countryPref: null,
      genderPref: 'female',
    };
    mockFirestoreData['users/cand'] = { countryCode: 'BR', gender: 'female' };

    const score = await matcher.scoreCandidate('prem', 'cand');
    expect(score).toBe(3);
  });

  test('returns 8 for country + gender match', async () => {
    mockFirestoreData['users/prem'] = {
      isPremium: true,
      premiumExpiresAt: { toDate: () => new Date(Date.now() + 100000) },
      countryPref: 'MX',
      genderPref: 'male',
    };
    mockFirestoreData['users/cand'] = { countryCode: 'MX', gender: 'male' };

    const score = await matcher.scoreCandidate('prem', 'cand');
    expect(score).toBe(8);
  });

  test('returns 0 when genderPref is "any"', async () => {
    mockFirestoreData['users/prem'] = {
      isPremium: true,
      premiumExpiresAt: { toDate: () => new Date(Date.now() + 100000) },
      countryPref: null,
      genderPref: 'any',
    };
    mockFirestoreData['users/cand'] = { countryCode: 'US', gender: 'female' };

    const score = await matcher.scoreCandidate('prem', 'cand');
    expect(score).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────
//  mockController.toggleDev tests
// ──────────────────────────────────────────────────────────────
describe('mockController.toggleDev', () => {
  // We need to require it after mocks are in place
  const mockController = require('../src/premium/mockController');

  beforeEach(() => {
    expiry.cache.clear();
    Object.keys(mockFirestoreData).forEach((k) => delete mockFirestoreData[k]);
  });

  function makeReqRes(body, uid) {
    return {
      req: { body, uid: uid || 'test-uid' },
      res: {
        _status: 200,
        _body: null,
        status(code) { this._status = code; return this; },
        json(data) { this._body = data; return this; },
      },
    };
  }

  test('toggleDev on=true sets isPremium true and invalidates cache', async () => {
    // Prime cache with false
    expiry.cache.set('premium:test-uid', false);

    const { req, res } = makeReqRes({ on: true });
    await mockController.toggleDev(req, res);

    expect(res._body.ok).toBe(true);
    expect(res._body.isPremium).toBe(true);

    // Cache should be invalidated
    expect(expiry.cache.get('premium:test-uid')).toBeUndefined();
  });

  test('toggleDev on=false sets isPremium false', async () => {
    const { req, res } = makeReqRes({ on: false });
    await mockController.toggleDev(req, res);

    expect(res._body.ok).toBe(true);
    expect(res._body.isPremium).toBe(false);
    expect(expiry.cache.get('premium:test-uid')).toBeUndefined();
  });

  test('toggleDev returns 401 without uid', async () => {
    const { req, res } = makeReqRes({ on: true }, null);
    req.uid = undefined;
    await mockController.toggleDev(req, res);
    expect(res._status).toBe(401);
  });
});
