let socket = null;
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const stText = document.getElementById("stText");
const startBtn = document.getElementById("startBtn");
const nextBtn = document.getElementById("nextBtn");
const pauseBtn = document.getElementById("pauseBtn");
const historyBtn = document.getElementById("historyBtn");
const settingsBtn = document.getElementById("settingsBtn");

const chatLog = document.getElementById("chatLog");
const chatInput = document.getElementById("chatInput");
const chatSend = document.getElementById("chatSend");
const chatStatus = document.getElementById("chatStatus");
const chatStatusFlag = document.getElementById("chatStatusFlag");
const mobileStatusBadge = document.getElementById("mobileStatusBadge");
const agreeNote = document.getElementById('agreeNote');
const starfieldEl = document.getElementById('starfield');

// Helper function to update mobile status badge (syncs with chatStatus)
function updateMobileStatusBadge(text, show) {
    if (!mobileStatusBadge) return;

    // Only show on mobile (when chatStatus is hidden)
    const isMobile = window.matchMedia('(max-width: 600px) and (pointer: coarse)').matches;
    if (!isMobile) return;

    if (show) {
        mobileStatusBadge.textContent = text;
        mobileStatusBadge.style.display = 'block';
        mobileStatusBadge.classList.remove('fade-out');
    } else {
        mobileStatusBadge.classList.add('fade-out');
        setTimeout(() => {
            mobileStatusBadge.style.display = 'none';
        }, 300);
    }
}

// Generate random stars for starfield
function initStarfield() {
    if (!starfieldEl) return;
    starfieldEl.innerHTML = '';
    for (let i = 0; i < 60; i++) {
        const star = document.createElement('div');
        star.className = 'star';
        star.style.top = Math.random() * 100 + '%';
        star.style.right = '-4px';
        star.style.width = (1 + Math.random() * 2) + 'px';
        star.style.height = star.style.width;
        star.style.animationDuration = (2 + Math.random() * 4) + 's';
        star.style.animationDelay = (Math.random() * 5) + 's';
        starfieldEl.appendChild(star);
    }
}
initStarfield();

function showStarfield() { if (starfieldEl) starfieldEl.style.display = 'block'; }
function hideStarfield() { if (starfieldEl) starfieldEl.style.display = 'none'; }

function countryCodeToFlag(code) {
    if (!code || typeof code !== 'string') return '';
    const c = code.trim().toUpperCase();
    if (c.length !== 2) return '';
    return c.split('').map(ch => String.fromCodePoint(127397 + ch.charCodeAt(0))).join('');
}

function getFlagEmojiForCountryString(countryStr) {
    if (!countryStr) return '';
    // ISO2 code?
    const maybe = (countryStr || '').trim();
    if (/^[A-Za-z]{2}$/.test(maybe)) return countryCodeToFlag(maybe);

    // Try to find matching option in the filterCountry select (we prepended emoji to option text)
    try {
        for (const opt of Array.from(filterCountrySelect.options || [])) {
            if (!opt) continue;
            const text = (opt.textContent || '').toLowerCase();
            const val = (opt.value || '').toLowerCase();
            const target = maybe.toLowerCase();
            if (val === target || text.indexOf(target) !== -1) {
                // assume emoji is the first token before a space
                const first = (opt.textContent || '').trim().split(' ')[0];
                return first;
            }
        }
    } catch (e) { /* ignore */ }
    return '';
}

// Filter elements
const myGenderSelect = document.getElementById("myGender");
const filterGenderSelect = document.getElementById("filterGender");
const filterCountrySelect = document.getElementById("filterCountry");
const reportBtn = document.getElementById("reportBtn");
const reportModal = document.getElementById("reportModal");
const reportCancelBtn = document.getElementById("reportCancelBtn");
const reportConfirmBtn = document.getElementById("reportConfirmBtn");
const reportToast = document.getElementById("reportToast");
const banOverlay = document.getElementById("banOverlay");
const paymentOverlay = document.getElementById("paymentOverlay");
const payUnbanBtn = document.getElementById("payUnbanBtn");
const tempBanOverlay = document.getElementById("tempBanOverlay");
const tempBanPayBtn = document.getElementById("tempBanPayBtn");
const cdDays = document.getElementById("cdDays");
const cdHours = document.getElementById("cdHours");
const cdMins = document.getElementById("cdMins");
const cdSecs = document.getElementById("cdSecs");
const confirmDeleteModal = document.getElementById("confirmDeleteModal");
const confirmDeleteTitle = document.getElementById("confirmDeleteTitle");
const confirmDeleteMessage = document.getElementById("confirmDeleteMessage");
const confirmDeleteOk = document.getElementById("confirmDeleteOk");
const confirmDeleteCancel = document.getElementById("confirmDeleteCancel");
let confirmDeleteAction = null;
let selectedReportReason = null;
let isReportSubmitting = false;
// partnerUid is set when matched (server sends it); used for report
let currentPartnerUid = null;
let currentRoomId = null;
let _convListenerUnsub = null;

let pc = null;
let localStream = null;
let currentPartner = null;
let role = null;
let isPaused = false;
// map of partner socket id -> profile { pic, about, name, from }
const partnerProfiles = {};

function openConfirmDeleteModal(title, message, action) {
    try {
        if (confirmDeleteTitle) confirmDeleteTitle.textContent = title || 'Confirm';
        if (confirmDeleteMessage) confirmDeleteMessage.textContent = message || 'Are you sure?';
        confirmDeleteAction = (typeof action === 'function') ? action : null;
        if (confirmDeleteModal) confirmDeleteModal.style.display = 'flex';
    } catch (e) { /* ignore */ }
}

function closeConfirmDeleteModal() {
    try {
        confirmDeleteAction = null;
        if (confirmDeleteModal) confirmDeleteModal.style.display = 'none';
    } catch (e) { /* ignore */ }
}

try {
    if (confirmDeleteCancel) confirmDeleteCancel.addEventListener('click', closeConfirmDeleteModal);
    if (confirmDeleteOk) confirmDeleteOk.addEventListener('click', () => {
        try { if (confirmDeleteAction) confirmDeleteAction(); } catch (e) { /* ignore */ }
        closeConfirmDeleteModal();
    });
    if (confirmDeleteModal) confirmDeleteModal.addEventListener('click', (e) => {
        if (e && e.target === confirmDeleteModal) closeConfirmDeleteModal();
    });
} catch (e) { /* ignore */ }

function log(...args) { console.log("[webrtc]", ...args); }

function getPreferences() {
    return {
        myGender: myGenderSelect.value,
        gender: filterGenderSelect.value,
        country: filterCountrySelect.value
    };
}

async function startLocalStream() {
    if (localStream) return;
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localVideo.srcObject = localStream;
        log("local stream ready");
        stText.textContent = "Waiting for match...";
        if (role) startAs(role);
    } catch (err) {
        console.warn("Camera access denied or unavailable", err);
    }
}

function createPeerConnection() {
    const newPc = new RTCPeerConnection({
        iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            { urls: "stun:stun1.l.google.com:19302" },
            {
                urls: [
                    "turn:64.23.227.110:3478",
                    "turn:64.23.227.110:3478?transport=tcp",
                    "turns:64.23.227.110:443"
                ],
                username: "test",
                credential: "test123"
            }
        ],
        iceCandidatePoolSize: 10
    });

    newPc.onicecandidate = e => {
        if (e.candidate) socket.emit("ice-candidate", e.candidate);
    };

    newPc.ontrack = e => {
        remoteVideo.srcObject = e.streams[0];
        log("remote track set");
    };

    return newPc;
}

// report button: small translucent overlay on partner video
function updateReportVisibility() {
    if (!reportBtn) return;
    try {
        reportBtn.style.display = (currentPartner && !isPaused) ? 'flex' : 'none';
    } catch (e) { /* ignore */ }
}

// ── Report Modal Logic ──────────────────────────────────────
function openReportModal() {
    if (!reportModal) return;
    selectedReportReason = null;
    isReportSubmitting = false;
    // Reset button states
    document.querySelectorAll('.report-reason-btn').forEach(btn => {
        btn.classList.remove('selected');
        btn.disabled = false;
    });
    if (reportConfirmBtn) { reportConfirmBtn.disabled = true; reportConfirmBtn.textContent = 'Confirm Report'; }
    reportModal.style.display = 'flex';
}

function closeReportModal() {
    if (reportModal) reportModal.style.display = 'none';
    selectedReportReason = null;
    isReportSubmitting = false;
}

function showToast(message) {
    if (!reportToast) return;
    reportToast.textContent = message;
    reportToast.classList.add('show');
    setTimeout(() => { reportToast.classList.remove('show'); }, 3000);
}

function disableAllControls() {
    try { startBtn.disabled = true; } catch (e) { }
    try { nextBtn.disabled = true; } catch (e) { }
    try { pauseBtn.disabled = true; } catch (e) { }
    try { chatSend.disabled = true; } catch (e) { }
    try { chatInput.disabled = true; } catch (e) { }
    try { updateReportVisibility(); } catch (e) { }
}

function enableAllControls() {
    try { startBtn.disabled = false; } catch (e) { }
    try { nextBtn.disabled = false; } catch (e) { }
    try { pauseBtn.disabled = false; } catch (e) { }
    try { chatSend.disabled = false; } catch (e) { }
    try { chatInput.disabled = false; } catch (e) { }
    try { updateReportVisibility(); } catch (e) { }
}

function showBanOverlay(reason, expiresAt) {
    if (reason === 'minor' || (!reason)) {
        // minor → permanent red ban
        if (banOverlay) banOverlay.style.display = 'flex';
        disableAllControls();
        return;
    }
    // sexual / bad_behavior
    if (expiresAt) {
        // Temporary ban with countdown
        showTempBanOverlay(expiresAt);
    } else {
        // Fallback: show payment overlay
        showPaymentOverlay();
    }
}
window.showBanOverlay = showBanOverlay;

let banCountdownInterval = null;

function showTempBanOverlay(expiresAt) {
    if (tempBanOverlay) tempBanOverlay.style.display = 'flex';
    disableAllControls();
    // Start countdown
    if (banCountdownInterval) { clearInterval(banCountdownInterval); banCountdownInterval = null; }
    function tick() {
        const remaining = expiresAt - Date.now();
        if (remaining <= 0) {
            // Timer expired — auto-reload
            clearInterval(banCountdownInterval);
            banCountdownInterval = null;
            if (cdDays) cdDays.textContent = '00';
            if (cdHours) cdHours.textContent = '00';
            if (cdMins) cdMins.textContent = '00';
            if (cdSecs) cdSecs.textContent = '00';
            window.location.reload();
            return;
        }
        const totalSecs = Math.floor(remaining / 1000);
        const d = Math.floor(totalSecs / 86400);
        const h = Math.floor((totalSecs % 86400) / 3600);
        const m = Math.floor((totalSecs % 3600) / 60);
        const s = totalSecs % 60;
        if (cdDays) cdDays.textContent = String(d).padStart(2, '0');
        if (cdHours) cdHours.textContent = String(h).padStart(2, '0');
        if (cdMins) cdMins.textContent = String(m).padStart(2, '0');
        if (cdSecs) cdSecs.textContent = String(s).padStart(2, '0');
    }
    tick();
    banCountdownInterval = setInterval(tick, 1000);
}
window.showTempBanOverlay = showTempBanOverlay;

function hideTempBanOverlay() {
    if (tempBanOverlay) tempBanOverlay.style.display = 'none';
    if (banCountdownInterval) { clearInterval(banCountdownInterval); banCountdownInterval = null; }
}

function showPaymentOverlay() {
    if (paymentOverlay) paymentOverlay.style.display = 'flex';
    disableAllControls();
}

function hidePaymentOverlay() {
    if (paymentOverlay) paymentOverlay.style.display = 'none';
}

// Pay button → redirect to Stripe unban checkout
async function handlePayUnban(btn) {
    try {
        const auth = window._firebaseAuth;
        if (!auth || !auth.currentUser) {
            showToast('Not signed in');
            return;
        }
        btn.disabled = true;
        btn.textContent = 'Processing...';
        const token = await auth.currentUser.getIdToken();
        const res = await fetch('/create-unban-session', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + token }
        });
        const data = await res.json();
        if (data.url) {
            window.location.href = data.url;
        } else {
            showToast('Payment error. Try again.');
            btn.disabled = false;
            btn.textContent = 'Pay & Restore Access';
        }
    } catch (err) {
        console.error('Unban payment error:', err);
        showToast('Payment error. Try again.');
        if (btn) { btn.disabled = false; btn.textContent = 'Pay & Restore Access'; }
    }
}

if (payUnbanBtn) {
    payUnbanBtn.addEventListener('click', () => handlePayUnban(payUnbanBtn));
}
if (tempBanPayBtn) {
    tempBanPayBtn.addEventListener('click', () => handlePayUnban(tempBanPayBtn));
}

// Reason button selection (single-select)
document.querySelectorAll('.report-reason-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        if (isReportSubmitting) return;
        document.querySelectorAll('.report-reason-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        selectedReportReason = btn.dataset.reason;
        if (reportConfirmBtn) reportConfirmBtn.disabled = false;
    });
});

// Cancel button
if (reportCancelBtn) {
    reportCancelBtn.addEventListener('click', closeReportModal);
}

// Click outside modal to close
if (reportModal) {
    reportModal.addEventListener('click', (e) => {
        if (e.target === reportModal) closeReportModal();
    });
}

