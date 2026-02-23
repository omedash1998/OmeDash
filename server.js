require('dotenv').config();
const express = require("express");
const app = express();
const http = require("http");
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

const config = require('./src/config');
const socketHandler = require('./src/sockets/socketHandler');

// Serve frontend static files
app.use(express.static("public"));
app.use(express.json());

// -- Premium system (dev-only) --
if (process.env.PREMIUM_DEV === 'true') {
  const premiumModule = require('./src/premium/index');
  app.use('/premium', premiumModule.router);
  console.log('[Premium] DEV mode enabled — routes mounted at /premium');
}

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
