import { initializeApp } from "https://www.gstatic.com/firebasejs/12.9.0/firebase-app.js";
import {
getAuth,
GoogleAuthProvider,
signInWithPopup,
onAuthStateChanged,
signOut
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-auth.js";
import {
getFirestore,
doc,
getDoc,
setDoc,
deleteDoc,
onSnapshot,
serverTimestamp,
addDoc,
collection,
query,
where,
orderBy,
getDocs
} from "https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js";

const firebaseConfig = {
apiKey: "AIzaSyCADNGa11nE89TEgE8FEYdmJfXIr0AAzhY",
authDomain: "omedash-a435a.firebaseapp.com",
projectId: "omedash-a435a",
storageBucket: "omedash-a435a.firebasestorage.app",
messagingSenderId: "1072567951750",
appId: "1:1072567951750:web:51cbf810aab502f9854c07"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Expose to window for access from other parts of the code
window._firebaseAuth = auth;
window._firebaseDb = db;

// Expose Firestore query functions for non-module scripts
window.collection = collection;
window.query = query;
window.where = where;
window.orderBy = orderBy;
window.getDocs = getDocs;
window.fbDoc = doc;
window.fbGetDoc = getDoc;
window.addDoc = addDoc;
window.serverTimestamp = serverTimestamp;
window.fbOnSnapshot = onSnapshot;

// Reveal main app content (remove app-hidden from all elements)
function revealApp() {
document.querySelectorAll('.app-hidden').forEach(el => {
    el.classList.remove('app-hidden');
});
}
window._revealApp = revealApp;

// Save onboarding data to Firestore (called from age modal submit)
window._saveOnboarding = async function (gender, age) {
const user = auth.currentUser;
if (!user) return;
const userRef = doc(db, 'users', user.uid);
await setDoc(userRef, {
    gender: gender,
    age: age,
    onboardingComplete: true
}, { merge: true });
console.log('Onboarding saved for:', user.uid);
detectAndSaveCountry(user, db);
};

// Sign in with Google (popup)
async function signInWithGoogle() {
try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
} catch (error) {
    console.error('Google sign-in error:', error);
}
}

// Attach Google sign-in button
const googleBtn = document.getElementById('googleSignInBtn');
if (googleBtn) {
googleBtn.addEventListener('click', signInWithGoogle);
}

async function detectAndSaveCountry(user, db) {
if (window._countryDetected) return;
window._countryDetected = true;
try {
    const res = await fetch('https://ipapi.co/json/');
    const data = await res.json();
    if (data && data.country_code) {
        const code = data.country_code;
        const name = data.country_name || code;
        const emoji = code.toUpperCase().replace(/./g, char => String.fromCodePoint(char.charCodeAt(0) + 127397));
        const userRef = doc(db, 'users', user.uid);
        await setDoc(userRef, {
            countryName: name,
            countryCode: code,
            countryEmoji: emoji
        }, { merge: true });
        console.log('Country info saved:', code, emoji);
    }
} catch (err) {
    console.error('Error detecting country:', err);
}
}

// Auth state change handler — orchestrates the full flow
onAuthStateChanged(auth, async (user) => {
const loginScreen = document.getElementById('loginScreen');

if (!user) {
    // Not logged in — show login screen, hide app
    if (loginScreen) loginScreen.style.display = 'flex';
    return;
}

console.log('Authenticated:', user.uid);
// Expose UID globally for socket registration
window._firebaseUid = user.uid;

// Signal to premium scripts (and any other listener) that auth is ready
try { window.dispatchEvent(new CustomEvent('firebase-auth-ready', { detail: { uid: user.uid } })); } catch(_) {}

// Hide login screen
if (loginScreen) loginScreen.style.display = 'none';

try {
    const userRef = doc(db, 'users', user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        // First-time user — create doc with onboardingComplete = false
        await setDoc(userRef, {
            uid: user.uid,
            isPremium: false,
            isBanned: false,
            reputation: 0,
            onboardingComplete: false,
            createdAt: serverTimestamp()
        });
        console.log('Created new user document:', user.uid);
        // Show onboarding modal
        if (window.showAgeModal) window.showAgeModal();
        return;
    }

    const data = userSnap.data();

    // Update lastLogin
    await setDoc(userRef, { lastLogin: serverTimestamp() }, { merge: true });

    // ── Ban check on page load ──
    if (data.isBanned === true) {
        console.log('User is banned, reason:', data.bannedReason);
        revealApp(); // reveal so overlays are visible

        if (data.bannedReason === 'minor') {
            // Permanent ban — show red overlay
            if (window.showBanOverlay) window.showBanOverlay('minor');
            return;
        }

        // Temporary ban — check expiration
        const expiresAt = data.bannedExpiresAt;
        let expiresMs = null;
        if (expiresAt) {
            // Firestore Timestamp or raw ms
            if (expiresAt.toDate) expiresMs = expiresAt.toDate().getTime();
            else if (expiresAt.seconds) expiresMs = expiresAt.seconds * 1000;
            else expiresMs = expiresAt;
        }

        if (expiresMs && Date.now() >= expiresMs) {
            // Ban expired client-side — server will auto-unban on register
            console.log('Ban appears expired, proceeding to app');
            // Don’t return — let normal flow continue, server will clean up
        } else {
            // Still active — show temp ban with countdown
            if (window.showBanOverlay) window.showBanOverlay(data.bannedReason || 'bad_behavior', expiresMs);
            return;
        }
    }

    if (data.onboardingComplete === true && data.age && data.age >= 18 && data.gender) {
        // Returning user with completed onboarding — go to app
        console.log('Onboarding complete, showing app for:', user.uid);
        window._onboardingComplete = true;
        revealApp();
        detectAndSaveCountry(user, db);
    } else {
        // Onboarding not complete — show modal
        console.log('Onboarding incomplete, showing modal for:', user.uid);
        window._onboardingComplete = false;
        if (window.showAgeModal) window.showAgeModal();
    }
} catch (err) {
    console.error('Error in auth flow:', err);
}
});

// Expose signOut for settings logout button
window._firebaseSignOut = () => signOut(auth);

// ── Matchmaking (client side) ─────────────────────────────
let _roomUnsub = null;
let _currentRoomId = null;

async function joinQueue() {
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

async function leaveQueue() {
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

function listenForAssignedRoom() {
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

function enterRoom(roomId) {
// Placeholder: integrate with WebRTC / UI here
console.log('enterRoom called with:', roomId);
_currentRoomId = roomId;
}

// Expose on window
window.joinQueue = joinQueue;
window.leaveQueue = leaveQueue;
window.enterRoom = enterRoom;

// Attach to buttons
const _qStartBtn = document.getElementById('startBtn');
if (_qStartBtn) _qStartBtn.addEventListener('click', joinQueue);

const _qStopBtn = document.getElementById('stopBtn');
if (_qStopBtn) _qStopBtn.addEventListener('click', leaveQueue);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
leaveQueue();
});