// Confirm button — submit report
if (reportConfirmBtn) {
    reportConfirmBtn.addEventListener('click', () => {
        if (!selectedReportReason || isReportSubmitting) return;
        if (!currentPartnerUid) { showToast('No partner to report'); closeReportModal(); return; }
        isReportSubmitting = true;
        // Loading state
        reportConfirmBtn.disabled = true;
        reportConfirmBtn.textContent = 'Submitting...';
        document.querySelectorAll('.report-reason-btn').forEach(b => b.disabled = true);
        if (reportCancelBtn) reportCancelBtn.disabled = true;
        // Emit report
        if (socket) {
            socket.emit('report-user', { reason: selectedReportReason, partnerUid: currentPartnerUid });
        }
    });
}

// Report button opens modal (not direct emit)
if (reportBtn) {
    reportBtn.style.display = 'none';
    reportBtn.addEventListener('click', () => {
        if (!currentPartner) return;
        openReportModal();
    });
}

async function startAs(roleAssigned) {
    role = roleAssigned;
    if (!localStream) return;

    if (pc) {
        try { pc.close(); } catch (e) { }
        pc = null;
        remoteVideo.srcObject = null;
    }

    pc = createPeerConnection();
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));
    stText.textContent = "Connected (role: " + role + ")";
    pauseBtn.disabled = false;

    if (role === "caller") {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socket.emit("offer", offer);
    }
}

function attachSocketHandlers() {
    socket.on("matched", async ({ role: r, partner, partnerUid: pUid, roomId: matchedRoomId }) => {
        log("matched:", r, partner);
        currentPartner = partner;
        currentPartnerUid = pUid || null; // UID of partner for reporting
        currentRoomId = matchedRoomId || null;
        partnerConnectedAt = Date.now();
        stText.textContent = "Matched - connecting...";
        try {
            if (chatStatus) chatStatus.textContent = 'Connected';
            updateMobileStatusBadge('Connected', true);
            // hide loading spinner when matched
            try { const spinner = document.getElementById('partnerSpinner'); if (spinner) spinner.style.display = 'none'; } catch (e) { }
            // hide starfield when connected
            try { hideStarfield(); } catch (e) { }
            // hide big logo when connected
            try { const big = document.getElementById('partnerLogoBig'); if (big) big.style.display = 'none'; } catch (e) { }
            // show small logo when connected
            try { const small = document.getElementById('partnerLogoSmall'); if (small) { small.style.display = 'block'; small.style.opacity = '0.5'; } } catch (e) { }
            // hide mobile settings button when connected
            try { const mobileSettings = document.getElementById('mobileSettingsBtn'); if (mobileSettings) mobileSettings.style.display = 'none'; } catch (e) { }
            // try to show partner country flag if we already have profile info
            const p = partnerProfiles[partner];
            const flag = (p && (p.countryCode || p.country || p.country_name)) ? getFlagEmojiForCountryString(p.countryCode || p.country || p.country_name) : '';
            if (chatStatusFlag) chatStatusFlag.textContent = flag || '';
        } catch (e) { }
        nextBtn.disabled = false;
        await startAs(r);
        // enable chat UI now that we're connected to a partner
        try { chatSend.disabled = false; } catch (e) { }
        try { chatInput.disabled = false; } catch (e) { }
        // emit our profile to the partner (if any saved)
        try {
            const raw = localStorage.getItem('vchat_profile');
            if (raw) {
                const obj = JSON.parse(raw);
                socket.emit('profile', obj);
            }
        } catch (e) { /* ignore */ }
        try { updateReportVisibility(); } catch (e) { }
        // Fetch partner country from Firestore room and render badge
        try {
            if (matchedRoomId && window._firebaseDb) {
                const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
                const roomSnap = await getDoc(doc(window._firebaseDb, 'rooms', matchedRoomId));
                if (roomSnap.exists()) {
                    const countries = roomSnap.data().participantCountries || {};
                    const partnerCountry = countries[partner];
                    if (partnerCountry && partnerCountry.countryEmoji) {
                        const badge = document.createElement('div');
                        badge.className = 'partner-country-badge';
                        badge.textContent = partnerCountry.countryEmoji;
                        const isMobile = window.matchMedia('(max-width: 768px) and (pointer: coarse)').matches;
                        const container = isMobile
                            ? document.getElementById('localVideo')?.parentElement
                            : document.querySelector('.partner-video');
                        if (container) {
                            const old = container.querySelector('.partner-country-badge');
                            if (old) old.remove();
                            container.appendChild(badge);
                        }
                    }
                }
            }
        } catch (e) { /* fail silently */ }
    });

    socket.on("offer", async (offer) => {
        if (!pc) await startAs("viewer");
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        socket.emit("answer", answer);
    });

    socket.on("answer", async (answer) => {
        await pc.setRemoteDescription(answer);
    });

    socket.on("ice-candidate", async (candidate) => {
        if (pc) {
            try { await pc.addIceCandidate(candidate); }
            catch (e) { console.error(e); }
        }
    });

    socket.on("partner-left", ({ reason }) => {
        // compute duration and save to history if long enough
        try {
            if (partnerConnectedAt && currentPartner) {
                const dur = Date.now() - partnerConnectedAt;
                if (dur >= 10000) {
                    addHistoryEntry({ id: currentPartner, when: Date.now(), duration: dur });
                }
            }
        } catch (e) { console.warn('history save failed', e); }
        partnerConnectedAt = null;
        cleanupAfterPartnerLeft();
        clearChat();
        stText.textContent = "Partner left. Searching for next...";
        try { if (chatStatus) chatStatus.textContent = 'Searching partner...'; } catch (e) { }
        updateMobileStatusBadge('Searching partner...', true);
        try { const spinner = document.getElementById('partnerSpinner'); if (spinner) { spinner.style.top = 'calc(50% - 10px)'; spinner.style.display = 'block'; } } catch (e) { }
        try { showStarfield(); } catch (e) { }
        try { const big = document.getElementById('partnerLogoBig'); if (big) big.style.display = 'none'; } catch (e) { }
        try { const small = document.getElementById('partnerLogoSmall'); if (small) { small.style.display = 'block'; small.style.opacity = '0.9'; } } catch (e) { }
        try { if (chatStatusFlag) chatStatusFlag.textContent = ''; } catch (e) { }
        try { const cb = document.querySelector('.partner-country-badge'); if (cb) cb.remove(); } catch (e) { }
        try { const cb2 = document.getElementById('localVideo')?.parentElement?.querySelector('.partner-country-badge'); if (cb2) cb2.remove(); } catch (e) { }
        nextBtn.disabled = true;
        socket.emit("set-preferences", getPreferences());
        socket.emit("ready");
        try { updateReportVisibility(); } catch (e) { }
    });

    // receive profile info from partner
    socket.on('profile', (payload) => {
        try {
            if (payload && payload.from) {
                partnerProfiles[payload.from] = payload;
                // refresh history UI if it's open
                const m = document.getElementById('historyModal');
                if (m && m.style.display === 'flex') renderHistoryList();
                // if this profile belongs to the currently connected partner, update the flag
                try {
                    if (payload.from === currentPartner) {
                        const flag = getFlagEmojiForCountryString(payload.countryCode || payload.country || payload.country_name);
                        if (chatStatusFlag) chatStatusFlag.textContent = flag || '';
                    }
                } catch (e) { }
            }
        } catch (e) { console.warn('profile handler failed', e); }
    });

    socket.on("chat", (msg) => {
        console.log('[CHAT-DEBUG] received chat event:', JSON.stringify(msg));
        const text = (msg && msg.text) || msg;
        console.log('[CHAT-DEBUG] calling appendChatMessage("other",', JSON.stringify(text) + ')');
        appendChatMessage("other", text);
    });

    // Report acknowledgment — close modal, show toast, skip to next
    socket.on('report-received', (payload) => {
        try {
            closeReportModal();
            showToast('Report submitted');
            // Auto-skip to next partner
            if (socket) socket.emit('next');
        } catch (e) { /* ignore */ }
    });

    // Report error — show error toast, re-enable modal
    socket.on('report-error', (payload) => {
        try {
            const msg = (payload && payload.message) || 'Report failed';
            showToast(msg);
            // Re-enable modal controls
            isReportSubmitting = false;
            if (reportConfirmBtn) { reportConfirmBtn.disabled = !selectedReportReason; reportConfirmBtn.textContent = 'Confirm Report'; }
            document.querySelectorAll('.report-reason-btn').forEach(b => b.disabled = false);
            if (reportCancelBtn) reportCancelBtn.disabled = false;
        } catch (e) { /* ignore */ }
    });

    // Banned — show correct overlay based on reason + expiration
    socket.on('banned', (payload) => {
        try {
            closeReportModal();
            const reason = (payload && payload.reason) || 'minor';
            const permanent = payload && payload.permanent;
            const expiresAt = payload && payload.expiresAt;
            if (permanent || reason === 'minor') {
                showBanOverlay('minor');
            } else {
                showBanOverlay(reason, expiresAt);
            }
        } catch (e) { /* ignore */ }
    });

    // Unbanned — hide all overlays, re-enable everything
    socket.on('unbanned', () => {
        try {
            hidePaymentOverlay();
            hideTempBanOverlay();
            if (banOverlay) banOverlay.style.display = 'none';
            enableAllControls();
            showToast('Account access restored');
        } catch (e) { /* ignore */ }
    });

    // ── Private Messaging Events ──────────────────────────────
    // Server requests payment for premium messaging
    socket.on('need_payment', (payload) => {
        try {
            console.log('Premium required for messaging');
            openMembershipModal();
            showToast('Premium membership required to message');
        } catch (e) { console.error('need_payment handler failed', e); }
    });

    // Incoming private message from another user — append inline without full re-render
    socket.on('private-message-received', (payload) => {
        try {
            const { fromUid, text, conversationId } = payload;
            console.log('[app.js] Received private message from', fromUid, 'conv:', conversationId);
            showToast('New message received');

            // Helper: inject bubble into a conv-box body
            function injectIntoBox(partnerBox) {
                const body = partnerBox.querySelector('.conv-body');
                console.log('[DEBUG injectIntoBox] body found:', !!body, 'body children before:', body ? body.children.length : 0, 'body.open:', body ? body.classList.contains('open') : 'N/A');
                if (!body) return false;
                const row = document.createElement('div');
                row.className = 'msg-row msg-row-in';
                const bubble = document.createElement('div');
                bubble.className = 'message-bubble message-in';
                bubble.textContent = text;
                row.appendChild(bubble);
                body.appendChild(row);
                console.log('[DEBUG injectIntoBox] bubble appended! body children after:', body.children.length, 'row in DOM:', document.contains(row));
                if (body.classList.contains('open')) {
                    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
                } else {
                    partnerBox.classList.add('conv-unread-pulse');
                    setTimeout(() => { partnerBox.classList.remove('conv-unread-pulse'); }, 2000);
                }
                // Update subtitle
                const sub = partnerBox.querySelector('.conv-sub');
                if (sub) sub.textContent = new Date().toLocaleString() + ' \u2014 ' + (text.length > 40 ? text.slice(0, 40) + '...' : text);
                return true;
            }

            // Try to inject into existing Messages tab conv-box
            const ml = document.getElementById('messageList');
            let injected = false;
            if (ml) {
                // Check both attribute names: app.js uses data-partner-uid, main.js uses data-partner-id
                let partnerBox = ml.querySelector('.conv-box[data-partner-uid="' + fromUid + '"]');
                if (!partnerBox) partnerBox = ml.querySelector('.conv-box[data-partner-id="' + fromUid + '"]');
                if (partnerBox) {
                    // Ensure both attributes are set for future lookups
                    if (!partnerBox.getAttribute('data-partner-uid')) partnerBox.setAttribute('data-partner-uid', fromUid);
                    injected = injectIntoBox(partnerBox);
                    // Move to top
                    if (injected && ml.firstChild !== partnerBox) ml.insertBefore(partnerBox, ml.firstChild);
                }
            }

            // If not injected (box doesn't exist yet), create one directly from socket data
            if (!injected && ml) {
                // Remove empty state if showing
                const emptyEl = ml.querySelector('.history-empty');
                if (emptyEl) emptyEl.remove();
                const loadingEl = ml.querySelector('div[style*="text-align:center"]');
                if (loadingEl && !loadingEl.classList.contains('conv-box')) loadingEl.remove();

                // Build a minimal conv-box from the socket payload
                const box = document.createElement('div');
                box.className = 'conv-box conv-box-enter';
                box.setAttribute('data-partner-uid', fromUid);

                const header = document.createElement('div'); header.className = 'conv-header';
                const avatar = document.createElement('div'); avatar.className = 'conv-avatar';
                avatar.innerHTML = '<svg width="32" height="22" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#eef7ff"/><path d="M12 12c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3z" fill="#cfeeff"/></svg>';
                const titleWrap = document.createElement('div');
                titleWrap.style.flex = '1'; titleWrap.style.minWidth = '0';
                const title = document.createElement('div'); title.className = 'conv-title';
                title.textContent = fromUid.slice(0, 8) + '...';
                const sub = document.createElement('div'); sub.className = 'conv-sub';
                sub.textContent = new Date().toLocaleString() + ' \u2014 ' + (text.length > 40 ? text.slice(0, 40) + '...' : text);
                titleWrap.appendChild(title); titleWrap.appendChild(sub);
                header.appendChild(avatar); header.appendChild(titleWrap);

                const body = document.createElement('div'); body.className = 'conv-body';
                const row = document.createElement('div'); row.className = 'msg-row msg-row-in';
                const bubble = document.createElement('div'); bubble.className = 'message-bubble message-in';
                bubble.textContent = text;
                row.appendChild(bubble); body.appendChild(row);

                const footer = document.createElement('div'); footer.className = 'conv-footer';
                footer.style.display = 'none';
                const input = document.createElement('input'); input.className = 'conv-input'; input.placeholder = 'Type a message...';
                const send = document.createElement('button'); send.className = 'conv-send'; send.textContent = 'Send';
                footer.appendChild(input); footer.appendChild(send);

                header.addEventListener('click', async () => {
                    const isOpen = body.classList.toggle('open');
                    footer.style.display = isOpen ? '' : 'none';
                    if (isOpen) {
                        // Lazy-load all messages from Firestore on first open
                        if (!body.dataset.loaded && conversationId) {
                            try {
                                const db = window._firebaseDb;
                                const user = window._firebaseAuth && window._firebaseAuth.currentUser;
                                if (db && user) {
                                    const msgsRef = collection(db, 'conversations', conversationId, 'messages');
                                    const msgsQuery = query(msgsRef, orderBy('createdAt', 'asc'));
                                    const snap = await getDocs(msgsQuery);
                                    if (!snap.empty) {
                                        body.innerHTML = '';
                                        snap.forEach(md => {
                                            const mData = md.data();
                                            const senderUid = mData.senderId || mData.sender || mData.fromUid;
                                            const dir = senderUid === user.uid ? 'out' : 'in';
                                            const row = document.createElement('div');
                                            row.className = 'msg-row ' + (dir === 'out' ? 'msg-row-out' : 'msg-row-in');
                                            const bubble = document.createElement('div');
                                            bubble.className = 'message-bubble ' + (dir === 'out' ? 'message-out' : 'message-in');
                                            bubble.textContent = mData.text || '';
                                            row.appendChild(bubble);
                                            body.appendChild(row);
                                        });
                                        body.dataset.loaded = 'true';
                                    }
                                }
                            } catch (e) { console.warn('Lazy load messages failed', e); }
                        }
                        requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
                    }
                });

                // Send handler for this new box
                if (conversationId) {
                    const doSend = async () => {
                        const txt = (input.value || '').trim();
                        if (!txt) return;
                        try {
                            _msgSendCooldown = Date.now() + 4000;
                            const r = document.createElement('div'); r.className = 'msg-row msg-row-out';
                            const b = document.createElement('div'); b.className = 'message-bubble message-out msg-sending'; b.textContent = txt;
                            r.appendChild(b); body.appendChild(r);
                            requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
                            const s2 = box.querySelector('.conv-sub');
                            if (s2) s2.textContent = new Date().toLocaleString() + ' \u2014 You: ' + (txt.length > 40 ? txt.slice(0, 40) + '...' : txt);
                            input.value = ''; input.focus();
                            if (socket && socket.connected) {
                                socket.emit('private-message', { recipientUid: fromUid, text: txt });
                            }
                            setTimeout(() => { try { b.classList.remove('msg-sending'); } catch (_) { } }, 1500);
                        } catch (e) { console.warn('Send failed', e); }
                    };
                    send.addEventListener('click', doSend);
                    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
                }

                box.appendChild(header); box.appendChild(body); box.appendChild(footer);
                ml.insertBefore(box, ml.firstChild);
                _renderedPartnerBoxes.set(fromUid, box);
                requestAnimationFrame(() => { box.classList.remove('conv-box-enter'); });

                // Also try to fetch the real profile name/photo in background
                try {
                    const auth = window._firebaseAuth;
                    if (auth && auth.currentUser) {
                        auth.currentUser.getIdToken().then(token => {
                            fetch('/api/user-profile/' + fromUid, { headers: { Authorization: 'Bearer ' + token } })
                                .then(r => r.ok ? r.json() : null)
                                .then(p => {
                                    if (p) {
                                        if (p.displayName) title.textContent = p.displayName;
                                        if (p.photoURL) {
                                            avatar.innerHTML = '';
                                            const im = document.createElement('img');
                                            im.src = p.photoURL; im.referrerPolicy = 'no-referrer'; im.crossOrigin = 'anonymous';
                                            im.style.width = '100%'; im.style.height = '100%'; im.style.objectFit = 'cover';
                                            avatar.appendChild(im);
                                        }
                                    }
                                }).catch(() => { });
                        }).catch(() => { });
                    }
                } catch (_) { }
            }
        } catch (e) { console.error('private-message-received handler failed', e); }
    });

    // Message successfully sent — remove sending indicators
    socket.on('message-sent', (payload) => {
        try {
            console.log('Message sent successfully');
            document.querySelectorAll('.msg-sending').forEach(el => el.classList.remove('msg-sending'));
        } catch (e) { /* ignore */ }
    });

    // Message error — mark failed messages
    socket.on('message-error', (payload) => {
        try {
            const msg = (payload && payload.message) || 'Failed to send message';
            showToast(msg);
            document.querySelectorAll('.msg-sending').forEach(el => {
                el.classList.remove('msg-sending');
                el.classList.add('msg-failed');
            });
        } catch (e) { /* ignore */ }
    });

    // Unban error — re-enable pay buttons
    socket.on('unban-error', (payload) => {
        try {
            const msg = (payload && payload.message) || 'Unban failed';
            showToast(msg);
            if (payUnbanBtn) { payUnbanBtn.disabled = false; payUnbanBtn.textContent = 'Pay & Restore Access'; }
            if (tempBanPayBtn) { tempBanPayBtn.disabled = false; tempBanPayBtn.textContent = 'Pay $7.99 & Restore Access'; }
        } catch (e) { /* ignore */ }
    });

    // Clear history confirmation from server
    socket.on('history-cleared', () => {
        try {
            console.log('History cleared successfully');
            renderHistoryList();
            showToast('History cleared');
            if (clearHistoryBtn) clearHistoryBtn.disabled = true;
        } catch (e) { console.error('history-cleared handler failed', e); }
    });

    // Clear history error from server
    socket.on('history-error', (payload) => {
        try {
            const msg = (payload && payload.message) || 'Failed to clear history';
            showToast(msg);
        } catch (e) { /* ignore */ }
    });
}

