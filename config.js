// DetailPro CRM — Deployment configuration
// Change DP_API_BASE to your Render backend URL before deploying to Netlify.
// Everything else is optional.

window.DP_CONFIG = {
  // Your Render backend URL. No trailing slash.
  // Local dev: 'http://localhost:3333'
  // Production: 'https://your-service.onrender.com'
  apiBase: (function () {
    // Detect local dev automatically so you don't have to change this file
    // while running the files directly from disk or a local server.
    const host = (typeof location !== 'undefined' && location.hostname) || '';
    if (host === 'localhost' || host === '127.0.0.1' || host === '') {
      return 'http://localhost:3333';
    }
    // ← CHANGE THIS to your Render URL before deploying
    return 'https://YOUR-SERVICE.onrender.com';
  })(),

  // App display name shown on the login page and browser tab.
  appName: 'DetailPro CRM',
};

// Convenience alias used by api-client.js and notifications.js
window.DP_API_BASE = window.DP_CONFIG.apiBase;
