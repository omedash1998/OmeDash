#!/usr/bin/env node
/**
 * Migration script: Copy messages from root messages collection into
 * conversations/{conversationId}/messages/{messageId} subcollection.
 *
 * Handles two possible legacy root structures:
 *   A) messages/{conversationId}/chat/{messageId}   (subcollection under root messages)
 *   B) messages/{messageId}  with a conversationId field  (flat root collection)
 *
 * For each migrated conversation, creates a minimal conversations/{convId} doc
 * (with participants array) if the participants can be inferred from messages.
 * Otherwise logs a warning and skips.
 *
 * Options (env vars):
 *   BACKUP=true        Move originals to _backup_messages_root after copy (default: false)
 *   DRY_RUN=true       Print what would happen without writing (default: false)
 *
 * Usage:
 *   node scripts/migrate_messages_to_subcollection.js
 *   BACKUP=true node scripts/migrate_messages_to_subcollection.js
 *   DRY_RUN=true node scripts/migrate_messages_to_subcollection.js
 *
 * Requires: Firebase Admin SDK (uses project config from src/config.js)
 */

const { admin, fireDb } = require('../src/firebase');

const BACKUP = process.env.BACKUP === 'true';
const DRY_RUN = process.env.DRY_RUN === 'true';
const BATCH_SIZE = 400; // keep under Firestore 500-op batch limit

