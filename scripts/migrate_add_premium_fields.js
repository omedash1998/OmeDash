#!/usr/bin/env node
// scripts/migrate_add_premium_fields.js
// Iterates the users collection and adds missing premium fields with safe defaults.
//
// Usage:
//   GOOGLE_APPLICATION_CREDENTIALS=path/to/key.json node scripts/migrate_add_premium_fields.js
//
// This script uses merge writes so existing field values are never overwritten.

require('dotenv').config();
const admin = require('firebase-admin');

// Initialise Admin SDK — uses GOOGLE_APPLICATION_CREDENTIALS or existing init
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.FIREBASE_PROJECT_ID || 'omedash-a435a',
  });
}
const db = admin.firestore();

const DEFAULTS = {
  isPremium: false,
  premiumExpiresAt: null,
  countryPref: null,
  genderPref: null,
  strikes: 0,
  isBanned: false,
};

async function migrate() {
  console.log('Starting premium fields migration…');
  const usersRef = db.collection('users');
  const snapshot = await usersRef.get();

  let updated = 0;
  let skipped = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const patch = {};

    for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
      if (data[key] === undefined || data[key] === null && defaultValue !== null) {
        // Only set if the field is truly missing (undefined)
        if (data[key] === undefined) {
          patch[key] = defaultValue;
        }
      }
    }

    if (Object.keys(patch).length > 0) {
      await usersRef.doc(doc.id).set(patch, { merge: true });
      updated++;
      console.log(`  ✓ ${doc.id} — added: ${Object.keys(patch).join(', ')}`);
    } else {
      skipped++;
    }
  }

  console.log(`\nMigration complete: ${updated} updated, ${skipped} already up-to-date.`);
  console.log(`Total users: ${snapshot.size}`);
}

migrate()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Migration failed:', err);
    process.exit(1);
  });
