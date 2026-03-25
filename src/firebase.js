// src/firebase.js
const admin = require("firebase-admin");
const config = require("./config");
const path = require("path");
const fs = require("fs");

// Initialize Firebase Admin with service account credentials
if (!admin.apps.length) {
    const keyPath = path.join(__dirname, '..', 'serviceAccountKey.json');

    if (fs.existsSync(keyPath)) {
        const serviceAccount = require(keyPath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: config.FIREBASE_PROJECT_ID
        });
        console.log('[Firebase] Initialized with service account key');
    } else {
        // Fallback for local dev (requires gcloud auth application-default login)
        admin.initializeApp({
            projectId: config.FIREBASE_PROJECT_ID
        });
        console.log('[Firebase] Initialized without service account key (local dev mode)');
    }
}
const fireDb = admin.firestore();

module.exports = { admin, fireDb };