function cleanupAfterPartnerLeft() {
    try { if (pc) pc.close(); } catch (e) { }
    pc = null;
    currentPartner = null;
    currentRoomId = null;
    remoteVideo.srcObject = null;
    // disable chat UI when no partner is connected
    try { chatSend.disabled = true; } catch (e) { }
    try { chatInput.disabled = true; } catch (e) { }
}

function clearChat() {
    try {
        if (!chatLog) return;
        // remove all message children but preserve the chatStatus element
        Array.from(chatLog.children).forEach(child => {
            if (child !== chatStatus) chatLog.removeChild(child);
        });
        if (chatStatus) chatStatus.style.display = 'block';
        // Clear mobile floating messages
        const timeline = document.getElementById('mobileMsgTimeline');
        if (timeline) timeline.innerHTML = '';
        // Remove stored live-chat messages so they don't appear in history Messages tab
        try { localStorage.removeItem('vchat_messages'); } catch (e) { }
    } catch (e) { console.warn('clearChat failed', e); }
}

function appendChatMessage(who, text) {
    console.log('[CHAT-DEBUG] appendChatMessage called:', who, text);
    console.log('[CHAT-DEBUG] chatLog element:', chatLog, 'display:', chatLog ? getComputedStyle(chatLog).display : 'N/A', 'height:', chatLog ? chatLog.offsetHeight : 'N/A');
    const div = document.createElement("div");
    div.style.marginBottom = "6px";

    if (who === "me") {
        div.style.textAlign = "right";
        div.innerHTML = `<small style="color:#888">me</small><div style="display:inline-block;background:#e6f7ff;padding:6px 10px;border-radius:8px;max-width:80%;word-wrap:break-word;word-break:break-word;text-align:left;">${escapeHtml(text)}</div>`;
    } else {
        div.style.textAlign = "left";
        div.innerHTML = `<small style="color:#888">other</small><div style="display:inline-block;background:#f1f1f1;padding:6px 10px;border-radius:8px;max-width:80%;word-wrap:break-word;word-break:break-word;text-align:left;">${escapeHtml(text)}</div>`;
    }

    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;

    // On mobile: add bubble to the floating timeline
    if (window.matchMedia('(max-width: 600px) and (pointer: coarse)').matches) {
        // Create timeline container if it doesn't exist
        let timeline = document.getElementById('mobileMsgTimeline');
        if (!timeline) {
            timeline = document.createElement('div');
            timeline.id = 'mobileMsgTimeline';
            timeline.className = 'mobile-msg-timeline';
            document.body.appendChild(timeline);
        }
        const bubble = document.createElement('div');
        bubble.className = 'msg-bubble ' + (who === 'me' ? 'msg-sent' : 'msg-received');
        bubble.textContent = text;
        timeline.appendChild(bubble);
        // Auto-scroll to latest message
        timeline.scrollTop = timeline.scrollHeight;
    }
}

