// DetailPro CRM — API client
// Handles: auth (signup/login/logout), JWT token storage, and two-way data sync.
// Must be loaded AFTER config.js and BEFORE main-enhanced.js.

(function () {
  'use strict';

  // ── Storage keys (never account-scoped — these live outside the tenant namespace) ──
  const TOKEN_KEY = 'dp_auth_token';
  const SESSION_KEY = 'dp_auth_session'; // { user, account }

  // ── Helpers ────────────────────────────────────────────────────────────────────────

  function base() {
    return (window.DP_API_BASE || '').replace(/\/$/, '');
  }

  function getToken() {
    try { return localStorage.getItem(TOKEN_KEY) || null; } catch (e) { return null; }
  }

  function getSession() {
    try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
  }

  function setSession(token, user, account) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(SESSION_KEY, JSON.stringify({ user, account }));
    } catch (e) {}
  }

  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  }

  // Raw fetch wrapper — adds auth header, handles 401 globally.
  async function apiFetch(path, options) {
    const token = getToken();
    const headers = { 'Content-Type': 'application/json', ...((options || {}).headers || {}) };
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let res;
    try {
      res = await fetch(`${base()}${path}`, { ...(options || {}), headers });
    } catch (networkErr) {
      // Server unreachable — throw a typed error callers can check.
      const err = new Error('Network error: could not reach the DetailPro server.');
      err.offline = true;
      throw err;
    }

    if (res.status === 401) {
      clearSession();
      const cur = typeof location !== 'undefined' ? location.pathname : '';
      if (!cur.includes('login.html')) {
        location.href = 'login.html';
      }
      const err = new Error('Session expired. Please log in again.');
      err.expired = true;
      throw err;
    }

    return res;
  }

  // ── Auth actions ───────────────────────────────────────────────────────────────────

  async function signup(email, password, name, businessName) {
    const res = await apiFetch('/api/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, businessName }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Signup failed');
    setSession(body.token, body.user, body.account);
    return body;
  }

  async function login(email, password) {
    const res = await apiFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Login failed');
    setSession(body.token, body.user, body.account);
    return body;
  }

  function logout() {
    // Clear auth tokens and all account-scoped data from localStorage, then
    // redirect to login. We intentionally clear scoped data so the next user
    // (on a shared machine) can't see the previous user's customers/invoices.
    const session = getSession();
    const accountId = session?.account?.id;

    clearSession();

    // Remove scoped data keys for this account.
    if (accountId) {
      const prefix = `dp_${accountId}__`;
      const toRemove = [];
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(prefix)) toRemove.push(k);
        }
        toRemove.forEach(k => localStorage.removeItem(k));
      } catch (e) {}
    }

    location.href = 'login.html';
  }

  // Re-fetch profile from server and update the stored session (e.g. after renaming business).
  async function refreshSession() {
    try {
      const res = await apiFetch('/api/me');
      if (!res.ok) return;
      const body = await res.json();
      const cur = getSession();
      if (cur) {
        setSession(getToken(), { ...cur.user, ...body }, body.account);
        window.DP_ACCOUNT = { ...window.DP_ACCOUNT, ...body.account };
        window.DP_ACCOUNT_ID = body.account.id;
      }
    } catch (e) { /* offline — ignore */ }
  }

  // ── Data sync ──────────────────────────────────────────────────────────────────────
  // All CRM data (customers, appointments, invoices, services…) is stored in
  // account-scoped localStorage keys and mirrored to the server as a single JSON blob.
  // Scoped key names are surfaced by main-enhanced.js after it initialises.

  let _syncTimer = null;
  let _syncInFlight = false;
  let _lastPushAt = 0;

  // Collect all scoped data from localStorage and push to server.
  async function pushSync() {
    if (_syncInFlight) return;
    if (!getToken()) return;
    if (!window.DP_SYNC_KEYS) return; // main-enhanced hasn't run yet

    _syncInFlight = true;
    try {
      const data = {};
      window.DP_SYNC_KEYS.forEach(key => {
        try {
          // Use the raw (unpatched) getter so we get the already-scoped value directly.
          const raw = window.DP_RAW_STORAGE
            ? window.DP_RAW_STORAGE.getItem(window.dpKey(key))
            : localStorage.getItem(key);
          if (raw !== null) data[key] = JSON.parse(raw);
        } catch (e) {}
      });

      await apiFetch('/api/sync', {
        method: 'PUT',
        body: JSON.stringify({ data }),
      });
      _lastPushAt = Date.now();
    } catch (e) {
      if (!e.offline && !e.expired) console.warn('[sync push]', e);
    } finally {
      _syncInFlight = false;
    }
  }

  // Pull data from server and populate localStorage.
  async function pullSync() {
    if (!getToken()) return;
    try {
      const res = await apiFetch('/api/sync');
      if (!res.ok) return;
      const body = await res.json();
      const incoming = body.data || {};

      if (!window.DP_RAW_STORAGE || !window.dpKey) return;

      Object.keys(incoming).forEach(key => {
        if (incoming[key] != null) {
          try {
            window.DP_RAW_STORAGE.setItem(window.dpKey(key), JSON.stringify(incoming[key]));
          } catch (e) {}
        }
      });
    } catch (e) {
      if (!e.offline && !e.expired) console.warn('[sync pull]', e);
    }
  }

  // Schedule a debounced push after a write.
  function schedulePush() {
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(pushSync, 4000);
  }

  // Push on page unload / tab hide so we don't lose the last few seconds of changes.
  if (typeof window !== 'undefined') {
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') pushSync();
    });
    window.addEventListener('pagehide', pushSync);
  }

  // ── Team API ───────────────────────────────────────────────────────────────────────

  async function addTeamMember(email, name, role, tempPassword) {
    const res = await apiFetch('/api/team', {
      method: 'POST',
      body: JSON.stringify({ email, name, role, password: tempPassword }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not add team member');
    return body.user;
  }

  async function removeTeamMember(userId) {
    const res = await apiFetch(`/api/team/${userId}`, { method: 'DELETE' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Could not remove team member');
    }
  }

  async function updateBusinessName(businessName) {
    const res = await apiFetch('/api/account', {
      method: 'PUT',
      body: JSON.stringify({ businessName }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not update business name');
    return body.account;
  }

  async function getTeam() {
    const res = await apiFetch('/api/me');
    const body = await res.json();
    if (!res.ok) throw new Error(body.error || 'Could not load team');
    return body;
  }

  // ── Expose ─────────────────────────────────────────────────────────────────────────

  window.dpAuth = {
    signup,
    login,
    logout,
    getToken,
    getSession,
    setSession,
    clearSession,
    refreshSession,
    isLoggedIn: () => !!getToken(),
  };

  window.dpSync = {
    push: pushSync,
    pull: pullSync,
    schedule: schedulePush,
  };

  window.dpTeamAPI = {
    add: addTeamMember,
    remove: removeTeamMember,
    updateBusinessName,
    getTeam,
  };
})();
