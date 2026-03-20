require('dotenv').config();
const express = require("express");
const cors = require("cors");
const app = express();
const corsOptions = {
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true
};
app.use(cors(corsOptions));
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server, {
  cors: {
    origin: ["https://omedash.com", "https://www.omedash.com"],
    methods: ["GET", "POST"],
    credentials: true
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000 // 2 minutes
  }
});

const config = require('./src/config');
const socketHandler = require('./src/sockets/socketHandler');

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Serve frontend static files
app.use(express.static("public"));

// ── Stripe Webhook (must be before express.json()) ──
app.post('/stripe-webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('[Stripe Webhook] Signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const uid = session.metadata && session.metadata.uid;
    const type = session.metadata && session.metadata.type;

    if (!uid) {
      console.warn('[Stripe Webhook] No uid in session metadata');
    } else if (type === 'unban') {
      // ── Unban payment ──
      try {
        const { admin: fbAdminW, fireDb: fbDbW } = require('./src/firebase');
        const deleteField = fbAdminW.firestore.FieldValue.delete();

        await fbDbW.collection('users').doc(uid).set({
          isBanned: false,
          strikes: 0,
          bannedReason: deleteField,
          bannedAt: deleteField,
          bannedExpiresAt: deleteField,
          unbannedAt: fbAdminW.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        // Notify any connected socket so client hides the ban overlay
        const wsState = require('./src/state');
        for (const [sid, sUid] of wsState.socketUids.entries()) {
          if (sUid === uid) {
            const targetSocket = io.sockets.sockets.get(sid);
            if (targetSocket) targetSocket.emit('unbanned');
          }
        }

        console.log(`[Stripe Webhook] Unban completed for user: ${uid}`);
      } catch (err) {
        console.error('[Stripe Webhook] Unban Firestore update failed:', err.message);
      }
    } else {
      // ── Premium activation (type === 'premium' or legacy) ──
      try {
        const updateData = {
          premium: true,
          premiumSince: new Date(),
          isPremium: true,
          premiumExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        };
        // Save Stripe customer ID for portal access
        if (session.customer) {
          updateData.stripeCustomerId = session.customer;
        }
        await require('./src/firebase').fireDb.collection('users').doc(uid).set(updateData, { merge: true });
        console.log(`[Stripe Webhook] Premium activated for uid: ${uid}`);
      } catch (err) {
        console.error('[Stripe Webhook] Firestore update failed:', err.message);
      }
    }
  }

  res.json({ received: true });
});

app.use(express.json());

// -- Premium system (dev-only) --
if (process.env.PREMIUM_DEV === 'true') {
  const premiumModule = require('./src/premium/index');
  app.use('/premium', premiumModule.router);
  console.log('[Premium] DEV mode enabled — routes mounted at /premium');
}

// ── Migrate old user docs: add 'uid' field required by new security rules ──
const { admin: fbAdmin, fireDb: fbDb } = require('./src/firebase');

app.post('/api/migrate-user', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await fbAdmin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const userRef = fbDb.collection('users').doc(uid);
    const snap = await userRef.get();

    if (snap.exists && !snap.data().uid) {
      await userRef.update({ uid: uid });
      console.log('[Migration] Added uid field:', uid);
    }

    res.json({ ok: true });

  } catch (error) {
    console.error('[Migration] Error:', error);
    res.status(500).json({ error: error.message });
  }
});
app.post('/create-checkout-session', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await fbAdmin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: 'price_1T6FOiGy0ngDBwXQwiHWPiOc',
          quantity: 1,
        },
      ],
      metadata: { uid, type: 'premium' },
      success_url: 'https://omedash.com/?checkout_success={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://omedash.com',
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('Stripe error:', error);
    res.status(500).json({ error: 'Stripe session failed' });
  }
});

// ── Verify Checkout (client-side fallback when webhooks can't reach localhost) ──
app.post('/verify-checkout', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await fbAdmin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }

    // Retrieve the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Verify payment was successful and belongs to this user
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }
    if (session.metadata && session.metadata.uid !== uid) {
      return res.status(403).json({ error: 'Session does not belong to this user' });
    }

    // Activate premium
    const premiumUpdate = {
      premium: true,
      premiumSince: new Date(),
      isPremium: true,
      premiumExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    };
    // Save Stripe customer ID for portal access
    if (session.customer) {
      premiumUpdate.stripeCustomerId = session.customer;
    }
    await fbDb.collection('users').doc(uid).set(premiumUpdate, { merge: true });

    console.log(`[Verify Checkout] Premium activated for uid: ${uid}`);
    res.json({ premium: true });
  } catch (error) {
    console.error('[Verify Checkout] Error:', error.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── Unban Checkout Session ──
app.post('/create-unban-session', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await fbAdmin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: 'Account Unban — OmeDash' },
            unit_amount: 799, // $7.99
          },
          quantity: 1,
        },
      ],
      metadata: { uid, type: 'unban' },
      success_url: 'https://omedash.com/?unban_success={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://omedash.com',
    });

    res.json({ url: session.url });
  } catch (error) {
    console.error('[Unban] Stripe error:', error);
    res.status(500).json({ error: 'Unban session failed' });
  }
});