// Messages persistence
function loadMessages() {
    try {
        const raw = localStorage.getItem('vchat_messages');
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function saveMessages(arr) {
    try { localStorage.setItem('vchat_messages', JSON.stringify(arr)); } catch (e) { }
}

function addMessageEntry(entry) {
    try {
        const arr = loadMessages();
        arr.unshift(entry);
        if (arr.length > 500) arr.length = 500;
        saveMessages(arr);
    } catch (e) { console.warn('addMessageEntry failed', e); }
}

let _msgSendCooldown = 0; // timestamp when cooldown expires
let _renderedPartnerBoxes = new Map(); // partnerUid -> DOM element cache
async function renderMessagesList(force) {
    // Skip re-render during send cooldown unless forced
    if (!force && _msgSendCooldown > Date.now()) return;
    const list = document.getElementById('messageList');
    if (!list) return;

    // Only show loading if list is empty (first load)
    if (!list.querySelector('.conv-box')) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:#4b6a86;">Loading messages...</div>';
    }

    try {
        const user = window._firebaseAuth ? window._firebaseAuth.currentUser : null;
        if (!user) {
            list.innerHTML = '<div class="history-empty"><div class="history-empty-text">Not logged in</div></div>';
            return;
        }

        const uid = user.uid;
        const db = window._firebaseDb;

        // Query conversations where current user is a participant
        const conversationsRef = collection(db, 'conversations');
        const convQuery = query(conversationsRef, where('participants', 'array-contains', uid));
        const convSnapshot = await getDocs(convQuery);

        // Sort client-side by startedAt descending (avoids needing a composite index)
        const sortedDocs = convSnapshot.docs.slice().sort((a, b) => {
            const aTime = a.data().startedAt ? (a.data().startedAt.toDate ? a.data().startedAt.toDate().getTime() : a.data().startedAt) : 0;
            const bTime = b.data().startedAt ? (b.data().startedAt.toDate ? b.data().startedAt.toDate().getTime() : b.data().startedAt) : 0;
            return bTime - aTime;
        });

        if (convSnapshot.empty) {
            list.innerHTML = '<div class="history-empty"><div class="history-empty-icon">💬</div><div class="history-empty-text">No messages yet</div><div style="font-size:12px;color:#94a8c0;">Send a message from your connections to start</div></div>';
            return;
        }

        // Dynamically import doc-level Firestore helpers
        const { doc: fbDocFn, getDoc: fbGetDocFn } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");

        // Don't nuke existing boxes — track what's current and diff
        const existingBoxes = list.querySelectorAll('.conv-box');
        const _openPartners = new Set();
        const _openFooters = new Set();
        existingBoxes.forEach(b => {
            const puid = b.getAttribute('data-partner-uid');
            if (puid) {
                const body = b.querySelector('.conv-body');
                if (body && body.classList.contains('open')) _openPartners.add(puid);
                const footer = b.querySelector('.conv-footer');
                if (footer && footer.style.display !== 'none') _openFooters.add(puid);
            }
        });
        // Remove loading indicator
        const loadingEl = list.querySelector('div[style*="text-align:center"]');
        if (loadingEl && !loadingEl.classList.contains('conv-box')) loadingEl.remove();
        // Remove empty state if present
        const emptyEl = list.querySelector('.history-empty');
        if (emptyEl) emptyEl.remove();
        let hasMessages = false;

        // ── Group conversations by partner UID ──
        const partnerGroups = new Map(); // partnerUid -> { convIds, msgs, displayName, photoURL, latestConvId }
        for (const convDoc of sortedDocs) {
            const convData = convDoc.data();
            const conversationId = convDoc.id;
            const participants = convData.participants || [];
            const deletedFor = convData.deletedFor || {};

            const deleteMarker = deletedFor[uid];
            let deleteCutoff = null;
            if (deleteMarker === true) continue;
            if (deleteMarker && deleteMarker.toDate) {
                deleteCutoff = deleteMarker.toDate().getTime();
            } else if (deleteMarker && typeof deleteMarker === 'object' && deleteMarker.seconds) {
                deleteCutoff = deleteMarker.seconds * 1000;
            }

            const partnerUid = participants.find(p => p !== uid);
            if (!partnerUid) continue;

            let msgsSnapshot = { empty: true, docs: [] };
            try {
                const msgsRef = collection(db, 'conversations', conversationId, 'messages');
                const msgsQuery = query(msgsRef, orderBy('createdAt', 'asc'));
                msgsSnapshot = await getDocs(msgsQuery);
            } catch (e) { console.warn('Error fetching messages for', conversationId, e); }
            if (msgsSnapshot.empty) continue;

            const msgs = msgsSnapshot.docs.map(md => {
                const mData = md.data();
                let ts = Date.now();
                if (mData.createdAt) { ts = mData.createdAt.toDate ? mData.createdAt.toDate().getTime() : mData.createdAt; }
                const senderUid = mData.senderId || mData.sender || mData.fromUid;
                return { text: mData.text || '', fromUid: senderUid, direction: senderUid === uid ? 'out' : 'in', when: ts };
            }).filter(m => !deleteCutoff || m.when > deleteCutoff);
            if (msgs.length === 0) continue;

            if (!partnerGroups.has(partnerUid)) {
                // Get partner profile from conversation's participantProfiles
                let displayName = 'User', photoURL = null;
                const participantProfiles = convData.participantProfiles || {};
                if (participantProfiles[partnerUid]) {
                    displayName = participantProfiles[partnerUid].displayName || 'User';
                    photoURL = participantProfiles[partnerUid].photoURL || null;
                }
                // Fallback: fetch from server API if no photo available
                if (!photoURL) {
                    try {
                        const auth = window._firebaseAuth;
                        if (auth && auth.currentUser) {
                            const token = await auth.currentUser.getIdToken();
                            const profileRes = await fetch('/api/user-profile/' + partnerUid, {
                                headers: { Authorization: 'Bearer ' + token }
                            });
                            if (profileRes.ok) {
                                const profileData = await profileRes.json();
                                if (profileData.photoURL) photoURL = profileData.photoURL;
                                if (profileData.displayName && displayName === 'User') displayName = profileData.displayName;
                            }
                        }
                    } catch (_) { /* best-effort */ }
                }
                partnerGroups.set(partnerUid, { convIds: [], msgs: [], displayName, photoURL, latestConvId: conversationId });
            }
            const group = partnerGroups.get(partnerUid);
            group.convIds.push(conversationId);
            group.msgs.push(...msgs);
            // Track the conversation with the most recent message for sending
            const lastMsg = msgs[msgs.length - 1];
            const existingLast = group.msgs.length > msgs.length ? group.msgs[group.msgs.length - msgs.length - 1] : null;
            const lmTime = convData.lastMessageAt ? (convData.lastMessageAt.toMillis ? convData.lastMessageAt.toMillis() : 0) : 0;
            if (!group._latestTime || lmTime > group._latestTime) {
                group._latestTime = lmTime;
                group.latestConvId = conversationId;
            }
        }

        // ── Render one box per partner ──
        for (const [partnerUid, group] of partnerGroups) {
            const finalMsgs = group.msgs.sort((a, b) => a.when - b.when);
            const conversationId = group.latestConvId;
            const displayName = group.displayName;
            const photoURL = group.photoURL;
            hasMessages = true;

            // Check if a box for this partner already exists in the DOM
            const existingBox = list.querySelector('.conv-box[data-partner-uid="' + partnerUid + '"]')
                || list.querySelector('.conv-box[data-partner-id="' + partnerUid + '"]');
            if (existingBox) {
                // Ensure data-partner-uid is set for future lookups
                if (!existingBox.getAttribute('data-partner-uid')) existingBox.setAttribute('data-partner-uid', partnerUid);
                // Update subtitle
                const existSub = existingBox.querySelector('.conv-sub');
                const last = finalMsgs[finalMsgs.length - 1];
                if (existSub && last) {
                    existSub.textContent = new Date(last.when).toLocaleString() + ' \u2014 ' + (last.direction === 'out' ? 'You: ' : '') + (last.text.length > 40 ? last.text.slice(0, 40) + '...' : last.text);
                }
                // Also update the body with any new messages
                const existBody = existingBox.querySelector('.conv-body');
                if (existBody) {
                    const currentBubbleCount = existBody.querySelectorAll('.msg-row').length;
                    if (finalMsgs.length > currentBubbleCount) {
                        // Append only the NEW messages (ones not yet in the DOM)
                        const newMsgs = finalMsgs.slice(currentBubbleCount);
                        newMsgs.forEach(m => {
                            const row = document.createElement('div');
                            row.className = 'msg-row ' + (m.direction === 'out' ? 'msg-row-out' : 'msg-row-in');
                            const bubble = document.createElement('div');
                            bubble.className = 'message-bubble ' + (m.direction === 'out' ? 'message-out' : 'message-in');
                            bubble.textContent = m.text;
                            row.appendChild(bubble);
                            existBody.appendChild(row);
                        });
                        if (existBody.classList.contains('open')) {
                            requestAnimationFrame(() => { existBody.scrollTop = existBody.scrollHeight; });
                        }
                    }
                }
                _renderedPartnerBoxes.set(partnerUid, existingBox);
                continue; // skip rebuilding
            }

            // Build NEW conversation box UI
            const box = document.createElement('div'); box.className = 'conv-box conv-box-enter'; box.setAttribute('data-partner-uid', partnerUid);
            const header = document.createElement('div'); header.className = 'conv-header';
            const avatar = document.createElement('div'); avatar.className = 'conv-avatar';
            if (photoURL) { const im = document.createElement('img'); im.src = photoURL; im.referrerPolicy = 'no-referrer'; im.crossOrigin = 'anonymous'; im.style.width = '100%'; im.style.height = '100%'; im.style.objectFit = 'cover'; im.onerror = function () { this.style.display = 'none'; }; avatar.appendChild(im); }
            else { avatar.innerHTML = '<svg width="32" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#eef7ff"/><path d="M12 12c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3z" fill="#cfeeff"/></svg>'; }

            const titleWrap = document.createElement('div');
            titleWrap.style.flex = '1'; titleWrap.style.minWidth = '0';
            const title = document.createElement('div'); title.className = 'conv-title';
            title.textContent = displayName;
            const sub = document.createElement('div'); sub.className = 'conv-sub';
            const last = finalMsgs[finalMsgs.length - 1];
            sub.textContent = (last ? (new Date(last.when).toLocaleString() + ' \u2014 ' + (last.direction === 'out' ? 'You: ' : '') + (last.text.length > 40 ? last.text.slice(0, 40) + '...' : last.text)) : '');
            titleWrap.appendChild(title); titleWrap.appendChild(sub);

            header.appendChild(avatar); header.appendChild(titleWrap);

            // more button (delete conversation messages)
            const moreBtn = document.createElement('button');
            moreBtn.className = 'more-btn';
            moreBtn.title = 'Delete conversation';
            moreBtn.textContent = '\u22ee';
            moreBtn.style.marginLeft = 'auto';
            moreBtn.style.marginRight = '0';
            ((allConvIds) => {
                moreBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openConfirmDeleteModal(
                        'Delete conversation',
                        'Delete this conversation and its messages?',
                        async () => {
                            try {
                                const user = window._firebaseAuth && window._firebaseAuth.currentUser;
                                if (!user) { showToast('Not logged in'); return; }
                                const { doc: fbDocFn, updateDoc: fbUpdateDocFn, serverTimestamp: fbServerTs } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
                                await Promise.all(allConvIds.map(cId =>
                                    fbUpdateDocFn(fbDocFn(window._firebaseDb, 'conversations', cId), { [`deletedFor.${user.uid}`]: fbServerTs() })
                                ));
                                showToast('Conversation deleted');
                                _renderedPartnerBoxes.delete(partnerUid);
                                box.classList.add('conv-box-exit');
                                setTimeout(() => { try { box.remove(); } catch (_) { } }, 250);
                                setTimeout(() => {
                                    const remaining = list.querySelectorAll('.conv-box');
                                    if (remaining.length === 0) {
                                        list.innerHTML = '<div class="history-empty"><div class="history-empty-icon">\ud83d\udcac</div><div class="history-empty-text">No messages yet</div><div style="font-size:12px;color:#94a8c0;">Send a message from your connections to start</div></div>';
                                    }
                                }, 260);
                            } catch (err) {
                                console.warn('delete conversation failed', err);
                                showToast('Failed to delete');
                            }
                        }
                    );
                });
            })(group.convIds);
            header.appendChild(moreBtn);

            const body = document.createElement('div'); body.className = 'conv-body';
            // Restore open state if it was open before
            if (_openPartners.has(partnerUid)) body.classList.add('open');
            // populate messages in body
            finalMsgs.forEach(m => {
                const row = document.createElement('div');
                row.className = 'msg-row ' + (m.direction === 'out' ? 'msg-row-out' : 'msg-row-in');
                const bubble = document.createElement('div'); bubble.className = 'message-bubble ' + (m.direction === 'out' ? 'message-out' : 'message-in');
                bubble.textContent = m.text;
                row.appendChild(bubble);
                body.appendChild(row);
            });

            const footer = document.createElement('div'); footer.className = 'conv-footer';
            footer.style.display = (_openPartners.has(partnerUid) || _openFooters.has(partnerUid)) ? '' : 'none';
            const input = document.createElement('input'); input.className = 'conv-input'; input.placeholder = 'Type a message...';
            const send = document.createElement('button'); send.className = 'conv-send'; send.textContent = 'Send';
            footer.appendChild(input); footer.appendChild(send);

            // header toggle — lazy-load messages from Firestore on first open
            header.addEventListener('click', async () => {
                const isOpen = body.classList.toggle('open');
                footer.style.display = isOpen ? '' : 'none';
                if (isOpen) {
                    // Lazy-load messages from Firestore if not yet loaded
                    if (!body.dataset.loaded && conversationId) {
                        try {
                            const db = window._firebaseDb;
                            const user = window._firebaseAuth && window._firebaseAuth.currentUser;
                            if (db && user) {
                                const msgsRef = collection(db, 'conversations', conversationId, 'messages');
                                const msgsQuery = query(msgsRef, orderBy('createdAt', 'asc'));
                                const snap = await getDocs(msgsQuery);
                                if (!snap.empty) {
                                    body.innerHTML = ''; // Clear any stale content
                                    snap.forEach(md => {
                                        const mData = md.data();
                                        const senderUid = mData.senderId || mData.sender || mData.fromUid;
                                        const dir = senderUid === user.uid ? 'out' : 'in';
                                        const row = document.createElement('div');
                                        row.className = 'msg-row ' + (dir === 'out' ? 'msg-row-out' : 'msg-row-in');
                                        const bubble = document.createElement('div');
                                        bubble.className = 'message-bubble ' + (dir === 'out' ? 'message-out' : 'message-in');
                                        bubble.textContent = mData.text || '';
                                        row.appendChild(bubble);
                                        body.appendChild(row);
                                    });
                                    body.dataset.loaded = 'true';
                                }
                            }
                        } catch (e) { console.warn('Lazy load messages failed', e); }
                    }
                    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
                }
            });

            // send handler \u2014 optimistic UI with Firestore listener suppression
            ((pUid, cId) => {
                const doSend = async () => {
                    const txt = (input.value || '').trim();
                    if (!txt) return;
                    try {
                        // Optimistic: append bubble immediately
                        _msgSendCooldown = Date.now() + 4000;
                        const row = document.createElement('div');
                        row.className = 'msg-row msg-row-out';
                        const bubble = document.createElement('div');
                        bubble.className = 'message-bubble message-out msg-sending';
                        bubble.textContent = txt;
                        row.appendChild(bubble);
                        body.appendChild(row);
                        requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
                        const sub2 = box.querySelector('.conv-sub');
                        if (sub2) sub2.textContent = new Date().toLocaleString() + ' \u2014 You: ' + (txt.length > 40 ? txt.slice(0, 40) + '...' : txt);
                        input.value = '';
                        input.focus();

                        if (socket && socket.connected) {
                            socket.emit('private-message', { recipientUid: pUid, text: txt });
                        } else {
                            const user = window._firebaseAuth && window._firebaseAuth.currentUser;
                            if (!user) { showToast('Not logged in'); return; }
                            const { addDoc, serverTimestamp: fbServerTs, doc: fbDocFn, updateDoc: fbUpdateDocFn } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
                            const msgsRef = collection(window._firebaseDb, 'conversations', cId, 'messages');
                            await addDoc(msgsRef, { senderId: user.uid, text: txt, createdAt: fbServerTs() });
                            await fbUpdateDocFn(fbDocFn(window._firebaseDb, 'conversations', cId), {
                                lastMessageAt: fbServerTs(),
                                lastMessageText: txt
                            });
                        }
                        setTimeout(() => { try { bubble.classList.remove('msg-sending'); } catch (_) { } }, 1500);
                    } catch (e) { console.warn('Send failed', e); showToast('Send failed'); }
                };
                send.addEventListener('click', doSend);
                input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });
            })(partnerUid, conversationId);

            box.appendChild(header);
            box.appendChild(body);
            box.appendChild(footer);
            list.appendChild(box);
            _renderedPartnerBoxes.set(partnerUid, box);
            requestAnimationFrame(() => { box.classList.remove('conv-box-enter'); });
        }

        if (!hasMessages) {
            list.innerHTML = '<div class="history-empty"><div class="history-empty-icon">💬</div><div class="history-empty-text">No messages yet</div><div style="font-size:12px;color:#94a8c0;">Send a message from your connections to start</div></div>';
        }
    } catch (err) {
        console.error('Error loading messages:', err);
        list.innerHTML = '<div class="history-empty"><div class="history-empty-text">Error loading messages</div></div>';
    }
}

