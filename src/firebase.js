// src/firebase.js
const admin = require("firebase-admin");
const config = require("./config");
const path = require("path");
const fs = require("fs");

if (!admin.apps.length) {
    let initialized = false;

    // Try to find serviceAccountKey.json
    const candidates = [
        path.join(process.cwd(), 'serviceAccountKey.json'),
        path.join(__dirname, '..', 'serviceAccountKey.json'),
    ];

    for (const keyPath of candidates) {
        if (fs.existsSync(keyPath)) {
            try {
                const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                    projectId: config.FIREBASE_PROJECT_ID
                });
                console.log('[Firebase] Initialized with service account key from:', keyPath);
                initialized = true;
                break;
            } catch (err) {
                console.error('[Firebase] Failed to load key from:', keyPath, err.message);
            }
        }
    }

    if (!initialized) {
        // Fallback: relies on GOOGLE_APPLICATION_CREDENTIALS env var or local gcloud auth
        admin.initializeApp({ projectId: config.FIREBASE_PROJECT_ID });
        console.log('[Firebase] Initialized without explicit credentials (using defaults)');
    }
}

const fireDb = admin.firestore();
module.exports = { admin, fireDb };