// ── Verify Unban Checkout (client-side fallback when webhooks can't reach localhost) ──
app.post('/verify-unban', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await fbAdmin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'Missing sessionId' });
    }

    // Retrieve the checkout session from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    // Verify payment was successful and belongs to this user
    if (session.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Payment not completed' });
    }
    if (session.metadata && session.metadata.uid !== uid) {
      return res.status(403).json({ error: 'Session does not belong to this user' });
    }
    if (!session.metadata || session.metadata.type !== 'unban') {
      return res.status(400).json({ error: 'Not an unban session' });
    }

    // Clear ban
    const deleteField = fbAdmin.firestore.FieldValue.delete();
    await fbDb.collection('users').doc(uid).set({
      isBanned: false,
      strikes: 0,
      bannedReason: deleteField,
      bannedAt: deleteField,
      bannedExpiresAt: deleteField,
      unbannedAt: fbAdmin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`[Verify Unban] Ban cleared for uid: ${uid}`);
    res.json({ unbanned: true });
  } catch (error) {
    console.error('[Verify Unban] Error:', error.message);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ── Premium status check ──
app.get('/premium/status', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await fbAdmin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    const userSnap = await fbDb.collection('users').doc(uid).get();
    const premium = userSnap.exists && (userSnap.data().premium === true || userSnap.data().isPremium === true);

    res.json({ premium });
  } catch (error) {
    console.error('[Premium Status] Error:', error.message);
    res.status(500).json({ error: 'Failed to check premium status' });
  }
});

// ── Stripe Customer Portal ──
app.post('/create-portal-session', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const idToken = authHeader.split('Bearer ')[1];
    const decoded = await fbAdmin.auth().verifyIdToken(idToken);
    const uid = decoded.uid;

    // Look up stripeCustomerId from Firestore
    const userSnap = await fbDb.collection('users').doc(uid).get();
    if (!userSnap.exists || !userSnap.data().stripeCustomerId) {
      return res.status(400).json({ error: 'No Stripe customer found. Please subscribe first.' });
    }

    const stripeCustomerId = userSnap.data().stripeCustomerId;

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: stripeCustomerId,
      return_url: 'https://omedash.com',
    });

    res.json({ url: portalSession.url });
  } catch (error) {
    console.error('[Portal] Error:', error.message);
    res.status(500).json({ error: 'Failed to create portal session' });
  }
});

// ── User profile lookup (for message list avatars) ──
app.get('/api/user-profile/:uid', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const idToken = authHeader.split('Bearer ')[1];
    await fbAdmin.auth().verifyIdToken(idToken); // verify caller is authenticated

    const targetUid = req.params.uid;
    let displayName = 'User';
    let photoURL = null;

    // Try Firestore first
    const snap = await fbDb.collection('users').doc(targetUid).get();
    if (snap.exists) {
      const d = snap.data();
      displayName = d.displayName || displayName;
      photoURL = d.photoURL || null;
    }

    // Fall back to Firebase Auth if no photo in Firestore
    if (!photoURL) {
      try {
        const authUser = await fbAdmin.auth().getUser(targetUid);
        photoURL = authUser.photoURL || null;
        if (!displayName || displayName === 'User') {
          displayName = authUser.displayName || displayName;
        }
      } catch (_) { /* user may not exist in Auth */ }
    }

    res.json({ displayName, photoURL });
  } catch (error) {
    console.error('[User Profile] Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch profile' });
  }
});

// Initialize socket event handlers
socketHandler(io);

// -- Premium socket augmentation (dev-only) --
if (process.env.PREMIUM_DEV === 'true') {
  const expiry = require('./src/premium/expiry');
  const { fireDb } = require('./src/firebase');
  io.on('connection', (socket) => {
    // After the main register handler sets socket.uid, augment with premium prefs
    socket.on('registered', async () => {
      try {
        const uid = socket.uid;
        if (!uid) { socket.prefs = { country: null, gender: null }; return; }
        const active = await expiry.isActive(uid);
        if (active) {
          const snap = await fireDb.collection('users').doc(uid).get();
          const d = snap.exists ? snap.data() : {};
          socket.prefs = { country: d.countryPref || null, gender: d.genderPref || null };
        } else {
          socket.prefs = { country: null, gender: null };
        }
      } catch (e) {
        socket.prefs = { country: null, gender: null };
      }
    });
  });
}

server.listen(config.PORT, () => {
  console.log(`Server running at http://localhost:${config.PORT}`);
});