function escapeHtml(s) {
    return (s + "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Real-time conversations listener — auto-refresh Messages tab when conversation docs change
function startConversationListener() {
    if (_convListenerUnsub) return; // already listening
    try {
        const user = window._firebaseAuth && window._firebaseAuth.currentUser;
        if (!user || !window._firebaseDb || !window.fbOnSnapshot) return;
        const db = window._firebaseDb;
        const convRef = collection(db, 'conversations');
        const q = query(convRef, where('participants', 'array-contains', user.uid));
        _convListenerUnsub = window.fbOnSnapshot(q, () => {
            // Always run — renderMessagesList safely appends new messages to existing boxes
            renderMessagesList();
        }, (err) => { console.warn('Conversation listener error:', err.message); });
    } catch (e) { console.warn('startConversationListener failed:', e.message); }
}

function stopConversationListener() {
    if (_convListenerUnsub) { _convListenerUnsub(); _convListenerUnsub = null; }
}

// Start listener when auth is ready
try {
    const _checkAuth = setInterval(() => {
        if (window._firebaseAuth && window._firebaseAuth.currentUser) {
            clearInterval(_checkAuth);
            startConversationListener();
        }
    }, 1000);
    // Stop checking after 30s
    setTimeout(() => clearInterval(_checkAuth), 30000);
} catch (e) { /* ignore */ }

chatSend.addEventListener("click", () => {
    const text = chatInput.value.trim();
    console.log('[CHAT-DEBUG] Send clicked, text:', JSON.stringify(text), 'socket:', !!socket, 'partner:', currentPartner);
    if (!text) return;
    if (!socket || !currentPartner) { alert('Not connected to a partner'); return; }
    appendChatMessage("me", text);
    socket.emit("chat", { text });
    console.log('[CHAT-DEBUG] emitted chat event to server');
    chatInput.value = "";

    // Message persistence is handled server-side in the 'chat' handler
    // (creates conversation doc + writes message atomically via Admin SDK)
});

chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
        e.preventDefault();
        chatSend.click();
    }
});

nextBtn.addEventListener("click", () => {
    if (nextBtn.disabled) return;
    // save this side of the connection if it lasted long enough
    try { finalizeConnectionAndSave(); } catch (e) { }
    cleanupAfterPartnerLeft();
    clearChat();
    try { if (chatStatus) { chatStatus.style.display = 'block'; chatStatus.textContent = 'Searching partner...'; } } catch (e) { }
    updateMobileStatusBadge('Searching partner...', true);
    try { const spinner = document.getElementById('partnerSpinner'); if (spinner) { spinner.style.top = 'calc(50% - 10px)'; spinner.style.display = 'block'; } } catch (e) { }
    try { showStarfield(); } catch (e) { }
    try { const small = document.getElementById('partnerLogoSmall'); if (small) small.style.opacity = '0.9'; } catch (e) { }
    try { if (chatStatusFlag) chatStatusFlag.textContent = ''; } catch (e) { }
    try { const cb = document.querySelector('.partner-country-badge'); if (cb) cb.remove(); } catch (e) { }
    try { const cb2 = document.getElementById('localVideo')?.parentElement?.querySelector('.partner-country-badge'); if (cb2) cb2.remove(); } catch (e) { }
    try { updateReportVisibility(); } catch (e) { }
    stText.textContent = "Searching for next...";
    socket.emit("set-preferences", getPreferences());
    socket.emit("next");
    nextBtn.disabled = true;
    setTimeout(() => { nextBtn.disabled = false; }, 2000);
});

// History: local tracking and modal
let partnerConnectedAt = null;

function loadHistory() {
    try {
        const raw = localStorage.getItem('vchat_history');
        return raw ? JSON.parse(raw) : [];
    } catch (e) { return []; }
}

function saveHistory(arr) {
    try { localStorage.setItem('vchat_history', JSON.stringify(arr)); } catch (e) { }
}

function addHistoryEntry(entry) {
    try {
        // enrich with any known partner profile
        if (entry && entry.id && partnerProfiles[entry.id]) {
            const p = partnerProfiles[entry.id];
            if (!entry.pic && p.pic) entry.pic = p.pic;
            if (!entry.name && p.name) entry.name = p.name;
        }
    } catch (e) { }
    const arr = loadHistory();
    arr.unshift(entry);
    // keep recent 100
    if (arr.length > 100) arr.length = 100;
    saveHistory(arr);
}

function formatDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return m + 'm ' + rem + 's';
}

// Render conversations from Firestore (qualified connections)
async function renderHistoryList() {
    const list = document.getElementById('historyList');
    if (!list) return;
    list.innerHTML = '\u003cdiv style="text-align:center;padding:20px;color:#4b6a86;"\u003eLoading...\u003c/div\u003e';

    try {
        const user = window._firebaseAuth ? window._firebaseAuth.currentUser : null;
        if (!user) {
            list.innerHTML = '\u003cdiv class="history-empty"\u003e\u003cdiv class="history-empty-text"\u003eNot logged in\u003c/div\u003e\u003c/div\u003e';
            return;
        }

        const uid = user.uid;

        // Query conversations where current user is a participant
        const conversationsRef = collection(window._firebaseDb, 'conversations');
        const q = query(
            conversationsRef,
            where('participants', 'array-contains', uid),
            orderBy('startedAt', 'desc')
        );

        const snapshot = await getDocs(q);

        if (snapshot.empty) {
            list.innerHTML = '\u003cdiv class="history-empty"\u003e\u003cdiv class="history-empty-icon"\u003e🤝\u003c/div\u003e\u003cdiv class="history-empty-text"\u003eNo connections yet\u003c/div\u003e\u003cdiv style="font-size:12px;color:#94a8c0;"\u003eStay connected for 10+ seconds to save\u003c/div\u003e\u003c/div\u003e';
            return;
        }

        list.innerHTML = '';

        for (const docSnap of snapshot.docs) {
            const data = docSnap.data();
            const conversationId = docSnap.id;
            const participants = data.participants || [];
            const participantProfiles = data.participantProfiles || {};
            const historyDeleted = data.historyDeletedFor || {};

            // Skip if connection history is cleared for current user
            if (historyDeleted[uid]) continue;

            // Find partner UID
            const partnerUid = participants.find(p => p !== uid);
            if (!partnerUid) continue;

            // Use partner profile from conversation doc (reading other users' docs is restricted by rules)
            let displayName = 'User';
            let photoURL = null;

            if (participantProfiles[partnerUid]) {
                displayName = participantProfiles[partnerUid].displayName || 'User';
                photoURL = participantProfiles[partnerUid].photoURL || null;
            } else {
                // Fallback: try reading partner doc (may fail if rules restrict it)
                try {
                    const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
                    const partnerRef = doc(window._firebaseDb, 'users', partnerUid);
                    const partnerSnap = await getDoc(partnerRef);
                    if (partnerSnap.exists()) {
                        const partnerData = partnerSnap.data();
                        displayName = partnerData.displayName || 'User';
                        photoURL = partnerData.photoURL || null;
                    }
                } catch (e) { /* permission denied — use defaults */ }
            }

            const durationSeconds = data.durationSeconds || 0;
            const startedAt = data.startedAt ? data.startedAt.toDate() : new Date();

            // Create history item UI
            const item = document.createElement('div');
            item.className = 'history-item';

            const avatar = document.createElement('div');
            avatar.className = 'history-avatar';
            if (photoURL) {
                const img = document.createElement('img');
                img.src = photoURL;
                img.alt = 'pic';
                avatar.appendChild(img);
            } else {
                avatar.innerHTML = '\u003csvg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"\u003e\u003ccircle cx="12" cy="9" r="3.5" fill="#93c5fd"/\u003e\u003cpath d="M5 20c0-3.866 3.134-7 7-7s7 3.134 7 7" fill="#bfdbfe"/\u003e\u003c/svg\u003e';
            }

            const meta = document.createElement('div');
            meta.className = 'history-meta';
            const name = document.createElement('div');
            name.className = 'history-name';
            name.textContent = displayName;
            const dur = document.createElement('div');
            dur.className = 'history-duration';
            dur.textContent = '⏱ ' + formatDuration(durationSeconds * 1000) + '  •  ' + startedAt.toLocaleString();
            meta.appendChild(name);
            meta.appendChild(dur);

            const actions = document.createElement('div');
            actions.className = 'history-actions';
            const textBtn = document.createElement('button');
            textBtn.className = 'btn-text';
            textBtn.textContent = 'Text';

            // Create inline chat box (hidden by default) — simple input only
            const chatBox = document.createElement('div');
            chatBox.style.display = 'none';
            chatBox.style.marginTop = '8px';
            chatBox.style.width = '100%';
            chatBox.dataset.partnerUid = partnerUid;

            const chatBoxInput = document.createElement('input');
            chatBoxInput.type = 'text';
            chatBoxInput.placeholder = 'Send a message...';
            chatBoxInput.style.padding = '8px 10px';
            chatBoxInput.style.borderRadius = '8px';
            chatBoxInput.style.border = '1px solid rgba(3,102,214,0.06)';
            chatBoxInput.style.flex = '1';
            chatBoxInput.style.minWidth = '0';
            chatBoxInput.style.fontSize = '13px';
            const chatBoxSend = document.createElement('button');
            chatBoxSend.className = 'btn-text';
            chatBoxSend.textContent = 'Send';
            chatBoxSend.style.padding = '8px 10px';
            chatBoxSend.style.marginLeft = '6px';
            chatBox.appendChild(chatBoxInput);
            chatBox.appendChild(chatBoxSend);

            // Text button click - toggle chat box
            textBtn.addEventListener('click', () => {
                if (chatBox.style.display === 'none' || !chatBox.style.display) {
                    chatBox.style.display = 'flex';
                    textBtn.style.display = 'none';
                    chatBoxInput.focus();
                } else {
                    chatBox.style.display = 'none';
                    textBtn.style.display = '';
                }
            });

            // Enter key sends message
            chatBoxInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); chatBoxSend.click(); }
            });

            // Send button click — send message, close chatbox, show ack
            ((cPartnerUid, cConvId) => {
                chatBoxSend.addEventListener('click', async () => {
                    const txt = (chatBoxInput.value || '').trim();
                    if (!txt) return;

                    try {
                        _msgSendCooldown = Date.now() + 4000;

                        if (socket && socket.connected) {
                            socket.emit('private-message', {
                                recipientUid: cPartnerUid,
                                text: txt
                            });
                        } else {
                            const user = window._firebaseAuth && window._firebaseAuth.currentUser;
                            if (!user) { showToast('Not logged in'); return; }
                            const { addDoc, serverTimestamp: fbServerTs, doc: fbDocFn, updateDoc: fbUpdateDocFn } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
                            const msgsRef = collection(window._firebaseDb, 'conversations', cConvId, 'messages');
                            await addDoc(msgsRef, { senderId: user.uid, text: txt, createdAt: fbServerTs() });
                            await fbUpdateDocFn(fbDocFn(window._firebaseDb, 'conversations', cConvId), {
                                lastMessageAt: fbServerTs(),
                                lastMessageText: txt
                            });
                        }

                        // Clear input and close chatbox
                        chatBoxInput.value = '';
                        chatBox.style.display = 'none';
                        textBtn.style.display = '';

                        // Show brief sent ack
                        const ack = document.createElement('div');
                        ack.style.fontSize = '12px';
                        ack.style.color = '#0b4f8a';
                        ack.textContent = '\u2714 Sent';
                        actions.appendChild(ack);
                        setTimeout(() => { try { actions.removeChild(ack); } catch (_) { } }, 2000);
                    } catch (e) {
                        console.error('Send message failed', e);
                        showToast('Send failed');
                    }
                });
            })(partnerUid, conversationId);

            actions.appendChild(textBtn);

            item.appendChild(avatar);
            item.appendChild(meta);
            item.appendChild(actions);
            item.appendChild(chatBox);
            list.appendChild(item);
        }
    } catch (err) {
        console.error('Error loading conversations:', err);
        list.innerHTML = '\u003cdiv class="history-empty"\u003e\u003cdiv class="history-empty-text"\u003eError loading history\u003c/div\u003e\u003c/div\u003e';
    }
}

let historyModalOpener = null;

function openHistoryModal() {
    const m = document.getElementById('historyModal');
    if (!m) return;

    // Store the element that opened the modal
    historyModalOpener = document.activeElement;

    renderHistoryList();
    // default to Connections tab
    const hc = document.getElementById('historyTabConnections');
    const hm = document.getElementById('historyTabMessages');
    if (hc && hm) {
        hc.classList.add('history-tab-active');
        hm.classList.remove('history-tab-active');
        document.getElementById('historyList').style.display = 'block';
        document.getElementById('messageList').style.display = 'none';
    }
    // enable/disable clear button depending on whether there's history
    try {
        const clearBtn = document.getElementById('clearHistoryBtn');
        if (clearBtn) {
            const arr = loadHistory();
            clearBtn.disabled = !arr || arr.length === 0;
        }
    } catch (e) { }

    m.style.display = 'flex';
    m.setAttribute('aria-hidden', 'false');

    // Focus first focusable element in modal
    setTimeout(() => {
        const focusable = m.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length > 0) focusable[0].focus();
    }, 100);
}

function closeHistoryModal() {
    const m = document.getElementById('historyModal');
    if (!m) return;

    // Blur any focused element inside modal before hiding
    if (m.contains(document.activeElement)) {
        document.activeElement.blur();
    }

    m.style.display = 'none';
    m.setAttribute('aria-hidden', 'true');

    // Restore focus to the element that opened the modal
    if (historyModalOpener && historyModalOpener.focus) {
        historyModalOpener.focus();
        historyModalOpener = null;
    } else {
        document.body.focus();
    }
}

if (historyBtn) historyBtn.addEventListener('click', openHistoryModal);
const closeHistoryBtn = document.getElementById('closeHistoryBtn');
if (closeHistoryBtn) closeHistoryBtn.addEventListener('click', closeHistoryModal);

