// public/js/premium/devButton.js
// Self-initializing dev-only button to toggle premium on/off.
// Only visible when the server reports dev mode via GET /premium/status.
// Does NOT modify index.html.

(function () {
  'use strict';

  async function getToken() {
    try {
      var auth = window._firebaseAuth;
      if (!auth || !auth.currentUser) return null;
      return await auth.currentUser.getIdToken();
    } catch (_) {
      return null;
    }
  }

  async function fetchStatus() {
    var token = await getToken();
    if (!token) return null;
    try {
      var res = await fetch('https://app.omedash.com/premium/status', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  async function togglePremium(on) {
    var token = await getToken();
    if (!token) throw new Error('Not authenticated');
    var res = await fetch('https://app.omedash.com/premium/toggle-dev', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ on: on }),
    });
    return await res.json();
  }

  function injectButton(isPremium) {
    if (document.getElementById('premium-dev-btn')) {
      // Update existing button text
      var existing = document.getElementById('premium-dev-btn');
      existing.textContent = isPremium ? '🔧 Disable Premium' : '🔧 Enable Premium';
      existing.dataset.active = isPremium ? 'true' : 'false';
      return;
    }

    var btn = document.createElement('button');
    btn.id = 'premium-dev-btn';
    btn.textContent = isPremium ? '🔧 Disable Premium' : '🔧 Enable Premium';
    btn.dataset.active = isPremium ? 'true' : 'false';
    Object.assign(btn.style, {
      position: 'fixed', top: '12px', right: '12px', zIndex: '10002',
      padding: '6px 14px', borderRadius: '8px', border: '1px solid #555',
      background: '#2a2a3e', color: '#f5af19', cursor: 'pointer',
      fontWeight: '600', fontSize: '12px', fontFamily: 'sans-serif',
      boxShadow: '0 2px 8px rgba(0,0,0,.3)',
    });

    btn.addEventListener('click', async function () {
      btn.disabled = true;
      btn.textContent = '⏳ …';
      try {
        var currentlyOn = btn.dataset.active === 'true';
        var result = await togglePremium(!currentlyOn);
        if (result.ok) {
          btn.dataset.active = result.isPremium ? 'true' : 'false';
          btn.textContent = result.isPremium ? '🔧 Disable Premium' : '🔧 Enable Premium';
          // Reload the page so prefsUI picks up the new status
          window.location.reload();
        } else {
          btn.textContent = 'Error';
          setTimeout(function () {
            btn.textContent = currentlyOn ? '🔧 Disable Premium' : '🔧 Enable Premium';
          }, 2000);
        }
      } catch (e) {
        btn.textContent = 'Error';
        setTimeout(function () { btn.textContent = '🔧 Toggle Premium'; }, 2000);
      }
      btn.disabled = false;
    });

    document.body.appendChild(btn);
  }

  async function bootstrap() {
    var status = await fetchStatus();
    // Only show the button if the /premium/status endpoint is reachable
    // (which implies PREMIUM_DEV is true on server)
    if (!status) return;

    injectButton(status.isPremium);
  }

  // Listen for the reliable auth-ready event dispatched by auth.js
  window.addEventListener('firebase-auth-ready', function () {
    bootstrap();
  });

  // Also handle case where auth resolved before this script loaded
  if (window._firebaseAuth && window._firebaseAuth.currentUser) {
    bootstrap();
  }
})();
