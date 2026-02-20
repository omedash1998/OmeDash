import { auth, db } from "./auth.js";
import { serverTimestamp, collection, doc, setDoc, getDoc, deleteDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";
        // ── Matchmaking (client side) ─────────────────────────────
        export let _roomUnsub = null;
        export let _currentRoomId = null;

        export async function joinQueue() {
            const user = auth.currentUser;
            if (!user) {
                console.error('joinQueue: no authenticated user');
                return;
            }
            const uid = user.uid;

            // Check ban status
            try {
                const userSnap = await getDoc(doc(db, 'users', uid));
                if (userSnap.exists() && userSnap.data().isBanned === true) {
                    console.error('joinQueue: user is banned');
                    return;
                }
            } catch (err) {
                console.error('joinQueue: error checking user doc', err);
                return;
            }

            // Create waitingUsers doc (Cloud Function handles the rest)
            try {
                await setDoc(doc(db, 'waitingUsers', uid), {
                    uid: uid,
                    status: 'waiting',
                    createdAt: serverTimestamp()
                });
                console.log('Joined queue:', uid);
            } catch (err) {
                console.error('joinQueue: error creating waiting doc', err);
                return;
            }

            // Start listening for room assignment
            listenForAssignedRoom();
        }

        export async function leaveQueue() {
            const user = auth.currentUser;
            if (!user) return;
            console.log('Leaving queue:', user.uid);

            try {
                await deleteDoc(doc(db, 'waitingUsers', user.uid));
            } catch (err) {
                console.error('leaveQueue: error', err);
            }

            // Stop room listener
            if (_roomUnsub) { _roomUnsub(); _roomUnsub = null; }
        }

        export function listenForAssignedRoom() {
            const user = auth.currentUser;
            if (!user) return;

            // Clean up any previous listener
            if (_roomUnsub) { _roomUnsub(); _roomUnsub = null; }

            const userRef = doc(db, 'users', user.uid);
            _roomUnsub = onSnapshot(userRef, (snap) => {
                if (!snap.exists()) return;
                const data = snap.data();
                if (data.lastRoomId && data.lastRoomId !== _currentRoomId) {
                    _currentRoomId = data.lastRoomId;
                    console.log('Assigned to room:', _currentRoomId);
                    enterRoom(_currentRoomId);
                    // Stop listening once matched
                    if (_roomUnsub) { _roomUnsub(); _roomUnsub = null; }
                }
            });
        }

        export function enterRoom(roomId) {
            // Placeholder: integrate with WebRTC / UI here
            console.log('enterRoom called with:', roomId);
            _currentRoomId = roomId;
        }

        // Expose on window
        
        
        

        // Attach to buttons
        const _qStartBtn = document.getElementById('startBtn');
        if (_qStartBtn) _qStartBtn.addEventListener('click', joinQueue);

        const _qStopBtn = document.getElementById('stopBtn');
        if (_qStopBtn) _qStopBtn.addEventListener('click', leaveQueue);

        // Cleanup on page unload
        window.addEventListener('beforeunload', () => {
            leaveQueue();
        });