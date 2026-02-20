// src/firebase.js
const admin = require("firebase-admin");
const config = require("./config");

// Initialize Firebase Admin with project ID (works locally without service account key)
if (!admin.apps.length) {
    admin.initializeApp({
        projectId: config.FIREBASE_PROJECT_ID
    });
}
const fireDb = admin.firestore();

module.exports = { admin, fireDb };
