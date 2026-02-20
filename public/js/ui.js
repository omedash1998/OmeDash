
// Expose UI elements to window so other modules can access them identical to inline scripts
window.localVideo = document.getElementById("localVideo");
window.remoteVideo = document.getElementById("remoteVideo");
window.stText = document.getElementById("stText");
window.startBtn = document.getElementById("startBtn");
window.nextBtn = document.getElementById("nextBtn");
window.pauseBtn = document.getElementById("pauseBtn");
window.historyBtn = document.getElementById("historyBtn");
window.settingsBtn = document.getElementById("settingsBtn");
window.chatLog = document.getElementById("chatLog");
window.chatInput = document.getElementById("chatInput");
window.chatSend = document.getElementById("chatSend");
window.chatStatus = document.getElementById("chatStatus");
window.chatStatusFlag = document.getElementById("chatStatusFlag");
window.mobileStatusBadge = document.getElementById("mobileStatusBadge");
window.agreeNote = document.getElementById('agreeNote');
window.starfieldEl = document.getElementById('starfield');
window.myGenderSelect = document.getElementById("myGender");
window.filterGenderSelect = document.getElementById("filterGender");
window.filterCountrySelect = document.getElementById("filterCountry");
window.reportBtn = document.getElementById("reportBtn");
window.reportModal = document.getElementById("reportModal");
window.reportCancelBtn = document.getElementById("reportCancelBtn");
window.reportConfirmBtn = document.getElementById("reportConfirmBtn");
window.reportToast = document.getElementById("reportToast");
window.banOverlay = document.getElementById("banOverlay");
window.paymentOverlay = document.getElementById("paymentOverlay");
window.payUnbanBtn = document.getElementById("payUnbanBtn");
window.tempBanOverlay = document.getElementById("tempBanOverlay");
window.tempBanPayBtn = document.getElementById("tempBanPayBtn");
window.cdDays = document.getElementById("cdDays");
window.cdHours = document.getElementById("cdHours");
window.cdMins = document.getElementById("cdMins");
window.cdSecs = document.getElementById("cdSecs");
window.confirmDeleteModal = document.getElementById("confirmDeleteModal");
window.confirmDeleteTitle = document.getElementById("confirmDeleteTitle");
window.confirmDeleteMessage = document.getElementById("confirmDeleteMessage");
window.confirmDeleteOk = document.getElementById("confirmDeleteOk");
window.confirmDeleteCancel = document.getElementById("confirmDeleteCancel");

window.log = function(...args) { console.log("[webrtc]", ...args); };

window.confirmDeleteAction = null;
window.selectedReportReason = null;
window.isReportSubmitting = false;
window.currentPartnerUid = null;
window.pc = null;
window.localStream = null;
window.currentPartner = null;
window.role = null;
window.isPaused = false;
window.partnerProfiles = {};
window.socket = null;
window.banCountdownInterval = null;

// Copy fullscreen script block (from lines 5626 to 5649)
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

// Copy age validation script blocks
                            var arrow = document.getElementById('ageArrow'), dd = document.getElementById('ageDropdown'), inp = document.getElementById('ageInput');
                            arrow.addEventListener('click', function (e) { e.stopPropagation(); dd.style.display = dd.style.display === 'none' ? 'block' : 'none'; });
                            dd.addEventListener('click', function (e) { var t = e.target.closest('.age-opt'); if (t) { inp.value = t.dataset.val; dd.style.display = 'none'; } });
                            dd.addEventListener('mouseover', function (e) { var t = e.target.closest('.age-opt'); if (t) t.style.background = 'rgba(59,130,246,0.08)'; });
                            dd.addEventListener('mouseout', function (e) { var t = e.target.closest('.age-opt'); if (t) t.style.background = ''; });
                            document.addEventListener('click', function () { dd.style.display = 'none'; });
                        })();
                    </script>
            const ageModal = document.getElementById('ageModal');
            const forbidden = document.getElementById('forbiddenOverlay');
            const ageSubmitBtn = document.getElementById('ageSubmitBtn');
            const ageCancelBtn = document.getElementById('ageCancelBtn');
            const ageInput = document.getElementById('ageInput');
            const ageGender = document.getElementById('ageGender');
            const ageError = document.getElementById('ageError');

            function disableMainControls(disable) {
                const controls = [document.getElementById('startBtn'), document.getElementById('nextBtn'), document.getElementById('pauseBtn')];
                controls.forEach(c => { if (c) c.disabled = disable; });
            }

            // Expose show/hide so the Firebase auth flow can call them
            window.showAgeModal = function () {
                if (!ageModal) return;
                ageModal.style.display = 'flex';
                ageModal.setAttribute('aria-hidden', 'false');
                disableMainControls(true);
            };

            window.hideAgeModal = function () {
                if (!ageModal) return;
                ageModal.style.display = 'none';
                ageModal.setAttribute('aria-hidden', 'true');
                disableMainControls(false);
            };

            function showForbidden() {
                if (!forbidden) return;
                forbidden.style.display = 'flex';
                forbidden.setAttribute('aria-hidden', 'false');
                disableMainControls(true);
            }

            // DO NOT auto-show the modal on DOMContentLoaded anymore;
            // the Firebase auth flow will trigger it when appropriate.

            ageSubmitBtn.addEventListener('click', async () => {
                const age = parseInt(ageInput.value, 10);
                const gender = ageGender ? ageGender.value : '';

                // Validate gender selected
                if (!gender) {
                    ageError.textContent = 'Please select your gender.';
                    ageError.style.display = 'block';
                    return;
                }

                // Validate age entered
                if (!age || age <= 0) {
                    ageError.textContent = 'Please enter a valid age.';
                    ageError.style.display = 'block';
                    return;
                }

                // Under 18 — forbidden
                if (age < 18) {
                    ageError.style.display = 'none';
                    try { localStorage.setItem('vchat_verification', JSON.stringify({ age, gender })); } catch (e) { }
                    window.hideAgeModal();
                    showForbidden();
                    return;
                }

                ageError.style.display = 'none';
                try { localStorage.setItem('vchat_verification', JSON.stringify({ age, gender })); } catch (e) { }

                // Update main filter myGender to match selection
                try {
                    const map = { 'other': 'any', 'male': 'male', 'female': 'female' };
                    const sel = document.getElementById('myGender');
                    if (sel) {
                        try { window._suppressMembershipPopup = true; } catch (e) { }
                        sel.value = map[gender] || 'any';
                        sel.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                } catch (e) { /* ignore */ }

                // Save gender, age, onboardingComplete to Firestore
                if (window._saveOnboarding) {
                    try {
                        await window._saveOnboarding(gender, age);
                    } catch (err) {
                        console.error('Error saving onboarding data:', err);
                    }
                }

                window._onboardingComplete = true;
                window.hideAgeModal();
                // Reveal main app
                if (window._revealApp) window._revealApp();
            });

            ageCancelBtn.addEventListener('click', () => {
                window.hideAgeModal();
                showForbidden();
            });
        })();
