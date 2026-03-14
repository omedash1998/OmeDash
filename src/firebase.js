// src/firebase.js
const admin = require("firebase-admin");

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

const fireDb = admin.firestore();

module.exports = { admin, fireDb };