// Clear history button + confirm handlers
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const clearHistoryConfirm = document.getElementById('clearHistoryConfirm');
const clearHistoryConfirmBtn = document.getElementById('clearHistoryConfirmBtn');
const clearHistoryCancelBtn = document.getElementById('clearHistoryCancelBtn');

function openClearHistoryConfirm() {
    if (!clearHistoryConfirm) return;
    clearHistoryConfirm.style.display = 'flex';
    clearHistoryConfirm.setAttribute('aria-hidden', 'false');
}

function closeClearHistoryConfirm() {
    if (!clearHistoryConfirm) return;

    // Blur any focused element inside modal before hiding
    if (clearHistoryConfirm.contains(document.activeElement)) {
        document.activeElement.blur();
    }

    clearHistoryConfirm.style.display = 'none';
    clearHistoryConfirm.setAttribute('aria-hidden', 'true');

    // Return focus to body
    document.body.focus();
}

async function doClearHistory() {
    try {
        const user = window._firebaseAuth ? window._firebaseAuth.currentUser : null;
        if (!user) { showToast('Not logged in'); closeClearHistoryConfirm(); return; }
        const db = window._firebaseDb;
        if (!db) { showToast('Database not ready'); closeClearHistoryConfirm(); return; }

        // Soft-delete connections only (separate field from Messages' deletedFor)
        const { doc: fbDocFn, updateDoc: fbUpdateDocFn, serverTimestamp: fbServerTs } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
        const conversationsRef = collection(db, 'conversations');
        const q = query(conversationsRef, where('participants', 'array-contains', user.uid));
        const snap = await getDocs(q);
        const promises = snap.docs.map(d =>
            fbUpdateDocFn(fbDocFn(db, 'conversations', d.id), { [`historyDeletedFor.${user.uid}`]: true })
        );
        await Promise.all(promises);

        // Also clear localStorage connections
        try { localStorage.removeItem('chatHistory'); } catch (e) { }

        showToast('History cleared');
        closeClearHistoryConfirm();
        renderHistoryList();
    } catch (e) {
        console.error('Clear history request failed', e);
        showToast('Failed to clear history');
        closeClearHistoryConfirm();
    }
}

if (clearHistoryBtn) clearHistoryBtn.addEventListener('click', openClearHistoryConfirm);
if (clearHistoryConfirmBtn) clearHistoryConfirmBtn.addEventListener('click', doClearHistory);
if (clearHistoryCancelBtn) clearHistoryCancelBtn.addEventListener('click', closeClearHistoryConfirm);
if (clearHistoryConfirm) {
    clearHistoryConfirm.addEventListener('click', (e) => { if (e.target === clearHistoryConfirm) closeClearHistoryConfirm(); });
}

// tab switching for history/messages
const historyTabConnections = document.getElementById('historyTabConnections');
const historyTabMessages = document.getElementById('historyTabMessages');
if (historyTabConnections && historyTabMessages) {
    historyTabConnections.addEventListener('click', () => {
        historyTabConnections.classList.add('active');
        historyTabMessages.classList.remove('active');
        document.getElementById('historyList').style.display = 'flex';
        document.getElementById('messageList').style.display = 'none';
        try {
            if (clearHistoryBtn) {
                // show and enable/disable based on stored history
                clearHistoryBtn.style.display = '';
                const arr = loadHistory();
                clearHistoryBtn.disabled = !arr || arr.length === 0;
            }
        } catch (e) { }
    });
    historyTabMessages.addEventListener('click', () => {
        historyTabMessages.classList.add('active');
        historyTabConnections.classList.remove('active');
        document.getElementById('historyList').style.display = 'none';
        document.getElementById('messageList').style.display = 'flex';
        try { if (clearHistoryBtn) clearHistoryBtn.style.display = 'none'; } catch (e) { }
        renderMessagesList();
    });
}

// Ensure both peers save history: finalize on unload and when local user ends the session
function finalizeConnectionAndSave() {
    try {
        if (partnerConnectedAt && currentPartner) {
            const dur = Date.now() - partnerConnectedAt;
            if (dur >= 10000) {
                addHistoryEntry({ id: currentPartner, when: Date.now(), duration: dur });
            }
        }
    } catch (e) { console.warn('finalize history failed', e); }
    partnerConnectedAt = null;
}

window.addEventListener('beforeunload', finalizeConnectionAndSave, { passive: true });
window.addEventListener('pagehide', finalizeConnectionAndSave, { passive: true });


/* Settings submenu popup */
const settingsMenu = document.getElementById('settingsMenu');
function openSettingsMenu() {
    if (!settingsMenu) return;
    settingsMenu.style.display = 'flex';
    settingsMenu.setAttribute('aria-hidden', 'false');
    // position near button
    const r = settingsBtn.getBoundingClientRect();
    settingsMenu.style.right = (window.innerWidth - r.right) + 'px';
    settingsMenu.style.bottom = (window.innerHeight - r.top + 8) + 'px';
}
function closeSettingsMenu() {
    if (!settingsMenu) return;
    settingsMenu.style.display = 'none';
    settingsMenu.setAttribute('aria-hidden', 'true');
}

if (settingsBtn) {
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!settingsMenu) return;
        if (settingsMenu.getAttribute('aria-hidden') === 'true') openSettingsMenu();
        else closeSettingsMenu();
    });
}

// handle menu actions
if (settingsMenu) {
    settingsMenu.addEventListener('click', (e) => {
        const btn = e.target.closest('.settings-item');
        if (!btn) return;
        const action = btn.dataset.action;
        closeSettingsMenu();
        if (action === 'edit') {
            openEditProfileModal();
        } else if (action === 'about') {
            try { openAboutModal(); } catch (e) { alert('About Us not implemented.'); }
        }
        else if (action === 'membership') openMembershipModal();
        else if (action === 'contact') {
            try { openContactModal(); } catch (e) { try { window.open('mailto:omedash.help@gmail.com'); } catch (e2) { alert('Contact: omedash.help@gmail.com'); } }
        }
        else if (action === 'tos') {
            try { openTosModal(); } catch (e) { try { window.open('/tos', '_blank'); } catch (e2) { alert('Open Terms of Service'); } }
        }
        else if (action === 'privacy') {
            try { openPrivacyModal(); } catch (e) { try { window.open('/privacy', '_blank'); } catch (e2) { alert('Open Privacy Policy'); } }
        }
        else if (action === 'rules') {
            try { openRulesModal(); } catch (e) { try { window.open('/rules', '_blank'); } catch (e2) { alert('Open Rules'); } }
        }
        else if (action === 'logout') {
            // Disconnect socket and stop media
            try { if (socket) socket.disconnect(); } catch (e) { }
            try { if (localStream) localStream.getTracks().forEach(t => t.stop()); } catch (e) { }
            // Sign out from Firebase — onAuthStateChanged will show login screen
            if (window._firebaseSignOut) {
                window._firebaseSignOut().then(() => {
                    document.querySelectorAll('.app-hidden-initial').forEach(el => el.classList.add('app-hidden'));
                    location.reload();
                }).catch(err => {
                    console.error('Sign-out failed:', err);
                    location.reload();
                });
            } else {
                location.reload();
            }
        }
    });

    // close on outside click or escape
    document.addEventListener('click', (e) => {
        if (!settingsMenu) return;
        if (settingsMenu.getAttribute('aria-hidden') === 'true') return;
        const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
        if (e.target === settingsBtn || settingsMenu.contains(e.target)) return;
        if (mobileSettingsBtn && (e.target === mobileSettingsBtn || mobileSettingsBtn.contains(e.target))) return;
        closeSettingsMenu();
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeSettingsMenu();
    });
}

// --- Edit Profile modal logic ---
const editProfileModal = document.getElementById('editProfileModal');
const profilePreview = document.getElementById('profilePreview');
const profilePicInput = document.getElementById('profilePicInput');
const profileName = document.getElementById('profileName');
const saveProfileBtn = document.getElementById('saveProfileBtn');
const cancelProfileBtn = document.getElementById('cancelProfileBtn');
const removePicBtn = document.getElementById('removePicBtn');

let editProfileModalOpener = null;

function openEditProfileModal() {
    if (!editProfileModal) return;

    // Store the element that opened the modal
    editProfileModalOpener = document.activeElement;

    loadProfileFromStorage();
    editProfileModal.style.display = 'flex';
    editProfileModal.setAttribute('aria-hidden', 'false');

    // Focus first focusable element in modal
    setTimeout(() => {
        const focusable = editProfileModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length > 0) focusable[0].focus();
    }, 100);
}

function closeEditProfileModal() {
    if (!editProfileModal) return;

    // Blur any focused element inside modal before hiding
    if (editProfileModal.contains(document.activeElement)) {
        document.activeElement.blur();
    }

    editProfileModal.style.display = 'none';
    editProfileModal.setAttribute('aria-hidden', 'true');

    // Restore focus to the element that opened the modal
    if (editProfileModalOpener && editProfileModalOpener.focus) {
        editProfileModalOpener.focus();
        editProfileModalOpener = null;
    } else {
        document.body.focus();
    }
}

function loadProfileFromStorage() {
    const data = localStorage.getItem('vchat_profile');
    if (!data) {
        profilePreview.innerHTML = '<span>Preview</span>';
        if (profileName) profileName.value = '';
        if (removePicBtn) removePicBtn.style.display = 'none';
        return;
    }
    try {
        const obj = JSON.parse(data);
        if (obj.pic) {
            profilePreview.innerHTML = `<img src="${obj.pic}" alt="profile">`;
            profilePreview.dataset.current = obj.pic;
            if (removePicBtn) removePicBtn.style.display = '';
        } else {
            profilePreview.innerHTML = '<span>Preview</span>';
            profilePreview.removeAttribute('data-current');
            if (removePicBtn) removePicBtn.style.display = 'none';
        }
        if (profileName) profileName.value = obj.name || '';
    } catch (e) {
        console.error('bad profile data', e);
    }
}

function readFileAsDataURL(file) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(file);
    });
}

if (profilePicInput) {
    profilePicInput.addEventListener('change', async (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        try {
            const dataUrl = await readFileAsDataURL(f);
            profilePreview.innerHTML = `<img src="${dataUrl}" alt="profile">`;
            profilePreview.dataset.current = dataUrl;
            if (removePicBtn) removePicBtn.style.display = '';
        } catch (err) { console.error('preview failed', err); }
    });
}

if (removePicBtn) {
    removePicBtn.addEventListener('click', () => {
        profilePreview.innerHTML = '<span>Preview</span>';
        profilePreview.removeAttribute('data-current');
        if (profilePicInput) { profilePicInput.value = ''; }
        if (removePicBtn) removePicBtn.style.display = 'none';
    });
}

if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async () => {
        try {
            const user = window._firebaseAuth ? window._firebaseAuth.currentUser : null;
            if (!user) {
                showToast('Not logged in');
                return;
            }

            let picData = null;
            if (profilePicInput && profilePicInput.files && profilePicInput.files[0]) {
                try { picData = await readFileAsDataURL(profilePicInput.files[0]); } catch (e) { console.error(e); }
            } else {
                // if preview contains an <img> tag, keep that src
                const img = profilePreview.querySelector('img');
                if (img) picData = img.src;
            }

            const nameText = profileName ? profileName.value.trim() : '';
            const displayName = nameText || 'User';
            const photoURL = picData || null;

            console.log('Saving profile for UID:', user.uid);
            console.log('displayName:', displayName);
            console.log('photoURL:', photoURL ? 'Set' : 'null');

            // Save to Firestore users collection
            const { setDoc, doc, serverTimestamp, getDoc } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
            const userRef = doc(window._firebaseDb, 'users', user.uid);

            await setDoc(userRef, {
                displayName: displayName,
                photoURL: photoURL,
                updatedAt: serverTimestamp()
            }, { merge: true });

            console.log('✓ Profile saved to Firestore');

            // Verify the save by reading back
            const verifySnap = await getDoc(userRef);
            if (verifySnap.exists()) {
                const data = verifySnap.data();
                console.log('Verified displayName:', data.displayName);
                console.log('Verified photoURL:', data.photoURL);
            }

            // Also save to localStorage for backward compatibility
            try {
                localStorage.setItem('vchat_profile', JSON.stringify({
                    pic: picData,
                    name: nameText
                }));
            } catch (e) { console.error('localStorage save failed', e); }

            showToast('Profile saved');
            closeEditProfileModal();
        } catch (e) {
            console.error('Save profile failed:', e);
            showToast('Failed to save profile');
        }
    });
}

if (cancelProfileBtn) {
    cancelProfileBtn.addEventListener('click', () => {
        closeEditProfileModal();
    });
}

// click outside modal to close
if (editProfileModal) {
    editProfileModal.addEventListener('click', (e) => {
        if (e.target === editProfileModal) closeEditProfileModal();
    });
}

// --- Membership modal logic ---
const membershipModal = document.getElementById('membershipModal');
const closeMembershipBtn = document.getElementById('closeMembershipBtn');
const subscribeBtn = document.getElementById('subscribeBtn');

let membershipModalOpener = null;

function openMembershipModal() {
    if (!membershipModal) return;

    // Store the element that opened the modal
    membershipModalOpener = document.activeElement;

    membershipModal.style.display = 'flex';
    membershipModal.setAttribute('aria-hidden', 'false');

    // Focus first focusable element in modal
    setTimeout(() => {
        const focusable = membershipModal.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
        if (focusable.length > 0) focusable[0].focus();
    }, 100);
}

