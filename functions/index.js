const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

initializeApp();
const db = getFirestore();

exports.onWaitingUserCreated = onDocumentCreated(
    "waitingUsers/{uid}",
    async (event) => {
        const newUid = event.params.uid;
        console.log("New waiting user:", newUid);

        try {
            // Find another waiting user
            const waitingSnap = await db
                .collection("waitingUsers")
                .where("status", "==", "waiting")
                .limit(10)
                .get();

            const otherDoc = waitingSnap.docs.find((d) => d.id !== newUid);
            if (!otherDoc) {
                console.log("No other users waiting. User stays in queue:", newUid);
                return null;
            }

            const otherUid = otherDoc.id;
            console.log("Potential match:", newUid, "<->", otherUid);

            // Transaction: verify both still waiting, create room, cleanup
            const roomId = await db.runTransaction(async (txn) => {
                const myRef = db.doc(`waitingUsers/${newUid}`);
                const otherRef = db.doc(`waitingUsers/${otherUid}`);

                const [mySnap, otherSnap] = await Promise.all([
                    txn.get(myRef),
                    txn.get(otherRef),
                ]);

                if (!mySnap.exists || !otherSnap.exists) {
                    console.log("Race condition: one or both users left the queue");
                    return null;
                }

                // Create room
                const roomRef = db.collection("rooms").doc();
                txn.set(roomRef, {
                    participants: [newUid, otherUid],
                    createdAt: FieldValue.serverTimestamp(),
                    state: "active",
                });

                // Delete both waiting docs
                txn.delete(myRef);
                txn.delete(otherRef);

                // Notify both users by setting lastRoomId on their user docs
                txn.update(db.doc(`users/${newUid}`), {
                    lastRoomId: roomRef.id,
                });
                txn.update(db.doc(`users/${otherUid}`), {
                    lastRoomId: roomRef.id,
                });

                return roomRef.id;
            });

            if (roomId) {
                console.log("Room created:", roomId, "for", newUid, "&", otherUid);
            }
            return null;
        } catch (err) {
            console.error("Matchmaking error:", err);
            return null;
        }
    }
);
