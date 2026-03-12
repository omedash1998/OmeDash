
import './ui.js';
import { auth, db } from './auth.js';
import { joinQueue, leaveQueue } from './match.js';

// window variables already set in ui.js

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

// Pay button → emit request-unban to server (Stripe placeholder)
function handlePayUnban(btn) {
    if (!socket || !socket.connected) {
        showToast('Not connected to server');
        return;
    }
    btn.disabled = true;
    btn.textContent = 'Processing...';
    socket.emit('request-unban');
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
                        const container = document.querySelector('.partner-video');
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
        appendChatMessage("other", msg.text);
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

    // Incoming private message from another user — inline append, no full re-render
    socket.on('private-message-received', (payload) => {
        try {
            const { fromUid, text, conversationId } = payload;
            console.log('[main.js] Received private message from', fromUid);
            showToast('New message received');

            // Inline append to Messages tab conversation (localStorage-based)
            appendIncomingMessage(fromUid, text);

            // ALSO inject into Firestore-based conv-boxes (rendered by app.js)
            try {
                if (typeof _msgSendCooldown !== 'undefined') _msgSendCooldown = Date.now() + 4000;
                const ml = document.getElementById('messageList');
                if (ml) {
                    // Check both attribute names: app.js uses data-partner-uid, main.js uses data-partner-id
                    let partnerBox = ml.querySelector('.conv-box[data-partner-uid="' + fromUid + '"]');
                    if (!partnerBox) partnerBox = ml.querySelector('.conv-box[data-partner-id="' + fromUid + '"]');
                    if (partnerBox) {
                        const body = partnerBox.querySelector('.conv-body');
                        if (body) {
                            // Check if this message was already injected (avoid duplication)
                            const lastBubble = body.querySelector('.msg-row:last-child .message-bubble');
                            if (!lastBubble || lastBubble.textContent !== text) {
                                const row = document.createElement('div');
                                row.className = 'msg-row msg-row-in';
                                const bubble = document.createElement('div');
                                bubble.className = 'message-bubble message-in';
                                bubble.textContent = text;
                                row.appendChild(bubble);
                                body.appendChild(row);
                                if (body.classList.contains('open')) {
                                    requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
                                } else {
                                    partnerBox.classList.add('conv-unread-pulse');
                                    setTimeout(() => { partnerBox.classList.remove('conv-unread-pulse'); }, 2000);
                                }
                                // Update subtitle
                                const sub = partnerBox.querySelector('.conv-sub');
                                if (sub) sub.textContent = new Date().toLocaleString() + ' \u2014 ' + (text.length > 40 ? text.slice(0, 40) + '...' : text);
                                // Move to top
                                if (ml.firstChild !== partnerBox) ml.insertBefore(partnerBox, ml.firstChild);
                            }
                        }
                    } else {
                        // No conv-box exists — create one directly
                        const emptyEl = ml.querySelector('.history-empty');
                        if (emptyEl) emptyEl.remove();
                        const loadingEl = ml.querySelector('div[style*="text-align:center"]');
                        if (loadingEl && !loadingEl.classList.contains('conv-box')) loadingEl.remove();

                        const box = document.createElement('div');
                        box.className = 'conv-box conv-box-enter';
                        box.setAttribute('data-partner-uid', fromUid);

                        const header = document.createElement('div'); header.className = 'conv-header';
                        const avatar = document.createElement('div'); avatar.className = 'conv-avatar';
                        avatar.innerHTML = '<svg width="32" height="22" viewBox="0 0 24 24" fill="none"><rect width="24" height="24" rx="4" fill="#eef7ff"/><path d="M12 12c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3z" fill="#cfeeff"/></svg>';
                        const titleWrap = document.createElement('div');
                        titleWrap.style.flex = '1'; titleWrap.style.minWidth = '0';
                        const titleEl = document.createElement('div'); titleEl.className = 'conv-title';
                        titleEl.textContent = fromUid.slice(0, 8) + '...';
                        const subEl = document.createElement('div'); subEl.className = 'conv-sub';
                        subEl.textContent = new Date().toLocaleString() + ' \u2014 ' + (text.length > 40 ? text.slice(0, 40) + '...' : text);
                        titleWrap.appendChild(titleEl); titleWrap.appendChild(subEl);
                        header.appendChild(avatar); header.appendChild(titleWrap);

                        const bodyEl = document.createElement('div'); bodyEl.className = 'conv-body';
                        const row = document.createElement('div'); row.className = 'msg-row msg-row-in';
                        const bubble = document.createElement('div'); bubble.className = 'message-bubble message-in';
                        bubble.textContent = text;
                        row.appendChild(bubble); bodyEl.appendChild(row);

                        const footer = document.createElement('div'); footer.className = 'conv-footer';
                        footer.style.display = 'none';
                        const inputEl = document.createElement('input'); inputEl.className = 'conv-input'; inputEl.placeholder = 'Type a message...';
                        const sendEl = document.createElement('button'); sendEl.className = 'conv-send'; sendEl.textContent = 'Send';
                        footer.appendChild(inputEl); footer.appendChild(sendEl);

                        header.addEventListener('click', () => {
                            const isOpen = bodyEl.classList.toggle('open');
                            footer.style.display = isOpen ? '' : 'none';
                            if (isOpen) requestAnimationFrame(() => { bodyEl.scrollTop = bodyEl.scrollHeight; });
                        });

                        // Send handler
                        const doSend = async () => {
                            const txt = (inputEl.value || '').trim();
                            if (!txt) return;
                            try {
                                if (typeof _msgSendCooldown !== 'undefined') _msgSendCooldown = Date.now() + 4000;
                                const r = document.createElement('div'); r.className = 'msg-row msg-row-out';
                                const b = document.createElement('div'); b.className = 'message-bubble message-out msg-sending'; b.textContent = txt;
                                r.appendChild(b); bodyEl.appendChild(r);
                                requestAnimationFrame(() => { bodyEl.scrollTop = bodyEl.scrollHeight; });
                                inputEl.value = ''; inputEl.focus();
                                if (socket && socket.connected) {
                                    socket.emit('private-message', { recipientUid: fromUid, text: txt });
                                }
                                setTimeout(() => { try { b.classList.remove('msg-sending'); } catch (_) { } }, 1500);
                            } catch (e) { console.warn('Send failed', e); }
                        };
                        sendEl.addEventListener('click', doSend);
                        inputEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doSend(); } });

                        box.appendChild(header); box.appendChild(bodyEl); box.appendChild(footer);
                        ml.insertBefore(box, ml.firstChild);
                        if (typeof _renderedPartnerBoxes !== 'undefined') _renderedPartnerBoxes.set(fromUid, box);
                        requestAnimationFrame(() => { box.classList.remove('conv-box-enter'); });

                        // Fetch real profile in background
                        try {
                            const auth = window._firebaseAuth;
                            if (auth && auth.currentUser) {
                                auth.currentUser.getIdToken().then(token => {
                                    fetch('https://app.omedash.com/api/user-profile/' + fromUid, { headers: { Authorization: 'Bearer ' + token } })
                                        .then(r => r.ok ? r.json() : null)
                                        .then(p => {
                                            if (p) {
                                                if (p.displayName) titleEl.textContent = p.displayName;
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
                }
            } catch (e) { console.warn('[main.js] conv-box inject failed', e); }
        } catch (e) { console.error('private-message-received handler failed', e); }
    });

    // Message successfully sent — remove sending state
    socket.on('message-sent', (payload) => {
        try {
            console.log('Message sent successfully');
            // Clear any remaining sending indicators
            document.querySelectorAll('.msg-sending').forEach(el => el.classList.remove('msg-sending'));
        } catch (e) { /* ignore */ }
    });

    // Message error — mark failed messages
    socket.on('message-error', (payload) => {
        try {
            const msg = (payload && payload.message) || 'Failed to send message';
            showToast(msg);
            // Mark any sending messages as failed
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

// ── Incremental message rendering ──────────────────────────────
// Keyed DOM cache: partnerId → { box, body, sub, openState }
const _convBoxes = new Map();
let _lastMsgRenderCount = 0;

// Helper: create a single message row element
function _createMsgRow(text, direction, isSending) {
    const row = document.createElement('div');
    row.className = 'msg-row' + (direction === 'out' ? ' msg-row-out' : ' msg-row-in');
    const bubble = document.createElement('div');
    bubble.className = 'message-bubble ' + (direction === 'out' ? 'message-out' : 'message-in');
    if (isSending) bubble.classList.add('msg-sending');
    bubble.textContent = text;
    row.appendChild(bubble);
    return row;
}

// Helper: build a full conv-box for a partner
function _buildConvBox(id, msgs) {
    const box = document.createElement('div');
    box.className = 'conv-box conv-box-enter';
    box.dataset.partnerId = id;
    box.setAttribute('data-partner-uid', id);

    const header = document.createElement('div'); header.className = 'conv-header';
    const avatar = document.createElement('div'); avatar.className = 'conv-avatar';
    const ppic = (id !== 'unknown' && partnerProfiles[id] && partnerProfiles[id].pic) ? partnerProfiles[id].pic : null;
    if (ppic) { const im = document.createElement('img'); im.src = ppic; im.style.width = '100%'; im.style.height = '100%'; im.style.objectFit = 'cover'; avatar.appendChild(im); }
    else { avatar.innerHTML = '<svg width="32" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect width="24" height="24" rx="4" fill="#eef7ff"/><path d="M12 12c1.657 0 3-1.343 3-3s-1.343-3-3-3-3 1.343-3 3 1.343 3 3 3z" fill="#cfeeff"/></svg>'; }

    const titleWrap = document.createElement('div');
    titleWrap.style.flex = '1'; titleWrap.style.minWidth = '0';
    const title = document.createElement('div'); title.className = 'conv-title';
    const pname = (id !== 'unknown' && partnerProfiles[id] && partnerProfiles[id].name) ? partnerProfiles[id].name : (id === 'unknown' ? 'Unknown' : 'User ' + id.slice(0, 6));
    title.textContent = pname;
    const sub = document.createElement('div'); sub.className = 'conv-sub';
    titleWrap.appendChild(title); titleWrap.appendChild(sub);
    header.appendChild(avatar); header.appendChild(titleWrap);

    // more button (delete conversation messages)
    const moreBtn = document.createElement('button');
    moreBtn.className = 'more-btn';
    moreBtn.title = 'Delete conversation';
    moreBtn.textContent = '⋮';
    moreBtn.style.marginLeft = 'auto';
    moreBtn.style.marginRight = '0';
    moreBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openConfirmDeleteModal(
            'Delete conversation',
            'Delete this conversation and its messages?',
            () => {
                try {
                    const arr = loadMessages();
                    const filtered = arr.filter(m => (m.id || 'unknown') !== id);
                    saveMessages(filtered);
                    _convBoxes.delete(id);
                    box.classList.add('conv-box-exit');
                    setTimeout(() => { try { box.remove(); } catch (_) { } }, 250);
                    // show empty if none left
                    const list = document.getElementById('messageList');
                    if (list && _convBoxes.size === 0) {
                        setTimeout(() => {
                            list.innerHTML = '<div class="history-empty"><div class="history-empty-icon">💬</div><div class="history-empty-text">No messages yet</div><div style="font-size:12px;color:#94a8c0;">Your conversations will appear here</div></div>';
                        }, 260);
                    }
                } catch (err) { console.warn('delete conversation failed', err); }
            }
        );
    });
    header.appendChild(moreBtn);

    const body = document.createElement('div'); body.className = 'conv-body';
    // populate messages in body
    if (msgs && msgs.length) {
        msgs.forEach(m => {
            body.appendChild(_createMsgRow(m.text, m.direction, false));
        });
    }

    const footer = document.createElement('div'); footer.className = 'conv-footer';
    const input = document.createElement('input'); input.className = 'conv-input'; input.placeholder = 'Send a message...';
    const send = document.createElement('button'); send.className = 'conv-send'; send.textContent = 'Send';
    footer.appendChild(input); footer.appendChild(send);

    // header toggle with smooth transition
    header.addEventListener('click', () => {
        const isOpen = body.classList.toggle('open');
        if (isOpen) {
            requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
        }
    });

    // Enter key sends message
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); send.click(); }
    });

    // send handler — optimistic UI
    send.addEventListener('click', () => {
        const txt = (input.value || '').trim();
        if (!txt) return;
        if (id === 'unknown') { showToast('Cannot send to unknown'); return; }

        // Optimistic: immediately append the bubble
        const row = _createMsgRow(txt, 'out', true);
        body.appendChild(row);
        if (!body.classList.contains('open')) body.classList.add('open');
        requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });

        // Save to local storage
        addMessageEntry({ id: id, when: Date.now(), text: txt, direction: 'out' });

        // Update subtitle preview
        _updateConvSub(id);

        // Clear input
        input.value = '';
        input.focus();

        // Emit to server
        try {
            if (socket) {
                socket.emit('private-message', { recipientUid: id, text: txt });
            }
        } catch (e) { console.error('Send message failed', e); }

        // Remove sending state after short delay (server confirms)
        setTimeout(() => {
            try { row.querySelector('.msg-sending')?.classList.remove('msg-sending'); } catch (_) { }
        }, 1500);
    });

    box.appendChild(header);
    box.appendChild(body);
    box.appendChild(footer);

    // Cache references
    _convBoxes.set(id, { box, body, sub, title });

    // Trigger entrance animation
    requestAnimationFrame(() => { box.classList.remove('conv-box-enter'); });

    return box;
}

// Update the subtitle preview for a given partner
function _updateConvSub(id) {
    const entry = _convBoxes.get(id);
    if (!entry || !entry.sub) return;
    const arr = loadMessages();
    const msgs = arr.filter(m => (m.id || 'unknown') === id);
    msgs.sort((a, b) => (a.when || 0) - (b.when || 0));
    const last = msgs[msgs.length - 1];
    if (last) {
        entry.sub.textContent = new Date(last.when).toLocaleString() + ' — ' + (last.direction === 'out' ? 'You: ' : '') + (last.text.length > 40 ? last.text.slice(0, 40) + '...' : last.text);
    }
}

// Append a single incoming message to an existing (or new) conversation
function appendIncomingMessage(fromUid, text) {
    // Save to localStorage
    addMessageEntry({ id: fromUid, when: Date.now(), text: text, direction: 'in' });

    const list = document.getElementById('messageList');
    const isVisible = list && list.style.display === 'flex';

    if (!isVisible) return; // Messages tab not open, nothing to render

    // Remove empty placeholder if present
    const emptyEl = list.querySelector('.history-empty');
    if (emptyEl) emptyEl.remove();

    let entry = _convBoxes.get(fromUid);
    if (entry) {
        // Conversation exists in our cache — append inline
        const row = _createMsgRow(text, 'in', false);
        entry.body.appendChild(row);
        _updateConvSub(fromUid);
        // Auto-scroll if conversation is open
        if (entry.body.classList.contains('open')) {
            requestAnimationFrame(() => { entry.body.scrollTop = entry.body.scrollHeight; });
        } else {
            // Show unread indicator pulse on header
            entry.box.classList.add('conv-unread-pulse');
            setTimeout(() => { entry.box.classList.remove('conv-unread-pulse'); }, 2000);
        }
        // Move conversation to top of list
        if (list.firstChild !== entry.box) {
            list.insertBefore(entry.box, list.firstChild);
        }
    } else {
        // Check if app.js already created a conv-box in the DOM
        let existingDomBox = list.querySelector('.conv-box[data-partner-uid="' + fromUid + '"]');
        if (!existingDomBox) existingDomBox = list.querySelector('.conv-box[data-partner-id="' + fromUid + '"]');
        if (existingDomBox) {
            // Box exists from app.js — inject into it, don't create a duplicate
            const domBody = existingDomBox.querySelector('.conv-body');
            if (domBody) {
                const row = _createMsgRow(text, 'in', false);
                domBody.appendChild(row);
                if (domBody.classList.contains('open')) {
                    requestAnimationFrame(() => { domBody.scrollTop = domBody.scrollHeight; });
                } else {
                    existingDomBox.classList.add('conv-unread-pulse');
                    setTimeout(() => { existingDomBox.classList.remove('conv-unread-pulse'); }, 2000);
                }
            }
            const sub = existingDomBox.querySelector('.conv-sub');
            if (sub) sub.textContent = new Date().toLocaleString() + ' \u2014 ' + (text.length > 40 ? text.slice(0, 40) + '...' : text);
            if (list.firstChild !== existingDomBox) list.insertBefore(existingDomBox, list.firstChild);
        } else {
            // No box exists at all — build and prepend
            const msgs = loadMessages().filter(m => (m.id || 'unknown') === fromUid);
            msgs.sort((a, b) => (a.when || 0) - (b.when || 0));
            const box = _buildConvBox(fromUid, msgs);
            _updateConvSub(fromUid);
            list.insertBefore(box, list.firstChild);
        }
    }
}

function renderMessagesList() {
    const list = document.getElementById('messageList');
    if (!list) return;

    const arr = loadMessages();
    if (!arr.length) {
        // Clear cache and show empty state — but only if no Firestore-based conv-boxes exist
        _convBoxes.clear();
        const hasFirestoreBoxes = list.querySelector('.conv-box[data-partner-uid]');
        if (!hasFirestoreBoxes) {
            list.innerHTML = '<div class="history-empty"><div class="history-empty-icon">💬</div><div class="history-empty-text">No messages yet</div><div style="font-size:12px;color:#94a8c0;">Your conversations will appear here</div></div>';
        }
        _lastMsgRenderCount = 0;
        return;
    }

    // Group messages by partner id
    const convs = {};
    arr.forEach(m => {
        const id = m.id || 'unknown';
        if (!convs[id]) convs[id] = [];
        convs[id].push(m);
    });

    // Sort by most recent message
    const convArr = Object.keys(convs).map(id => ({ id, msgs: convs[id] }));
    convArr.sort((a, b) => (b.msgs[0].when || 0) - (a.msgs[0].when || 0));

    // Remove empty placeholder if exists
    const emptyEl = list.querySelector('.history-empty');
    if (emptyEl) emptyEl.remove();

    // Track which partner IDs are current
    const currentIds = new Set(convArr.map(c => c.id));

    // Remove boxes for deleted conversations
    for (const [id, entry] of _convBoxes.entries()) {
        if (!currentIds.has(id)) {
            entry.box.remove();
            _convBoxes.delete(id);
        }
    }

    // Add/update boxes
    convArr.forEach((conv, idx) => {
        const id = conv.id;
        const msgs = conv.msgs.slice().sort((x, y) => (x.when || 0) - (y.when || 0));

        let entry = _convBoxes.get(id);
        if (entry) {
            // Existing conversation — only update subtitle, preserve everything else
            _updateConvSub(id);

            // Ensure correct order: conversation at position idx
            const currentChild = list.children[idx];
            if (currentChild !== entry.box) {
                list.insertBefore(entry.box, currentChild || null);
            }
        } else {
            // New conversation — build full box
            const box = _buildConvBox(id, msgs);
            _updateConvSub(id);
            const refChild = list.children[idx] || null;
            list.insertBefore(box, refChild);
        }
    });

    _lastMsgRenderCount = arr.length;
}

function escapeHtml(s) {
    return (s + "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

chatSend.addEventListener("click", () => {
    const text = chatInput.value.trim();
    if (!text) return;
    if (!socket || !currentPartner) { alert('Not connected to a partner'); return; }
    appendChatMessage("me", text);
    socket.emit("chat", { text });
    chatInput.value = "";
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
            const deletedFor = data.deletedFor || {};

            // Skip if conversation is soft-deleted for current user
            if (deletedFor[uid] === true) continue;

            // Find partner UID
            const partnerUid = participants.find(p => p !== uid);
            if (!partnerUid) continue;

            // Use partner profile from conversation doc first (always accessible)
            let displayName = 'User';
            let photoURL = null;

            if (participantProfiles[partnerUid]) {
                displayName = participantProfiles[partnerUid].displayName || 'User';
                photoURL = participantProfiles[partnerUid].photoURL || null;
            }

            // Fallback: try fetching partner's user doc (may fail if rules restrict it)
            if (!photoURL || displayName === 'User') {
                try {
                    const { getDoc, doc } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
                    const partnerRef = doc(window._firebaseDb, 'users', partnerUid);
                    const partnerSnap = await getDoc(partnerRef);
                    if (partnerSnap.exists()) {
                        const partnerData = partnerSnap.data();
                        if (!photoURL && partnerData.photoURL) photoURL = partnerData.photoURL;
                        if (displayName === 'User' && partnerData.displayName) displayName = partnerData.displayName;
                    }
                } catch (e) { /* permission denied — use participantProfiles data */ }
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

            // Create inline chat box (hidden by default)
            const chatBox = document.createElement('div');
            chatBox.className = 'history-chatbox';
            chatBox.style.display = 'none';
            chatBox.style.marginTop = '8px';
            chatBox.style.width = '100%';
            chatBox.style.flexDirection = 'column';
            chatBox.style.gap = '6px';

            // Message history area inside the chatbox
            const chatMsgs = document.createElement('div');
            chatMsgs.className = 'history-chatbox-msgs';
            chatMsgs.style.maxHeight = '180px';
            chatMsgs.style.overflowY = 'auto';
            chatMsgs.style.display = 'flex';
            chatMsgs.style.flexDirection = 'column';
            chatMsgs.style.gap = '4px';
            chatMsgs.style.marginBottom = '6px';
            chatMsgs.style.scrollbarWidth = 'thin';
            chatMsgs.style.scrollbarColor = 'rgba(59,130,246,0.15) transparent';
            chatBox.appendChild(chatMsgs);

            // Input row
            const chatRow = document.createElement('div');
            chatRow.style.display = 'flex';
            chatRow.style.gap = '6px';
            const chatBoxInput = document.createElement('input');
            chatBoxInput.type = 'text';
            chatBoxInput.placeholder = 'Type a message...';
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
            chatRow.appendChild(chatBoxInput);
            chatRow.appendChild(chatBoxSend);
            chatBox.appendChild(chatRow);

            // Store partnerUid on the chatbox for the receive handler
            chatBox.dataset.partnerUid = partnerUid;

            // Text button click - toggle chat box and load messages
            textBtn.addEventListener('click', async () => {
                if (chatBox.style.display === 'none' || !chatBox.style.display) {
                    chatBox.style.display = 'flex';
                    textBtn.style.display = 'none';
                    chatBoxInput.focus();
                    // Load existing messages from Firestore
                    try {
                        if (chatMsgs.children.length === 0 && conversationId) {
                            chatMsgs.innerHTML = '<div style="text-align:center;color:#94a8c0;font-size:11px;padding:4px;">Loading...</div>';
                            const { getDocs: gd, collection: col, query: qu, orderBy: ob } = await import("https://www.gstatic.com/firebasejs/12.9.0/firebase-firestore.js");
                            const msgsSnap = await gd(qu(col(window._firebaseDb, 'conversations', conversationId, 'messages'), ob('createdAt', 'asc')));
                            chatMsgs.innerHTML = '';
                            msgsSnap.forEach(msgDoc => {
                                const md = msgDoc.data();
                                const isMe = md.senderId === uid;
                                const row = document.createElement('div');
                                row.className = 'msg-row ' + (isMe ? 'msg-row-out' : 'msg-row-in');
                                const bubble = document.createElement('div');
                                bubble.className = 'message-bubble ' + (isMe ? 'message-out' : 'message-in');
                                bubble.style.fontSize = '12px';
                                bubble.style.padding = '6px 10px';
                                bubble.textContent = md.text || '';
                                row.appendChild(bubble);
                                chatMsgs.appendChild(row);
                            });
                            requestAnimationFrame(() => { chatMsgs.scrollTop = chatMsgs.scrollHeight; });
                        }
                    } catch (e) { console.warn('Load chat history failed', e); chatMsgs.innerHTML = ''; }
                } else {
                    chatBox.style.display = 'none';
                    textBtn.style.display = '';
                }
            });

            // Enter key sends message
            chatBoxInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') { e.preventDefault(); chatBoxSend.click(); }
            });

            // Send button click - emit private message, keep chatbox open
            chatBoxSend.addEventListener('click', async () => {
                const txt = (chatBoxInput.value || '').trim();
                if (!txt) return;

                try {
                    // Optimistic: show sent message bubble immediately
                    const row = document.createElement('div');
                    row.className = 'msg-row msg-row-out';
                    const bubble = document.createElement('div');
                    bubble.className = 'message-bubble message-out msg-sending';
                    bubble.style.fontSize = '12px';
                    bubble.style.padding = '6px 10px';
                    bubble.textContent = txt;
                    row.appendChild(bubble);
                    chatMsgs.appendChild(row);
                    requestAnimationFrame(() => { chatMsgs.scrollTop = chatMsgs.scrollHeight; });

                    // Save to localStorage so it appears in Messages tab
                    addMessageEntry({ id: partnerUid, when: Date.now(), text: txt, direction: 'out' });

                    // Clear input (keep chatbox open!)
                    chatBoxInput.value = '';
                    chatBoxInput.focus();

                    // Emit to server
                    if (socket) {
                        socket.emit('private-message', {
                            recipientUid: partnerUid,
                            text: txt
                        });
                    }

                    // Remove sending state after confirmation
                    setTimeout(() => {
                        try { bubble.classList.remove('msg-sending'); } catch (_) { }
                    }, 1500);
                } catch (e) {
                    console.error('Send message failed', e);
                }
            });

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

function doClearHistory() {
    try {
        const user = window._firebaseAuth ? window._firebaseAuth.currentUser : null;
        if (!user) {
            showToast('Not logged in');
            closeClearHistoryConfirm();
            return;
        }

        // Emit to server - server handles Firestore delete
        if (socket) {
            socket.emit('clear-history');
            closeClearHistoryConfirm();
        } else {
            showToast('Connection error');
            closeClearHistoryConfirm();
        }
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
            // placeholder logout behavior
            alert('Logged out (placeholder)');
            try { if (socket) socket.disconnect(); } catch (e) { }
            location.reload();
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
    subscribeBtn.addEventListener('click', () => {
        // placeholder: integrate Stripe Checkout / API on server
        alert('Subscribe flow not implemented in this demo. Implement server-side Stripe Checkout to create sessions.');
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

// Terms of Service modal handlers
const tosModal = document.getElementById('tosModal');
const tosCloseBtn = document.getElementById('tosCloseBtn');

function openTosModal() {
    if (!tosModal) return;
    tosModal.style.display = 'flex';
    tosModal.setAttribute('aria-hidden', 'false');
}

function closeTosModal() {
    if (!tosModal) return;
    tosModal.style.display = 'none';
    tosModal.setAttribute('aria-hidden', 'true');
}

if (tosCloseBtn) tosCloseBtn.addEventListener('click', closeTosModal);
if (tosModal) tosModal.addEventListener('click', (e) => { if (e.target === tosModal) closeTosModal(); });

// Privacy modal handlers
const privacyModal = document.getElementById('privacyModal');
const privacyCloseBtn = document.getElementById('privacyCloseBtn');

function openPrivacyModal() {
    if (!privacyModal) return;
    privacyModal.style.display = 'flex';
    privacyModal.setAttribute('aria-hidden', 'false');
}

function closePrivacyModal() {
    if (!privacyModal) return;
    privacyModal.style.display = 'none';
    privacyModal.setAttribute('aria-hidden', 'true');
}

if (privacyCloseBtn) privacyCloseBtn.addEventListener('click', closePrivacyModal);
if (privacyModal) privacyModal.addEventListener('click', (e) => { if (e.target === privacyModal) closePrivacyModal(); });

// Rules modal handlers
const rulesModal = document.getElementById('rulesModal');
const rulesCloseBtn = document.getElementById('rulesCloseBtn');

function openRulesModal() {
    if (!rulesModal) return;
    rulesModal.style.display = 'flex';
    rulesModal.setAttribute('aria-hidden', 'false');
}

function closeRulesModal() {
    if (!rulesModal) return;
    rulesModal.style.display = 'none';
    rulesModal.setAttribute('aria-hidden', 'true');
}

if (rulesCloseBtn) rulesCloseBtn.addEventListener('click', closeRulesModal);
if (rulesModal) rulesModal.addEventListener('click', (e) => { if (e.target === rulesModal) closeRulesModal(); });

// About modal handlers
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
if (aboutModal) aboutModal.addEventListener('click', (e) => { if (e.target === aboutModal) closeAboutModal(); });

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

    socket = io("https://app.omedash.com");

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
[myGenderSelect, filterGenderSelect, filterCountrySelect].forEach(select => {
    // store previous value so we can revert if feature gated
    try { select.dataset.prev = select.value; } catch (e) { }
    select.addEventListener("change", () => {
        try {
            // if this change was programmatic and suppression flag is set, consume it
            if (window._suppressMembershipPopup) {
                window._suppressMembershipPopup = false;
                try { select.dataset.prev = select.value; } catch (e) { }
                if (socket && socket.connected) socket.emit("set-preferences", getPreferences());
                return;
            }
            // if user selects a gender filter (either their gender or looking-for) other than 'any',
            // require membership: show membership modal and revert selection
            // Only require membership when changing the "looking for" filter (not the user's own gender)
            if (select === filterGenderSelect && select.value !== 'any') {
                try { openMembershipModal(); } catch (e) { }
                // revert to previous value
                try { select.value = select.dataset.prev || 'any'; } catch (e) { }
                return;
            }
            // otherwise update stored previous and emit preferences
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


document.addEventListener('DOMContentLoaded', () => {
    try { startLocalStream(); } catch (e) { console.warn('startLocalStream failed on load', e); }
}, { passive: true });
