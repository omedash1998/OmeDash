// public/js/premium/prefsUI.js
// Self-initializing premium preferences panel.
// Does NOT modify index.html — injects DOM dynamically when premium is active.
// Loaded as a static script; self-runs on window load.

(function () {
  'use strict';

  /** Get Firebase ID token from the current auth session */
  async function getToken() {
    try {
      const auth = window._firebaseAuth;
      if (!auth || !auth.currentUser) return null;
      return await auth.currentUser.getIdToken();
    } catch (_) {
      return null;
    }
  }

  /** Fetch premium status from server */
  async function fetchStatus() {
    const token = await getToken();
    if (!token) return null;
    try {
      const res = await fetch('https://app.omedash.com/premium/status', {
        headers: { Authorization: 'Bearer ' + token },
      });
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  /** Save preferences to server */
  async function savePrefs(country, gender) {
    const token = await getToken();
    if (!token) throw new Error('Not authenticated');
    const res = await fetch('https://app.omedash.com/premium/set-preferences', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({ countryPref: country, genderPref: gender }),
    });
    return await res.json();
  }

  /** Show a small transient toast message */
  function toast(msg, isError) {
    var el = document.getElementById('premium-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'premium-toast';
      Object.assign(el.style, {
        position: 'fixed', bottom: '80px', right: '18px', zIndex: '10001',
        padding: '8px 16px', borderRadius: '8px', fontSize: '13px',
        color: '#fff', fontFamily: 'sans-serif', transition: 'opacity .3s',
        pointerEvents: 'none', opacity: '0',
      });
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.background = isError ? '#e74c3c' : '#27ae60';
    el.style.opacity = '1';
    clearTimeout(el._timer);
    el._timer = setTimeout(function () { el.style.opacity = '0'; }, 2500);
  }

  /** Inject the premium badge next to username */
  function injectBadge() {
    if (document.getElementById('premium-badge')) return;
    // Try common username containers
    var target = document.getElementById('username') ||
                 document.getElementById('displayName') ||
                 document.querySelector('.username') ||
                 document.querySelector('.display-name');
    if (!target) return;

    var badge = document.createElement('span');
    badge.id = 'premium-badge';
    badge.textContent = '⭐ Premium';
    Object.assign(badge.style, {
      display: 'inline-block', marginLeft: '8px', padding: '2px 8px',
      borderRadius: '10px', fontSize: '11px', fontWeight: '600',
      background: 'linear-gradient(135deg,#f5af19,#f12711)', color: '#fff',
      verticalAlign: 'middle', fontFamily: 'sans-serif',
    });
    target.parentNode.insertBefore(badge, target.nextSibling);
  }

  /** Build and inject the floating preferences panel */
  function injectPanel(status) {
    if (document.getElementById('premium-panel')) return;

    var panel = document.createElement('div');
    panel.id = 'premium-panel';
    Object.assign(panel.style, {
      position: 'fixed', bottom: '18px', right: '18px', zIndex: '10000',
      background: '#1e1e2e', border: '1px solid #444', borderRadius: '12px',
      padding: '14px 18px', fontFamily: 'sans-serif', color: '#eee',
      boxShadow: '0 4px 20px rgba(0,0,0,.4)', minWidth: '200px',
      fontSize: '13px',
    });

    var title = document.createElement('div');
    title.textContent = '⭐ Premium Preferences';
    Object.assign(title.style, {
      fontWeight: '700', marginBottom: '10px', fontSize: '14px',
    });
    panel.appendChild(title);

    // Country select
    var cLabel = document.createElement('label');
    cLabel.textContent = 'Country: ';
    cLabel.style.display = 'block';
    cLabel.style.marginBottom = '6px';
    var cSelect = document.createElement('select');
    cSelect.id = 'premium-country';
    Object.assign(cSelect.style, {
      marginLeft: '4px', padding: '3px 6px', borderRadius: '6px',
      border: '1px solid #555', background: '#2a2a3e', color: '#eee',
    });
    [['', 'Any'], ['US', '🇺🇸 US'], ['MX', '🇲🇽 MX'], ['BR', '🇧🇷 BR']].forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt[0];
      o.textContent = opt[1];
      if (status.countryPref === opt[0]) o.selected = true;
      cSelect.appendChild(o);
    });
    cLabel.appendChild(cSelect);
    panel.appendChild(cLabel);

    // Gender select
    var gLabel = document.createElement('label');
    gLabel.textContent = 'Gender: ';
    gLabel.style.display = 'block';
    gLabel.style.marginBottom = '10px';
    var gSelect = document.createElement('select');
    gSelect.id = 'premium-gender';
    Object.assign(gSelect.style, {
      marginLeft: '4px', padding: '3px 6px', borderRadius: '6px',
      border: '1px solid #555', background: '#2a2a3e', color: '#eee',
    });
    [['any', 'Any'], ['male', 'Male'], ['female', 'Female']].forEach(function (opt) {
      var o = document.createElement('option');
      o.value = opt[0];
      o.textContent = opt[1];
      if (status.genderPref === opt[0]) o.selected = true;
      gSelect.appendChild(o);
    });
    gLabel.appendChild(gSelect);
    panel.appendChild(gLabel);

    // Save button
    var btn = document.createElement('button');
    btn.textContent = 'Save';
    Object.assign(btn.style, {
      padding: '6px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer',
      background: 'linear-gradient(135deg,#f5af19,#f12711)', color: '#fff',
      fontWeight: '600', fontSize: '13px',
    });
    btn.addEventListener('click', async function () {
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        var result = await savePrefs(
          cSelect.value || null,
          gSelect.value || null
        );
        if (result.ok) {
          toast('Preferences saved ✓');
        } else {
          toast(result.error || 'Save failed', true);
        }
      } catch (e) {
        toast('Network error', true);
      }
      btn.disabled = false;
      btn.textContent = 'Save';
    });
    panel.appendChild(btn);

    // Collapse/expand toggle
    var toggle = document.createElement('span');
    toggle.textContent = '−';
    Object.assign(toggle.style, {
      position: 'absolute', top: '8px', right: '12px', cursor: 'pointer',
      fontSize: '18px', lineHeight: '1', color: '#888',
    });
    var collapsed = false;
    var inner = [cLabel, gLabel, btn];
    toggle.addEventListener('click', function () {
      collapsed = !collapsed;
      inner.forEach(function (el) { el.style.display = collapsed ? 'none' : ''; });
      toggle.textContent = collapsed ? '+' : '−';
    });
    panel.appendChild(toggle);

    document.body.appendChild(panel);
  }

  /** Main bootstrap — runs once auth is ready */
  async function bootstrap() {
    var status = await fetchStatus();
    if (!status || !status.isPremium) return;

    injectBadge();
    injectPanel(status);
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