async function migrate() {
    console.log('=== Migrate: Root messages → conversations/{convId}/messages ===');
    console.log(`  BACKUP=${BACKUP}  DRY_RUN=${DRY_RUN}\n`);

    let totalCopied = 0;
    let totalSkipped = 0;
    let totalConvsCreated = 0;
    let totalErrors = 0;

    // ─── Strategy A: messages/{conversationId}/chat/{messageId} ───
    console.log('Scanning root "messages" collection for subcollection structure...');
    const rootMsgsDocs = await fireDb.collection('messages').listDocuments();

    if (rootMsgsDocs.length > 0) {
        console.log(`Found ${rootMsgsDocs.length} document(s) under root "messages".\n`);

        for (const parentRef of rootMsgsDocs) {
            const conversationId = parentRef.id;
            console.log(`\n── Conversation: ${conversationId}`);

            // Check for /chat subcollection
            let chatDocs = [];
            try {
                const chatSnap = await parentRef.collection('chat').get();
                chatDocs = chatSnap.docs;
            } catch (e) { /* no chat subcollection */ }

            // Also check if the parent doc itself is a flat message
            const parentSnap = await parentRef.get();
            const parentData = parentSnap.exists ? parentSnap.data() : null;

            if (chatDocs.length === 0 && !parentData) {
                console.log('   No chat subcollection and no data — skipping.');
                totalSkipped++;
                continue;
            }

            // ── Handle subcollection: messages/{convId}/chat/{msgId} ──
            if (chatDocs.length > 0) {
                console.log(`   Found ${chatDocs.length} message(s) in /chat subcollection.`);

                // Infer participants from message senders
                const senderUids = new Set();
                const messagesToCopy = [];

                for (const msgDoc of chatDocs) {
                    const data = msgDoc.data();
                    const senderId = data.senderId || data.sender || data.fromUid;
                    if (senderId) senderUids.add(senderId);
                    messagesToCopy.push({ id: msgDoc.id, data });
                }

                // Try to infer participants
                let participants = Array.from(senderUids).sort();
                if (participants.length < 2) {
                    // Try to extract from conversationId pattern: uid1_uid2_roomId
                    const parts = conversationId.split('_');
                    if (parts.length >= 2) {
                        participants = [parts[0], parts[1]].sort();
                        console.log(`   Inferred participants from ID: ${participants.join(', ')}`);
                    } else {
                        console.warn(`   ⚠ Cannot infer participants for ${conversationId} — skipping.`);
                        totalSkipped++;
                        totalErrors++;
                        continue;
                    }
                }

                // Ensure conversation doc exists
                const convRef = fireDb.collection('conversations').doc(conversationId);
                const convSnap = await convRef.get();

                if (!convSnap.exists) {
                    if (DRY_RUN) {
                        console.log(`   [DRY_RUN] Would create conversations/${conversationId}`);
                    } else {
                        await convRef.set({
                            participants: participants,
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            migratedAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                        console.log(`   ✓ Created conversations/${conversationId}`);
                    }
                    totalConvsCreated++;
                } else {
                    console.log(`   conversations/${conversationId} already exists.`);
                }

                // Copy messages in batches
                let batch = fireDb.batch();
                let batchCount = 0;

                for (const msg of messagesToCopy) {
                    const destRef = convRef.collection('messages').doc(msg.id);

                    // Normalize fields
                    const normalized = {
                        senderId: msg.data.senderId || msg.data.sender || msg.data.fromUid || 'unknown',
                        text: msg.data.text || '',
                        createdAt: msg.data.createdAt || admin.firestore.FieldValue.serverTimestamp()
                    };

                    // Preserve any extra metadata
                    if (msg.data.metadata) normalized.metadata = msg.data.metadata;
                    if (msg.data.edited) normalized.edited = msg.data.edited;

                    if (DRY_RUN) {
                        console.log(`   [DRY_RUN] Would copy message ${msg.id}`);
                    } else {
                        batch.set(destRef, normalized, { merge: true });
                        batchCount++;

                        if (batchCount >= BATCH_SIZE) {
                            await batch.commit();
                            console.log(`   Committed batch of ${batchCount} messages`);
                            batch = fireDb.batch();
                            batchCount = 0;
                        }
                    }
                    totalCopied++;
                }

                if (!DRY_RUN && batchCount > 0) {
                    await batch.commit();
                    console.log(`   Committed batch of ${batchCount} messages`);
                }

                // Backup originals
                if (BACKUP && !DRY_RUN) {
                    await backupAndDelete(parentRef, chatDocs, conversationId);
                }

                continue; // Done with this conversationId
            }

            // ── Handle flat: messages/{messageId} with conversationId field ──
            if (parentData) {
                const msgConvId = parentData.conversationId || conversationId;
                const senderId = parentData.senderId || parentData.sender || parentData.fromUid;

                if (!senderId) {
                    console.warn(`   ⚠ No sender found in flat message ${conversationId} — skipping.`);
                    totalSkipped++;
                    totalErrors++;
                    continue;
                }

                // Try to infer participants
                let participants = [];
                const parts = msgConvId.split('_');
                if (parts.length >= 2) {
                    participants = [parts[0], parts[1]].sort();
                } else if (parentData.participants && Array.isArray(parentData.participants)) {
                    participants = parentData.participants;
                } else {
                    console.warn(`   ⚠ Cannot infer participants for flat message ${conversationId} — skipping.`);
                    totalSkipped++;
                    totalErrors++;
                    continue;
                }

                const convRef = fireDb.collection('conversations').doc(msgConvId);
                const convSnap = await convRef.get();
                if (!convSnap.exists) {
                    if (DRY_RUN) {
                        console.log(`   [DRY_RUN] Would create conversations/${msgConvId}`);
                    } else {
                        await convRef.set({
                            participants: participants,
                            createdAt: admin.firestore.FieldValue.serverTimestamp(),
                            migratedAt: admin.firestore.FieldValue.serverTimestamp()
                        });
                    }
                    totalConvsCreated++;
                }

                const destRef = convRef.collection('messages').doc(parentRef.id);
                const normalized = {
                    senderId: senderId,
                    text: parentData.text || '',
                    createdAt: parentData.createdAt || admin.firestore.FieldValue.serverTimestamp()
                };
                if (parentData.metadata) normalized.metadata = parentData.metadata;

                if (DRY_RUN) {
                    console.log(`   [DRY_RUN] Would copy flat message ${parentRef.id} → conversations/${msgConvId}/messages/${parentRef.id}`);
                } else {
                    await destRef.set(normalized, { merge: true });
                    console.log(`   ✓ Copied flat message → conversations/${msgConvId}/messages/${parentRef.id}`);
                }
                totalCopied++;

                if (BACKUP && !DRY_RUN) {
                    const backupRef = fireDb.collection('_backup_messages_root').doc(parentRef.id);
                    await backupRef.set(parentData);
                    await parentRef.delete();
                    console.log(`   ✓ Backed up & deleted original: messages/${parentRef.id}`);
                }
            }
        }
    } else {
        console.log('No documents found in root "messages" collection.');
    }

    console.log('\n=== Migration Summary ===');
    console.log(`  Messages copied:        ${totalCopied}`);
    console.log(`  Conversations created:   ${totalConvsCreated}`);
    console.log(`  Skipped:                 ${totalSkipped}`);
    console.log(`  Errors:                  ${totalErrors}`);
    if (DRY_RUN) console.log('  (DRY RUN — no writes were made)');
    if (BACKUP) console.log('  (Originals moved to _backup_messages_root)');

    // ── Verification step ──
    if (!DRY_RUN && totalCopied > 0) {
        console.log('\n=== Verification ===');
        let verified = 0;
        let verifyErrors = 0;
        const convsSnap = await fireDb.collection('conversations').get();
        for (const convDoc of convsSnap.docs) {
            try {
                const msgsSnap = await convDoc.ref.collection('messages').get();
                if (!msgsSnap.empty) {
                    verified += msgsSnap.size;
                }
            } catch (e) {
                console.warn(`   Verify error for ${convDoc.id}:`, e.message);
                verifyErrors++;
            }
        }
        console.log(`  Total messages in subcollections: ${verified}`);
        if (verifyErrors > 0) console.warn(`  Verification errors: ${verifyErrors}`);
        console.log('  Verification complete.');
    }

    console.log('Done.');

    if (totalErrors > 0) {
        console.error(`\nExiting with errors (${totalErrors}).`);
        process.exit(1);
    }
}

async function backupAndDelete(parentRef, chatDocs, conversationId) {
    try {
        // Copy parent doc to backup
        const parentSnap = await parentRef.get();
        if (parentSnap.exists) {
            const backupParentRef = fireDb.collection('_backup_messages_root').doc(conversationId);
            await backupParentRef.set(parentSnap.data());
        }

        // Copy chat subcollection docs to backup
        let batch = fireDb.batch();
        let count = 0;
        for (const chatDoc of chatDocs) {
            const backupChatRef = fireDb
                .collection('_backup_messages_root').doc(conversationId)
                .collection('chat').doc(chatDoc.id);
            batch.set(backupChatRef, chatDoc.data());
            count++;
            if (count >= BATCH_SIZE) {
                await batch.commit();
                batch = fireDb.batch();
                count = 0;
            }
        }
        if (count > 0) await batch.commit();

        // Delete originals
        batch = fireDb.batch();
        count = 0;
        for (const chatDoc of chatDocs) {
            batch.delete(chatDoc.ref);
            count++;
            if (count >= BATCH_SIZE) {
                await batch.commit();
                batch = fireDb.batch();
                count = 0;
            }
        }
        if (count > 0) await batch.commit();
        await parentRef.delete();

        console.log(`   ✓ Backed up & deleted originals for ${conversationId}`);
    } catch (e) {
        console.error(`   ✗ Backup failed for ${conversationId}:`, e.message);
    }
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