function closeMembershipModal() {
    if (!membershipModal) return;

    // Blur any focused element inside modal before hiding
    if (membershipModal.contains(document.activeElement)) {
        document.activeElement.blur();
    }

    membershipModal.style.display = 'none';
    membershipModal.setAttribute('aria-hidden', 'true');

    // Restore focus to the element that opened the modal
    if (membershipModalOpener && membershipModalOpener.focus) {
        membershipModalOpener.focus();
        membershipModalOpener = null;
    } else {
        document.body.focus();
    }
}

if (closeMembershipBtn) closeMembershipBtn.addEventListener('click', closeMembershipModal);
if (membershipModal) membershipModal.addEventListener('click', (e) => { if (e.target === membershipModal) closeMembershipModal(); });

if (subscribeBtn) {
    subscribeBtn.addEventListener('click', async () => {
        try {
            const user = window._firebaseAuth ? window._firebaseAuth.currentUser : null;
            if (!user) {
                console.error('User not authenticated');
                return;
            }
            const token = await user.getIdToken();
            const res = await fetch('/create-checkout-session', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`
                }
            });
            const data = await res.json();
            window.location.href = data.url;
        } catch (err) {
            console.error('Checkout session failed', err);
        }
    });
}

// Manage membership button (placeholder)
const manageMembershipBtn = document.getElementById('manageMembershipBtn');
if (manageMembershipBtn) {
    manageMembershipBtn.addEventListener('click', () => {
        alert('Manage membership (placeholder) — implement account management flow on server.');
    });
}

// Contact modal handlers
const contactModal = document.getElementById('contactModal');
const contactCloseBtn = document.getElementById('contactCloseBtn');
const contactMailBtn = document.getElementById('contactMailBtn');

function openContactModal() {
    if (!contactModal) return;
    contactModal.style.display = 'flex';
    contactModal.setAttribute('aria-hidden', 'false');
}

function closeContactModal() {
    if (!contactModal) return;
    contactModal.style.display = 'none';
    contactModal.setAttribute('aria-hidden', 'true');
}

if (contactCloseBtn) contactCloseBtn.addEventListener('click', closeContactModal);
if (contactMailBtn) contactMailBtn.addEventListener('click', () => {
    try { window.open('mailto:omedash.help@gmail.com'); } catch (e) { alert('Contact: omedash.help@gmail.com'); }
});
if (contactModal) contactModal.addEventListener('click', (e) => { if (e.target === contactModal) closeContactModal(); });

// ── Lazy-loaded modal helper ──
// Fetches HTML from data-src on first open and caches it.
// Attaches the close-button listener after injection.
const _modalCache = {};

function _openLazyModal(modalEl, closeFn) {
    if (!modalEl) return;
    const inner = modalEl.querySelector('.modal-content');
    const src = inner && inner.dataset.src;

    function show() {
        modalEl.style.display = 'flex';
        modalEl.setAttribute('aria-hidden', 'false');
    }

    if (src && !_modalCache[src]) {
        // First open – fetch and inject
        inner.innerHTML = '<p style="text-align:center;padding:2em;color:#94a3b8;">Loading…</p>';
        show();
        fetch(src)
            .then(function (r) { return r.ok ? r.text() : Promise.reject(r.status); })
            .then(function (html) {
                _modalCache[src] = html;
                inner.innerHTML = html;
                // Re-attach close button inside the injected content
                var closeBtn = inner.querySelector('.btn-ghost');
                if (closeBtn) closeBtn.addEventListener('click', closeFn);
            })
            .catch(function () { inner.innerHTML = '<p style="text-align:center;padding:2em;color:#f87171;">Failed to load content.</p>'; });
    } else if (src && _modalCache[src] && !inner.children.length) {
        // Cached but DOM was cleared (shouldn't happen, safety net)
        inner.innerHTML = _modalCache[src];
        var closeBtn = inner.querySelector('.btn-ghost');
        if (closeBtn) closeBtn.addEventListener('click', closeFn);
        show();
    } else {
        show();
    }
}

function _closeLazyModal(modalEl) {
    if (!modalEl) return;
    modalEl.style.display = 'none';
    modalEl.setAttribute('aria-hidden', 'true');
}

// Terms of Service modal handlers
const tosModal = document.getElementById('tosModal');
function openTosModal() { _openLazyModal(tosModal, closeTosModal); }
function closeTosModal() { _closeLazyModal(tosModal); }
if (tosModal) tosModal.addEventListener('click', function (e) { if (e.target === tosModal) closeTosModal(); });

// Privacy modal handlers
const privacyModal = document.getElementById('privacyModal');
function openPrivacyModal() { _openLazyModal(privacyModal, closePrivacyModal); }
function closePrivacyModal() { _closeLazyModal(privacyModal); }
if (privacyModal) privacyModal.addEventListener('click', function (e) { if (e.target === privacyModal) closePrivacyModal(); });

// Rules modal handlers
const rulesModal = document.getElementById('rulesModal');
function openRulesModal() { _openLazyModal(rulesModal, closeRulesModal); }
function closeRulesModal() { _closeLazyModal(rulesModal); }
if (rulesModal) rulesModal.addEventListener('click', function (e) { if (e.target === rulesModal) closeRulesModal(); });

// About modal handlers (inline – no lazy loading needed)
const aboutModal = document.getElementById('aboutModal');
const aboutCloseBtn = document.getElementById('aboutCloseBtn');

function openAboutModal() {
    if (!aboutModal) return;
    aboutModal.style.display = 'flex';
    aboutModal.setAttribute('aria-hidden', 'false');
}

function closeAboutModal() {
    if (!aboutModal) return;
    aboutModal.style.display = 'none';
    aboutModal.setAttribute('aria-hidden', 'true');
}

if (aboutCloseBtn) aboutCloseBtn.addEventListener('click', closeAboutModal);
if (aboutModal) aboutModal.addEventListener('click', function (e) { if (e.target === aboutModal) closeAboutModal(); });

// load preview on startup
try { loadProfileFromStorage(); } catch (e) { }

// Debounce to prevent double-toggle when window regains focus
let pauseBtnLastClick = 0;
pauseBtn.addEventListener("click", () => {
    const now = Date.now();
    if (now - pauseBtnLastClick < 300) return; // ignore clicks within 300ms
    pauseBtnLastClick = now;

    if (!isPaused) {
        try { finalizeConnectionAndSave(); } catch (e) { }
        cleanupAfterPartnerLeft();
        clearChat();
        socket.emit("pause");
        isPaused = true;
        pauseBtn.textContent = "▶ RESUME";
        pauseBtn.classList.remove('btn-pause');
        pauseBtn.classList.add('btn-resume');
        stText.textContent = "Paused — take a break";
        try { if (chatStatus) chatStatus.style.display = 'none'; } catch (e) { }
        updateMobileStatusBadge('', false);
        try { const spinner = document.getElementById('partnerSpinner'); if (spinner) spinner.style.display = 'none'; } catch (e) { }
        try { showStarfield(); } catch (e) { }
        try { const big = document.getElementById('partnerLogoBig'); if (big) big.style.display = 'block'; } catch (e) { }
        try { const small = document.getElementById('partnerLogoSmall'); if (small) small.style.display = 'none'; } catch (e) { }
        // Show mobile settings button when paused
        try { const mobileSettings = document.getElementById('mobileSettingsBtn'); if (mobileSettings && window.innerWidth <= 600) mobileSettings.style.display = 'flex'; } catch (e) { }
        try { if (chatStatusFlag) chatStatusFlag.textContent = ''; } catch (e) { }
        try { const cb = document.querySelector('.partner-country-badge'); if (cb) cb.remove(); } catch (e) { }
        try { const cb2 = document.getElementById('localVideo')?.parentElement?.querySelector('.partner-country-badge'); if (cb2) cb2.remove(); } catch (e) { }
        nextBtn.disabled = true;
        try { const mb = document.getElementById('mobileNextBtn'); if (mb) mb.disabled = true; } catch (e) { }
        if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = false);
        remoteVideo.muted = true;
        try { updateReportVisibility(); } catch (e) { }
    } else {
        socket.emit("set-preferences", getPreferences());
        socket.emit("resume");
        isPaused = false;
        pauseBtn.textContent = "■ STOP";
        pauseBtn.classList.remove('btn-resume');
        pauseBtn.classList.add('btn-pause');
        stText.textContent = "Searching for next...";
        try { if (chatStatus) { chatStatus.style.display = 'block'; chatStatus.textContent = 'Searching partner...'; } } catch (e) { }
        updateMobileStatusBadge('Searching partner...', true);
        try { const spinner = document.getElementById('partnerSpinner'); if (spinner) { spinner.style.top = 'calc(50% - 10px)'; spinner.style.display = 'block'; } } catch (e) { }
        try { showStarfield(); } catch (e) { }
        try { const big = document.getElementById('partnerLogoBig'); if (big) big.style.display = 'none'; } catch (e) { }
        try { const small = document.getElementById('partnerLogoSmall'); if (small) { small.style.display = 'block'; small.style.opacity = '0.9'; } } catch (e) { }
        // Hide mobile settings button when searching
        try { const mobileSettings = document.getElementById('mobileSettingsBtn'); if (mobileSettings) mobileSettings.style.display = 'none'; } catch (e) { }
        nextBtn.disabled = false;
        try { const mb = document.getElementById('mobileNextBtn'); if (mb) mb.disabled = false; } catch (e) { }
        if (localStream) localStream.getAudioTracks().forEach(t => t.enabled = true);
        remoteVideo.muted = false;
        try { updateReportVisibility(); } catch (e) { }
    }
});

startBtn.addEventListener("click", async () => {
    // Block if onboarding not complete
    if (!window._onboardingComplete) {
        if (window.showAgeModal) window.showAgeModal();
        return;
    }
    if (socket) return;

    startBtn.disabled = true;
    startBtn.style.display = "none";

    // hide agreement note when starting
    try { if (agreeNote) agreeNote.style.display = 'none'; } catch (e) { }

    // switch logos: hide big centered logo and show small corner logo
    try {
        const big = document.getElementById('partnerLogoBig');
        const small = document.getElementById('partnerLogoSmall');
        const spinner = document.getElementById('partnerSpinner');
        if (big) big.style.display = 'none';
        if (small) { small.style.display = 'block'; small.style.top = '-32px'; small.style.left = '0px'; small.style.width = '128px'; small.style.height = '128px'; }
        if (spinner) spinner.style.display = 'none';
    } catch (e) { }

    // Hide mobile settings button when starting
    try { const mobileSettings = document.getElementById('mobileSettingsBtn'); if (mobileSettings) mobileSettings.style.display = 'none'; } catch (e) { }

    socket = io();

    socket.on("connect", async () => {
        attachSocketHandlers();
        // Register Firebase UID with server for ban check + report tracking
        try {
            const uid = window._firebaseUid;
            if (uid) socket.emit('register', { uid: uid });
        } catch (e) { console.error('register emit failed', e); }

        // Server may force onboarding if validation fails
        socket.on('forceOnboarding', () => {
            try {
                console.log('Server forced onboarding — disconnecting');
                socket.disconnect();
                socket = null;
                window._onboardingComplete = false;
                startBtn.disabled = false;
                startBtn.style.display = '';
                if (window.showAgeModal) window.showAgeModal();
            } catch (e) { /* ignore */ }
        });

        await startLocalStream();
        nextBtn.style.display = "block";
        pauseBtn.style.display = "block";
        stText.textContent = "Searching for match...";
        try {
            if (chatStatus) { chatStatus.style.display = 'block'; chatStatus.textContent = 'Searching partner...'; }
            updateMobileStatusBadge('Searching partner...', true);
            if (chatStatusFlag) chatStatusFlag.textContent = '';
            try { const spinner = document.getElementById('partnerSpinner'); if (spinner) { spinner.style.top = 'calc(50% - 10px)'; spinner.style.display = 'block'; } } catch (e) { }
            try { showStarfield(); } catch (e) { }
            try { const small = document.getElementById('partnerLogoSmall'); if (small) small.style.opacity = '0.9'; } catch (e) { }
        } catch (e) { }
        socket.emit("set-preferences", getPreferences());
        socket.emit("ready");
    });
});

// Update preferences when filters change
// suppression flag prevents showing membership modal for a single programmatic change
window._suppressMembershipPopup = window._suppressMembershipPopup || false;
// Cached premium status — set by prefsUI.js or fetched on demand
window._cachedPremiumStatus = window._cachedPremiumStatus || null;

async function checkAndCachePremiumStatus() {
    if (window._cachedPremiumStatus !== null) return window._cachedPremiumStatus;
    try {
        const auth = window._firebaseAuth;
        if (!auth || !auth.currentUser) return false;
        const token = await auth.currentUser.getIdToken();
        const res = await fetch('/premium/status', { headers: { Authorization: 'Bearer ' + token } });
        if (!res.ok) return false;
        const data = await res.json();
        window._cachedPremiumStatus = data.premium === true;
        return window._cachedPremiumStatus;
    } catch (_) { return false; }
}

[myGenderSelect, filterGenderSelect, filterCountrySelect].forEach(select => {
    // store previous value so we can revert if feature gated
    try { select.dataset.prev = select.value; } catch (e) { }
    select.addEventListener("change", async () => {
        try {
            // if this change was programmatic and suppression flag is set, consume it
            if (window._suppressMembershipPopup) {
                window._suppressMembershipPopup = false;
                try { select.dataset.prev = select.value; } catch (e) { }
                if (socket && socket.connected) socket.emit("set-preferences", getPreferences());
                return;
            }
            // filterGender: premium users can filter, non-premium get membership modal
            if (select === filterGenderSelect && select.value !== 'any') {
                const isPremium = await checkAndCachePremiumStatus();
                if (!isPremium) {
                    try { openMembershipModal(); } catch (e) { }
                    try { select.value = select.dataset.prev || 'any'; } catch (e) { }
                    try { const mob = document.getElementById('mobileFilterGender'); if (mob) mob.value = select.value; } catch (e) { }
                    return;
                }
            }
            // All changes (myGender, filterGender, country) — persist via socket
            try { select.dataset.prev = select.value; } catch (e) { }
            if (socket && socket.connected) {
                socket.emit("set-preferences", getPreferences());
            }
        } catch (e) { console.warn('filter change handler failed', e); }
    });
});

// === MOBILE CONTROLS ===
(function () {
    const mobileStartBtn = document.getElementById('mobileStartBtn');
    const mobileNextBtn = document.getElementById('mobileNextBtn');
    const mobilePauseBtn = document.getElementById('mobilePauseBtn');
    const mobileHistoryBtn = document.getElementById('mobileHistoryBtn');
    const mobileSettingsBtn = document.getElementById('mobileSettingsBtn');
    const mobileFilters = document.getElementById('mobileFilters');

    // Sync mobile filter dropdowns with desktop ones
    const mobileMyGender = document.getElementById('mobileMyGender');
    const mobileFilterGender = document.getElementById('mobileFilterGender');
    const mobileFilterCountry = document.getElementById('mobileFilterCountry');

    // Copy country options to mobile dropdown with earth emoji for "Any"
    if (mobileFilterCountry && filterCountrySelect) {
        mobileFilterCountry.innerHTML = '';
        Array.from(filterCountrySelect.options).forEach(opt => {
            const newOpt = document.createElement('option');
            newOpt.value = opt.value;
            // Add earth emoji only to "Any" option
            if (opt.value === 'any') {
                newOpt.textContent = '🌍 Any';
            } else {
                newOpt.textContent = opt.textContent;
            }
            mobileFilterCountry.appendChild(newOpt);
        });
    }

    // Sync mobile filters with desktop filters
    function syncFilters(source, target) {
        if (source && target) {
            target.value = source.value;
        }
    }

    if (mobileMyGender) {
        mobileMyGender.addEventListener('change', () => {
            if (myGenderSelect) {
                myGenderSelect.value = mobileMyGender.value;
                myGenderSelect.dispatchEvent(new Event('change'));
            }
        });
    }

    if (mobileFilterGender) {
        mobileFilterGender.addEventListener('change', () => {
            if (filterGenderSelect) {
                filterGenderSelect.value = mobileFilterGender.value;
                filterGenderSelect.dispatchEvent(new Event('change'));
            }
        });
    }

    if (mobileFilterCountry) {
        mobileFilterCountry.addEventListener('change', () => {
            if (filterCountrySelect) {
                filterCountrySelect.value = mobileFilterCountry.value;
                filterCountrySelect.dispatchEvent(new Event('change'));
            }
        });
    }

    // Mobile button handlers - trigger desktop button clicks
    if (mobileStartBtn) {
        mobileStartBtn.addEventListener('click', () => {
            if (startBtn) startBtn.click();
            // Update mobile UI
            mobileStartBtn.style.display = 'none';
            mobileNextBtn.style.display = 'flex';
            mobilePauseBtn.style.display = 'flex';
            if (mobileFilters) mobileFilters.style.display = 'none';
        });
    }

    if (mobileNextBtn) {
        mobileNextBtn.addEventListener('click', () => {
            if (nextBtn && !nextBtn.disabled) nextBtn.click();
            if (mobileFilters) mobileFilters.style.display = 'none'; // Ensure hidden on Next
        });
    }

    let mobilePauseLastClick = 0;
    if (mobilePauseBtn) {
        mobilePauseBtn.addEventListener('click', () => {
            const now = Date.now();
            if (now - mobilePauseLastClick < 300) return;
            mobilePauseLastClick = now;

            if (pauseBtn) pauseBtn.click();
            // Sync mobile button state
            setTimeout(() => {
                if (pauseBtn.classList.contains('btn-resume')) {
                    mobilePauseBtn.textContent = '▶';
                    mobilePauseBtn.classList.remove('btn-pause');
                    mobilePauseBtn.classList.add('btn-resume');
                    // Pause pressed: show filters
                    if (mobileFilters) mobileFilters.style.display = 'flex';
                } else {
                    mobilePauseBtn.textContent = '■';
                    mobilePauseBtn.classList.remove('btn-resume');
                    mobilePauseBtn.classList.add('btn-pause');
                    // Resume pressed: hide filters
                    if (mobileFilters) mobileFilters.style.display = 'none';
                }
            }, 50);
        });
    }

    if (mobileHistoryBtn) {
        mobileHistoryBtn.addEventListener('click', () => {
            if (historyBtn) historyBtn.click();
        });
    }

    if (mobileSettingsBtn) {
        mobileSettingsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const settingsMenu = document.getElementById('settingsMenu');
            if (!settingsMenu) return;

            if (settingsMenu.getAttribute('aria-hidden') === 'true') {
                // Open menu - CSS handles mobile positioning
                settingsMenu.style.display = 'flex';
                settingsMenu.setAttribute('aria-hidden', 'false');
            } else {
                // Close menu
                settingsMenu.style.display = 'none';
                settingsMenu.setAttribute('aria-hidden', 'true');
            }
        });
    }

    // Mobile message button — toggle chat overlay
    const mobileMessageBtn = document.getElementById('mobileMessageBtn');
    if (mobileMessageBtn) {
        mobileMessageBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const cw = document.getElementById('chatWrap');
            if (!cw) return;
            if (cw.classList.contains('mobile-chat-open')) {
                cw.classList.remove('mobile-chat-open');
            } else {
                cw.classList.add('mobile-chat-open');
                const ci = document.getElementById('chatInput');
                // Focus immediately to trigger keyboard (especially on iOS)
                if (ci) {
                    // Ensure it's enabled so we can focus (visual only, sending still restricted by logic)
                    if (ci.disabled && !ci.value) ci.disabled = false;
                    ci.focus();
                    // Fallback for some browsers
                    setTimeout(() => ci.focus(), 50);
                }
                const cl = document.getElementById('chatLog');
                if (cl) cl.scrollTop = cl.scrollHeight;
            }
        });
        document.addEventListener('click', (e) => {
            const cw = document.getElementById('chatWrap');
            if (!cw || !cw.classList.contains('mobile-chat-open')) return;
            if (!cw.contains(e.target) && e.target !== mobileMessageBtn) {
                cw.classList.remove('mobile-chat-open');
            }
        });
    }
})();

// === Fullscreen Detection ===
(function () {
    const root = document.documentElement;

    function isWindowMaximizedThreshold() {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const availW = screen.availWidth || screen.width;
        const availH = screen.availHeight || screen.height;
        return (w >= availW - 10 && h >= availH - 80);
    }

    function updateFullscreenFlag() {
        const isFs = !!document.fullscreenElement;
        const isMax = isWindowMaximizedThreshold();
        if (isFs || isMax) root.classList.add('is-fullscreen');
        else root.classList.remove('is-fullscreen');
    }

    document.addEventListener('fullscreenchange', updateFullscreenFlag, { passive: true });
    window.addEventListener('resize', updateFullscreenFlag, { passive: true });

    updateFullscreenFlag();
})();

// === Camera Auto-Start ===
// Try to open camera on page load (best-effort; browsers may require user gesture)
document.addEventListener('DOMContentLoaded', () => {
    try { startLocalStream(); } catch (e) { console.warn('startLocalStream failed on load', e); }
}, { passive: true });

// === Premium Script Loader ===
// Dynamically loads premium UI scripts if the premium system is available.
// Scripts self-initialize; no index.html edit required.
(function loadPremiumScripts() {
    var scripts = ['/js/premium/prefsUI.js'];
    scripts.forEach(function (src) {
        var s = document.createElement('script');
        s.src = src;
        s.defer = true;
        s.onerror = function () { /* premium scripts optional */ };
        document.body.appendChild(s);
    });
})();

// === Premium Crown Badge ===
(function premiumCrownBadge() {
    function showCrown() {
        if (document.getElementById('premium-crown')) return;
        var el = document.createElement('div');
        el.id = 'premium-crown';
        el.textContent = '👑';
        Object.assign(el.style, {
            position: 'absolute', top: '6px', right: '6px', zIndex: '10',
            fontSize: '18px', lineHeight: '1', pointerEvents: 'none',
            filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))'
        });

        // Place inside the local video wrapper so it sits over the user's own camera
        var localVideo = document.getElementById('localVideo');
        var container = localVideo ? localVideo.parentElement : null;
        if (container) {
            // Ensure the container is positioned so absolute child works
            if (getComputedStyle(container).position === 'static') {
                container.style.position = 'relative';
            }
            container.appendChild(el);
        } else {
            // Fallback: fixed to screen
            el.style.position = 'fixed';
            el.style.bottom = '12px';
            el.style.right = '12px';
            document.body.appendChild(el);
        }
        console.log('[Crown] Premium crown displayed');
    }

    async function check() {
        try {
            var auth = window._firebaseAuth;
            if (!auth || !auth.currentUser) {
                console.log('[Crown] No authenticated user, skipping');
                return;
            }
            var token = await auth.currentUser.getIdToken();
            var res = await fetch('/premium/status', {
                headers: { Authorization: 'Bearer ' + token }
            });
            var data = await res.json();
            console.log('[Crown] /premium/status response:', data);
            if (data.premium === true) {
                window._cachedPremiumStatus = true;
                showCrown();
            }
        } catch (err) {
            console.error('[Crown] Error checking premium status:', err);
        }
    }

    window.addEventListener('firebase-auth-ready', function () {
        console.log('[Crown] firebase-auth-ready fired, checking premium...');
        check();
    });
    if (window._firebaseAuth && window._firebaseAuth.currentUser) check();

    // Expose check so checkout verification can trigger it
    window._checkPremiumCrown = check;
})();

// === Checkout Success Verification ===
// When Stripe redirects back after payment, verify the session and activate premium.
// This is needed because Stripe webhooks cannot reach localhost during development.
(function checkoutSuccessHandler() {
    var params = new URLSearchParams(window.location.search);
    var sessionId = params.get('checkout_success');
    if (!sessionId) return;

    // Clean the URL so refreshing doesn't re-trigger verification
    var cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);

    console.log('[Checkout] Detected checkout success, verifying session:', sessionId);

    async function verify() {
        try {
            var auth = window._firebaseAuth;
            if (!auth || !auth.currentUser) {
                console.log('[Checkout] Waiting for auth...');
                // Retry after auth is ready
                window.addEventListener('firebase-auth-ready', function () { verify(); });
                return;
            }

            var token = await auth.currentUser.getIdToken();
            var res = await fetch('/verify-checkout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + token
                },
                body: JSON.stringify({ sessionId: sessionId })
            });
            var data = await res.json();
            console.log('[Checkout] Verification response:', data);

            if (data.premium === true) {
                window._cachedPremiumStatus = true;
                // Show crown immediately
                if (window._checkPremiumCrown) window._checkPremiumCrown();
                // Show a success toast if available
                if (typeof showToast === 'function') showToast('Premium activated! 👑');
                console.log('[Checkout] Premium activated successfully');
            } else {
                console.warn('[Checkout] Verification did not activate premium:', data);
            }
        } catch (err) {
            console.error('[Checkout] Verification failed:', err);
        }
    }

    if (window._firebaseAuth && window._firebaseAuth.currentUser) {
        verify();
    } else {
        window.addEventListener('firebase-auth-ready', function () { verify(); });
    }
})();

// === Unban Checkout Success Verification ===
(function unbanSuccessHandler() {
    var params = new URLSearchParams(window.location.search);
    var sessionId = params.get('unban_success');
    if (!sessionId) return;

    // Clean the URL
    var cleanUrl = window.location.origin + window.location.pathname;
    window.history.replaceState({}, document.title, cleanUrl);

    console.log('[Unban] Detected unban success, verifying session:', sessionId);

    async function verify() {
        try {
            var auth = window._firebaseAuth;
            if (!auth || !auth.currentUser) {
                window.addEventListener('firebase-auth-ready', function () { verify(); });
                return;
            }

            var token = await auth.currentUser.getIdToken();
            var res = await fetch('/verify-unban', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: 'Bearer ' + token
                },
                body: JSON.stringify({ sessionId: sessionId })
            });
            var data = await res.json();
            console.log('[Unban] Verification response:', data);

            if (data.unbanned === true) {
                // Hide ban overlays
                var banOverlay = document.getElementById('banOverlay');
                if (banOverlay) banOverlay.style.display = 'none';
                var tempBanOverlay = document.getElementById('tempBanOverlay');
                if (tempBanOverlay) tempBanOverlay.style.display = 'none';
                var paymentOverlay = document.getElementById('paymentOverlay');
                if (paymentOverlay) paymentOverlay.style.display = 'none';

                if (typeof showToast === 'function') showToast('Account unbanned! Welcome back 🎉');
                console.log('[Unban] Ban cleared successfully');

                // Reload to get a clean state
                setTimeout(function () { window.location.reload(); }, 1500);
            } else {
                console.warn('[Unban] Verification did not clear ban:', data);
            }
        } catch (err) {
            console.error('[Unban] Verification failed:', err);
        }
    }

    if (window._firebaseAuth && window._firebaseAuth.currentUser) {
        verify();
    } else {
        window.addEventListener('firebase-auth-ready', function () { verify(); });
    }
})();
