// DetailPro CRM - Notifications (email via mailto) - v1
(function () {
  const SETTINGS_KEY = 'notificationSettings';
  const TEMPLATES_KEY = 'notificationTemplates';

  const defaultSettings = {
    enabled: true,
    confirmation: true,
    ready: true,
    receipt: true,
    autoSendServer: false,
    apiBaseUrl: 'http://localhost:3333',
    apiKey: ''
  };

  const defaultTemplates = {
    confirmation: {
      subject: "Appointment Confirmed - {{service}} on {{date}} at {{time}}",
      body:
`Hi {{customerName}},

Your appointment is confirmed.

Service: {{service}}
Date: {{date}}
Time: {{time}}

If you need to reschedule, just reply to this email.

— DetailPro`
    },
    ready: {
      subject: "Your vehicle is ready - {{service}}",
      body:
`Hi {{customerName}},

Your vehicle is ready for pickup.

Service: {{service}}
Date: {{date}}
Time: {{time}}

Thank you!
— DetailPro`
    },
    receipt: {
      subject: "Payment receipt - Invoice {{invoiceNumber}}",
      body:
`Hi {{customerName}},

Thank you for your payment!

Invoice: {{invoiceNumber}}
Service: {{service}}
Total: {{total}}

— DetailPro`
    }
  };

  function safeParse(jsonStr, fallback) {
    try { return JSON.parse(jsonStr); } catch (e) { return fallback; }
  }

  function getSettings() {
    return { ...defaultSettings, ...(safeParse(localStorage.getItem(SETTINGS_KEY), {}) || {}) };
  }

  function saveSettings(settings) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...getSettings(), ...settings }));
  }

  function getTemplates() {
    const stored = safeParse(localStorage.getItem(TEMPLATES_KEY), {});
    return {
      confirmation: { ...defaultTemplates.confirmation, ...(stored.confirmation || {}) },
      ready: { ...defaultTemplates.ready, ...(stored.ready || {}) },
      receipt: { ...defaultTemplates.receipt, ...(stored.receipt || {}) }
    };
  }

  function saveTemplates(templates) {
    const current = getTemplates();
    const merged = {
      confirmation: { ...current.confirmation, ...(templates.confirmation || {}) },
      ready: { ...current.ready, ...(templates.ready || {}) },
      receipt: { ...current.receipt, ...(templates.receipt || {}) }
    };
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(merged));
  }

  function renderTemplate(text, data) {
    return String(text || '').replace(/\{\{(\w+)\}\}/g, (_, key) => {
      const val = data && data[key] != null ? data[key] : '';
      return String(val);
    });
  }

  function buildEmail(type, data) {
    const templates = getTemplates();
    const tpl = templates[type] || { subject: '', body: '' };
    const subject = renderTemplate(tpl.subject, data);
    const body = renderTemplate(tpl.body, data);
    return { subject, body };
  }

  function openMailto(to, subject, body) {
    const mailto = `mailto:${encodeURIComponent(to || '')}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
    window.location.href = mailto;
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {}
    return false;
  }

  async function sendViaServer(baseUrl, apiKey, to, subject, body) {
    if (!baseUrl) return false;
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers['x-api-key'] = apiKey;
      const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/send-email`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ to, subject, text: body })
      });
      return res.ok;
    } catch (e) {
      // Server not running / unreachable — caller falls back to mailto.
      return false;
    }
  }

  async function trigger(type, data) {
    const settings = getSettings();
    if (!settings.enabled) return;
    if (!settings[type]) return;

    const to = (data && data.email) ? data.email : '';
    const { subject, body } = buildEmail(type, data);

    if (to) {
      if (settings.autoSendServer && settings.apiBaseUrl) {
        const sent = await sendViaServer(settings.apiBaseUrl, settings.apiKey, to, subject, body);
        if (sent) return;
        // Fall through to mailto if the email server didn't respond.
      }
      openMailto(to, subject, body);
      return;
    }

    // No email on file — copy message for text/DM
    const msg = `SUBJECT: ${subject}\n\n${body}`;
    const ok = await copyToClipboard(msg);
    alert(ok
      ? "No customer email found. The message was copied to your clipboard."
      : "No customer email found. Copy this message manually:\n\n" + msg);
  }

  window.NotificationCenter = {
    getSettings,
    saveSettings,
    getTemplates,
    saveTemplates,
    buildEmail,
    trigger
  };
})();