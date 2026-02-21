// === Age Dropdown Generation ===
// Replaces the inline document.write() that generated age options
(function () {
    var dd = document.getElementById('ageDropdown');
    if (!dd) return;
    for (var i = 1; i <= 100; i++) {
        var div = document.createElement('div');
        div.className = 'age-opt';
        div.dataset.val = i;
        div.style.cssText = 'padding:8px 14px;font-size:13px;font-weight:600;color:#083e6a;cursor:pointer;transition:background 0.15s ease;';
        div.textContent = i;
        dd.appendChild(div);
    }
})();

// === Age Dropdown Interaction ===
(function () {
    var arrow = document.getElementById('ageArrow'), dd = document.getElementById('ageDropdown'), inp = document.getElementById('ageInput');
    arrow.addEventListener('click', function (e) { e.stopPropagation(); dd.style.display = dd.style.display === 'none' ? 'block' : 'none'; });
    dd.addEventListener('click', function (e) { var t = e.target.closest('.age-opt'); if (t) { inp.value = t.dataset.val; dd.style.display = 'none'; } });
    dd.addEventListener('mouseover', function (e) { var t = e.target.closest('.age-opt'); if (t) t.style.background = 'rgba(59,130,246,0.08)'; });
    dd.addEventListener('mouseout', function (e) { var t = e.target.closest('.age-opt'); if (t) t.style.background = ''; });
    document.addEventListener('click', function () { dd.style.display = 'none'; });
})();

// === Onboarding (Age/Gender Verification) ===
(function () {
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
