// =============================================================
// DetailPro CRM — Auth helper
// Include this BEFORE main-enhanced.js on every protected page.
// On login.html / signup.html, include it alone.
// =============================================================
(function () {
  const TOKEN_KEY = 'dp_token';
  const API_URL_KEY = 'dp_api_base_url';
  const ACCOUNT_CACHE_KEY = 'dp_account_cache';

  function getApiBaseUrl() {
    return (localStorage.getItem(API_URL_KEY) || '').trim();
  }
  function setApiBaseUrl(url) {
    localStorage.setItem(API_URL_KEY, String(url || '').trim().replace(/\/$/, ''));
  }

  function getToken() { return localStorage.getItem(TOKEN_KEY) || ''; }
  function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
  function clearToken() { localStorage.removeItem(TOKEN_KEY); }

  function getCachedAccount() {
    try { return JSON.parse(localStorage.getItem(ACCOUNT_CACHE_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function setCachedAccount(obj) {
    localStorage.setItem(ACCOUNT_CACHE_KEY, JSON.stringify(obj));
  }
  function clearCachedAccount() { localStorage.removeItem(ACCOUNT_CACHE_KEY); }

  async function apiFetch(path, options) {
    const base = getApiBaseUrl();
    if (!base) {
      return { ok: false, status: 0, error: 'No server URL configured. Set it on the login page.' };
    }
    try {
      const res = await fetch(`${base}${path}`, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(options && options.headers ? options.headers : {})
        }
      });
      let body = null;
      try { body = await res.json(); } catch (e) {}
      if (!res.ok) {
        return { ok: false, status: res.status, error: (body && body.error) || `Request failed (${res.status})` };
      }
      return { ok: true, status: res.status, body };
    } catch (e) {
      return { ok: false, status: 0, error: 'Could not reach the server. Check the server URL and that it is running.' };
    }
  }

  function cacheFromAuthResponse(resp) {
    setCachedAccount({
      id: resp.account.id,
      businessName: resp.account.businessName,
      plan: resp.account.plan,
      currentUserId: resp.user.id,
      currentUserName: resp.user.name,
      currentUserEmail: resp.user.email,
      currentUserRole: resp.user.role
    });
  }

  async function signup({ email, password, name, businessName }) {
    const result = await apiFetch('/api/signup', {
      method: 'POST',
      body: JSON.stringify({ email, password, name, businessName })
    });
    if (!result.ok) return result;
    setToken(result.body.token);
    cacheFromAuthResponse(result.body);
    return { ok: true, body: result.body };
  }

  async function login({ email, password }) {
    const result = await apiFetch('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    if (!result.ok) return result;
    setToken(result.body.token);
    cacheFromAuthResponse(result.body);
    return { ok: true, body: result.body };
  }

  function authHeader() {
    const t = getToken();
    return t ? { Authorization: `Bearer ${t}` } : {};
  }

  async function fetchMe() {
    const result = await apiFetch('/api/me', { headers: authHeader() });
    if (!result.ok) {
      if (result.status === 401) logout(); // token invalid/expired
      return result;
    }
    const current = getCachedAccount() || {};
    setCachedAccount({
      ...current,
      id: result.body.account.id,
      businessName: result.body.account.businessName,
      plan: result.body.account.plan,
      currentUserId: result.body.currentUserId,
      team: result.body.team
    });
    return result;
  }

  function logout() {
    clearToken();
    clearCachedAccount();
    window.location.href = 'login.html';
  }

  // Redirect to login.html if there's no token. Call this immediately on
  // every protected page (before main-enhanced.js runs).
  function requireAuthOrRedirect() {
    if (!getToken()) {
      const next = encodeURIComponent(window.location.pathname.split('/').pop() || 'index.html');
      window.location.href = `login.html?next=${next}`;
      return false;
    }
    return true;
  }

  window.DPAuth = {
    getApiBaseUrl, setApiBaseUrl,
    getToken, setToken, clearToken,
    getCachedAccount, setCachedAccount, clearCachedAccount,
    apiFetch, authHeader,
    signup, login, fetchMe, logout,
    requireAuthOrRedirect
  };
})();
