#!/usr/bin/env node
/**
 * One-time migration script: Add 'uid' field to all existing user documents.
 *
 * The new Firestore security rules require every /users/{uid} document to have
 * a 'uid' field matching the document ID.  Old documents created before this
 * rule was added are missing the field, which blocks ALL client-side updates.
 *
 * Usage:
 *   node scripts/migrate_add_uid.js
 *
 * Requires: Firebase Admin SDK (uses project config from src/config.js)
 */

const { admin, fireDb } = require('../src/firebase');

async function migrate() {
    console.log('=== Migrate: Add uid field to user documents ===\n');

    const usersSnap = await fireDb.collection('users').get();
    console.log(`Found ${usersSnap.size} user document(s).\n`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    // Process in batches of 500 (Firestore batch write limit)
    const BATCH_SIZE = 500;
    let batch = fireDb.batch();
    let batchCount = 0;

    for (const docSnap of usersSnap.docs) {
        const data = docSnap.data();
        const docId = docSnap.id;

        if (data.uid) {
            skipped++;
            continue;
        }

        try {
            batch.update(docSnap.ref, { uid: docId });
            batchCount++;
            updated++;

            if (batchCount >= BATCH_SIZE) {
                await batch.commit();
                console.log(`  Committed batch of ${batchCount} updates`);
                batch = fireDb.batch();
                batchCount = 0;
            }
        } catch (e) {
            console.error(`  Error preparing update for ${docId}:`, e.message);
            errors++;
        }
    }

    // Commit remaining
    if (batchCount > 0) {
        await batch.commit();
        console.log(`  Committed final batch of ${batchCount} updates`);
    }

    console.log('\n=== Migration complete ===');
    console.log(`  Updated: ${updated}`);
    console.log(`  Skipped (already has uid): ${skipped}`);
    console.log(`  Errors: ${errors}`);
    console.log(`  Total: ${usersSnap.size}`);

    process.exit(errors > 0 ? 1 : 0);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
