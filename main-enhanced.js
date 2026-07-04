// =============================================================
// DetailPro CRM — Subscription-ready foundations (no billing yet)
// - Creates a single-business "Account" in localStorage on first run
// - Scopes ALL business data to that account via storage key prefixing
// - Provides legacy migration from older unscoped keys
// =============================================================

(function initSaaSFoundations(){
  try {
    // ---- Account (single business per "login") ----
    const ACCOUNT_KEY = 'dp_account_v1';
    // Legacy single-user key (kept for migration)
    const USER_KEY = 'dp_user_v1';
    // New account-scoped user system (no auth yet)
    const USERS_KEY = 'users';
    const CURRENT_USER_KEY = 'currentUserId';

    function uuid(){
      // RFC4122 v4-ish, good enough for client-side ids.
      // Be defensive: in some browser contexts `crypto` may be unavailable.
      const cobj = (typeof window !== 'undefined' && window.crypto)
        ? window.crypto
        : (typeof crypto !== 'undefined' ? crypto : null);

      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, ch => {
        const r = (cobj && typeof cobj.getRandomValues === 'function')
          ? (cobj.getRandomValues(new Uint8Array(1))[0] & 15)
          : Math.floor(Math.random() * 16);
        const v = (ch === 'x') ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });
    }

    function loadJSON(key, fallback){
      try { return JSON.parse(localStorage.getItem(key) || ''); }
      catch(e){ return fallback; }
    }

    function saveJSON(key, value){
      localStorage.setItem(key, JSON.stringify(value));
    }

    // ── Auth gate ──────────────────────────────────────────────────────────────────
    // If the user is not logged in, send them to login.html immediately.
    // login.html is excluded from this check so it can render freely.
    const IS_LOGIN_PAGE = (typeof location !== 'undefined') &&
      (location.pathname.endsWith('login.html') || location.pathname === '/login');

    function getStoredSession() {
      try { return JSON.parse(localStorage.getItem('dp_auth_session') || 'null'); }
      catch (e) { return null; }
    }

    if (!IS_LOGIN_PAGE && !getStoredSession()) {
      // Not authenticated — redirect before anything else renders.
      if (typeof location !== 'undefined') location.href = 'login.html';
      return; // stop this IIFE
    }

    function ensureAccount() {
      if (IS_LOGIN_PAGE) {
        // login.html handles its own flow; just expose minimal globals.
        window.DP_ACCOUNT = { id: 'login', businessName: 'DetailPro CRM', plan: 'free' };
        window.DP_ACCOUNT_ID = 'login';
        return window.DP_ACCOUNT;
      }

      const session = getStoredSession();
      if (!session || !session.account) {
        // Belt-and-suspenders: session was cleared between the check above
        // and here (very unlikely). Redirect rather than crash.
        if (typeof location !== 'undefined') location.href = 'login.html';
        return {};
      }

      const account = {
        id: session.account.id,
        businessName: session.account.businessName || 'My Detailing Business',
        plan: session.account.plan || 'free',
        email: session.user?.email || '',
      };

      window.DP_ACCOUNT = account;
      window.DP_ACCOUNT_ID = account.id;
      window.DP_USER_SESSION = session;
      return account;
    }

    function ensureUsersAndCurrentUser() {
      // With real auth, the logged-in user comes from the JWT session.
      // We keep this function to populate DP_USER/DP_ROLE so the rest of
      // the app (dpIsAdmin, dpCanDelete, etc.) works without changes.
      const session = window.DP_USER_SESSION || getStoredSession();
      const user = session?.user || { id: 'owner', name: 'Owner', role: 'admin' };

      window.DP_USER = user;
      window.DP_ROLE = user.role || 'admin';
      // DP_USERS is populated later by settings.html via /api/me if needed.
      window.DP_USERS = window.DP_USERS || [user];
      return user;
    }

    const account = ensureAccount();
    ensureUsersAndCurrentUser();

    // Pull latest data from the server in the background.
    // This means the page renders immediately from cached localStorage,
    // then silently updates if the server has newer data (e.g. changes made
    // on another device). We don't await — intentionally non-blocking.
    if (!IS_LOGIN_PAGE && typeof window.dpSync?.pull === 'function') {
      window.dpSync.pull().then(() => {
        // Dispatch a custom event so pages can react (e.g. re-render lists).
        try { window.dispatchEvent(new CustomEvent('dp:synced')); } catch(e) {}
      });
    }

    // ---- Scoped storage (multi-tenant ready) ----
    const SCOPED_KEYS = new Set([
      'customers','appointments','invoices',
      'services','addons','servicesCatalog','activities',
      'selectedServiceId','selectedCustomerId',
      'settings','uiPrefs',
      'reminderOutbox',
      // user system
      'users','currentUserId'
    ]);

    window.dpKey = function(key){
      return `dp_${account.id}__${key}`;
    };

    // Expose the unpatched storage and the key set so api-client.js can sync
    // without going through the monkeypatch (which would double-scope keys).
    window.DP_RAW_STORAGE = { getItem: _getItem.bind(localStorage), setItem: _setItem.bind(localStorage) };
    window.DP_SYNC_KEYS = SCOPED_KEYS;

    // Legacy migration: if old key exists and new scoped key missing, copy it over
    function migrateKey(key){
      const newKey = window.dpKey(key);
      const hasNew = localStorage.getItem(newKey) !== null;
      const hasOld = localStorage.getItem(key) !== null;
      if (!hasNew && hasOld) {
        try {
          localStorage.setItem(newKey, localStorage.getItem(key));
        } catch(e) {}
      }
    }

    SCOPED_KEYS.forEach(migrateKey);

    // Monkey patch localStorage so existing pages automatically become account-scoped
    const _getItem = Storage.prototype.getItem;
    const _setItem = Storage.prototype.setItem;
    const _removeItem = Storage.prototype.removeItem;

    Storage.prototype.getItem = function(key){
      try {
        if (SCOPED_KEYS.has(key) && window.dpKey) {
          const scoped = _getItem.call(this, window.dpKey(key));
          if (scoped !== null && scoped !== undefined) return scoped;
          // fallback to legacy key if scoped not present
          return _getItem.call(this, key);
        }
      } catch(e) {}
      return _getItem.call(this, key);
    };

    Storage.prototype.setItem = function(key, value){
      try {
        if (SCOPED_KEYS.has(key) && window.dpKey) {
          _setItem.call(this, window.dpKey(key), value);
          // Sync to server — debounced so rapid writes don't spam the API.
          if (typeof window.dpSync?.schedule === 'function') window.dpSync.schedule();
          return;
        }
      } catch(e) {}
      return _setItem.call(this, key, value);
    };

    Storage.prototype.removeItem = function(key){
      try {
        if (SCOPED_KEYS.has(key) && window.dpKey) {
          return _removeItem.call(this, window.dpKey(key));
        }
      } catch(e) {}
      return _removeItem.call(this, key);
    };

    // ---- Backup / restore (export everything as a downloadable JSON file) ----
    window.dpExportAllData = function(){
      const data = {};
      SCOPED_KEYS.forEach(key => {
        try { data[key] = JSON.parse(localStorage.getItem(key) || 'null'); }
        catch(e) { data[key] = null; }
      });
      const payload = {
        exportedAt: new Date().toISOString(),
        account: window.DP_ACCOUNT,
        data
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safeName = (window.DP_ACCOUNT?.businessName || 'detailpro').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      a.href = url;
      a.download = `${safeName}-backup-${new Date().toISOString().slice(0,10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return payload;
    };

    window.dpImportAllData = function(payload){
      try {
        const incoming = payload && payload.data ? payload.data : payload;
        if (!incoming || typeof incoming !== 'object') {
          return { ok: false, error: 'That file does not look like a DetailPro backup.' };
        }
        SCOPED_KEYS.forEach(key => {
          if (Object.prototype.hasOwnProperty.call(incoming, key) && incoming[key] != null) {
            localStorage.setItem(key, JSON.stringify(incoming[key]));
          }
        });
        return { ok: true };
      } catch(e) {
        return { ok: false, error: String(e?.message || e) };
      }
    };

    // User + permission helpers
    window.dpGetUsers = function(){
      try { return JSON.parse(localStorage.getItem('users') || '[]'); } catch(e) { return []; }
    };
    window.dpSaveUsers = function(users){
      try { localStorage.setItem('users', JSON.stringify(users || [])); } catch(e) {}
    };
    window.dpGetCurrentUserId = function(){
      try { return JSON.parse(localStorage.getItem('currentUserId') || 'null'); } catch(e) { return null; }
    };
    window.dpSetCurrentUserId = function(id){
      try { localStorage.setItem('currentUserId', JSON.stringify(id)); } catch(e) {}
      // refresh in-memory
      try {
        const users = window.dpGetUsers();
        const u = users.find(x => x.id === id) || users[0];
        window.DP_USERS = users;
        window.DP_USER = u;
        window.DP_ROLE = u?.role || 'admin';
      } catch(e) {}
    };
    window.dpGetCurrentUser = function(){
      try {
        const id = window.dpGetCurrentUserId();
        const users = window.dpGetUsers();
        return users.find(u => u.id === id) || users[0] || { role: 'admin' };
      } catch(e) { return { role: 'admin' }; }
    };
    window.dpIsAdmin = function(){
      try { return (window.dpGetCurrentUser()?.role || 'admin') === 'admin'; }
      catch(e){ return true; }
    };

    // Staff management helpers
    window.dpAddStaffUser = function(name){
      const n = (name || '').trim();
      if (!n) return { ok:false, error:'Name is required.' };
      const users = window.dpGetUsers();
      const staff = { id: uuid(), name: n, role: 'staff', createdAt: new Date().toISOString() };
      users.push(staff);
      window.dpSaveUsers(users);
      return { ok:true, user: staff };
    };
    window.dpRemoveUser = function(userId){
      const users = window.dpGetUsers();
      const target = users.find(u => u.id === userId);
      if (!target) return { ok:false, error:'User not found.' };
      if (target.role === 'admin') {
        const adminCount = users.filter(u => u.role === 'admin').length;
        if (adminCount <= 1) return { ok:false, error:'You must have at least one Admin.' };
      }
      const next = users.filter(u => u.id !== userId);
      window.dpSaveUsers(next);
      const cur = window.dpGetCurrentUserId();
      if (cur === userId) {
        const fallback = next[0]?.id || null;
        window.dpSetCurrentUserId(fallback);
      }
      return { ok:true };
    };

    // Centralized delete permission (kept for compatibility)
    window.dpCanDelete = function(){ return window.dpIsAdmin(); };

    // Centralized confirm helper
    window.dpConfirm = function(message){
      try { return confirm(message); } catch(e) { return true; }
    };

    // Plan gate helper (future Stripe)
    window.dpIsPro = function(){ return (window.DP_ACCOUNT?.plan || 'free') === 'pro'; };
    window.dpRequirePro = function(featureName){
      if (window.dpIsPro()) return true;
      alert(`${featureName || 'This feature'} is available on the Pro plan. (Billing not enabled yet.)`);
      return false;
    };
  } catch(e) {
    // If anything goes wrong here, fail open so the CRM still works.
    console.warn('SaaS foundation init failed:', e);
  }
})();

// -------------------------------------------------------------
// Session indicator — shows who is logged in and a logout button.
// Replaces the old dev-only user switcher now that real auth exists.
// -------------------------------------------------------------
(function sessionWidget() {
  const IS_LOGIN = (typeof location !== 'undefined') &&
    (location.pathname.endsWith('login.html') || location.pathname === '/login');
  if (IS_LOGIN) return;

  function inject() {
    try {
      if (document.getElementById('dp-session-widget')) return;
      const session = window.DP_USER_SESSION ||
        (() => { try { return JSON.parse(localStorage.getItem('dp_auth_session') || 'null'); } catch(e) { return null; } })();
      if (!session) return;

      const name = session.user?.name || 'You';
      const email = session.user?.email || '';

      const wrap = document.createElement('div');
      wrap.id = 'dp-session-widget';
      Object.assign(wrap.style, {
        position: 'fixed', right: '12px', bottom: '92px', zIndex: '9999',
        background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(8px)',
        border: '1px solid rgba(0,0,0,0.08)', borderRadius: '14px',
        boxShadow: '0 8px 24px rgba(0,0,0,0.07)', padding: '10px 14px',
        fontFamily: 'Inter, system-ui, sans-serif', fontSize: '12px',
        display: 'flex', alignItems: 'center', gap: '10px',
      });

      wrap.innerHTML = `
        <div>
          <div style="font-weight:600;color:#111827;">${name}</div>
          <div style="color:#6b7280;font-size:11px;">${email}</div>
        </div>
        <button id="dp-logout-btn" title="Sign out"
          style="padding:6px 10px;background:#f3f4f6;border:none;border-radius:10px;cursor:pointer;
                 color:#374151;font-size:12px;font-family:inherit;font-weight:500;">
          Sign out
        </button>`;

      document.body.appendChild(wrap);

      document.getElementById('dp-logout-btn').addEventListener('click', () => {
        if (typeof window.dpAuth?.logout === 'function') {
          window.dpAuth.logout();
        } else {
          localStorage.removeItem('dp_auth_token');
          localStorage.removeItem('dp_auth_session');
          location.href = 'login.html';
        }
      });
    } catch (e) { /* ignore */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();

// -------------------------------------------------------------
// Admin-only UI + page protection (future staff roles)
// - Hide invoices/services/notifications links when not admin
// - Block direct navigation to those pages when not admin
// -------------------------------------------------------------
(function adminGates(){
  function isAdmin(){
    try { return typeof window.dpIsAdmin === 'function' ? window.dpIsAdmin() : true; }
    catch(e){ return true; }
  }

  function enforcePageAccess(){
    if (isAdmin()) return;
    const page = (location.pathname || '').split('/').pop().toLowerCase();
    const adminOnlyPages = new Set(['invoices.html','services.html','notifications.html']);
    if (adminOnlyPages.has(page)) {
      try { alert('This page is available to Admin users only.'); } catch(e) {}
      location.replace('index.html');
    }
  }

  function hideAdminLinks(){
    if (isAdmin()) return;
    const adminOnlyHrefs = ['invoices.html','services.html','notifications.html'];
    document.querySelectorAll('a[href]').forEach(a => {
      const href = (a.getAttribute('href') || '').toLowerCase();
      if (adminOnlyHrefs.some(x => href.endsWith(x))) {
        a.style.display = 'none';
      }
    });

    // Also hide any explicit admin-only blocks if they exist
    document.querySelectorAll('[data-admin-only="true"]').forEach(el => {
      el.style.display = 'none';
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      try { enforcePageAccess(); } catch(e) {}
      try { hideAdminLinks(); } catch(e) {}
    });
  } else {
    try { enforcePageAccess(); } catch(e) {}
    try { hideAdminLinks(); } catch(e) {}
  }
})();

// ---- Core storage helpers (safe fallbacks) ----
if (typeof window.getCustomers !== 'function') {
  window.getCustomers = function() {
    try { return JSON.parse(localStorage.getItem('customers') || '[]'); } catch(e) { return []; }
  };
}
if (typeof window.getAppointments !== 'function') {
  window.getAppointments = function() {
    try { return JSON.parse(localStorage.getItem('appointments') || '[]'); } catch(e) { return []; }
  };
}
if (typeof window.getInvoices !== 'function') {
  window.getInvoices = function() {
    try { return JSON.parse(localStorage.getItem('invoices') || '[]'); } catch(e) { return []; }
  };
}

// Enhanced data protection and validation
const DataProtection = {
    
    // Validate customer data before saving
    validateCustomerData: function(data) {
        const errors = [];
        
        if (!data.firstName || data.firstName.trim().length < 2) {
            errors.push("First name must be at least 2 characters long");
        }
        
        if (!data.lastName || data.lastName.trim().length < 2) {
            errors.push("Last name must be at least 2 characters long");
        }
        
        if (!data.phone || !this.validatePhone(data.phone)) {
            errors.push("Valid phone number is required");
        }
        
        if (data.email && !this.validateEmail(data.email)) {
            errors.push("Please enter a valid email address");
        }
        
        if (data.vehicleYear && (data.vehicleYear < 1900 || data.vehicleYear > 2030)) {
            errors.push("Please enter a valid vehicle year (1900-2030)");
        }
        
        return errors;
    },
    
    // Validate appointment data
    validateAppointmentData: function(data) {
        const errors = [];
        
        if (!data.customer || data.customer.trim().length < 3) {
            errors.push("Customer name is required and must be at least 3 characters long");
        }
        
        if (!data.date) {
            errors.push("Appointment date is required");
        } else {
            const selectedDate = new Date(data.date);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            if (selectedDate < today) {
                errors.push("Cannot book appointments in the past");
            }
        }
        
        if (!data.time) {
            errors.push("Appointment time is required");
        }
        
        if (!data.service) {
            errors.push("Service selection is required");
        }
        
        return errors;
    },
    
    // Phone validation
    validatePhone: function(phone) {
        const cleanPhone = phone.replace(/[\s\-\(\)\.]/g, '');
        return cleanPhone.length >= 10;
    },
    
    // Email validation
    validateEmail: function(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    },
    
    // Show confirmation dialog
    confirmAction: function(message, callback) {
        if (confirm(message)) {
            callback();
        }
    },
    
    // Show detailed confirmation for critical actions
    confirmCriticalAction: function(action, itemName, callback) {
        const message = `Are you sure you want to ${action} "${itemName}"?\n\nThis action cannot be undone.`;
        this.confirmAction(message, callback);
    }
};

// Enhanced button handlers with protection
const ButtonHandlers = {
    
    // Customer management
    editCustomer: function(customerId) {
        DataProtection.confirmCriticalAction('edit', 'customer information', function() {
            showNotification('Edit functionality coming soon!', 'info');
        });
    },
    
    // Archive customer (soft delete). We keep historical data.
    deleteCustomer: function(customerId) {
        const customers = getCustomers();
        const customer = customers.find(c => String(c.id) === String(customerId));

        if (!customer) {
            showNotification('Customer not found', 'error');
            return;
        }

        const fullName = `${customer.firstName} ${customer.lastName}`.trim() || 'this customer';

        DataProtection.confirmAction(`Archive ${fullName}?\n\nYou can restore archived customers later.`, function() {
            const updated = customers.map(c => {
                if (String(c.id) !== String(customerId)) return c;
                return { ...c, archived: true, archivedAt: new Date().toISOString() };
            });
            localStorage.setItem('customers', JSON.stringify(updated));

            showNotification('Customer archived', 'success');
            if (typeof loadCustomers === 'function') loadCustomers();
        });
    },

    // Permanently delete an archived customer (hard delete). Also removes related appointments/invoices to prevent orphan records.
    permanentDeleteCustomer: function(customerId) {
        const customers = getCustomers();
        const customer = customers.find(c => String(c.id) === String(customerId));

        if (!customer) {
            showNotification('Customer not found', 'error');
            return;
        }

        const fullName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'this customer';

        DataProtection.confirmAction(
            `Permanently delete ${fullName}?\n\nThis will remove the customer and any linked appointments/invoices. This cannot be undone.`,
            function() {
                // Remove customer
                const updatedCustomers = customers.filter(c => String(c.id) !== String(customerId));
                localStorage.setItem('customers', JSON.stringify(updatedCustomers));

                // Remove related appointments
                try {
                    const appointments = (getAppointments() || []);
                    const updatedAppointments = appointments.filter(a => String(a.customerId) !== String(customerId));
                    localStorage.setItem('appointments', JSON.stringify(updatedAppointments));
                } catch (e) {}

                // Remove related invoices
                try {
                    const invoices = (getInvoices() || []);
                    const updatedInvoices = invoices.filter(inv => String(inv.customerId) !== String(customerId));
                    localStorage.setItem('invoices', JSON.stringify(updatedInvoices));
                } catch (e) {}

                showNotification('Customer deleted permanently', 'success');

                // Refresh UI if on customers page
                if (typeof loadCustomers === 'function') loadCustomers();
                if (typeof updateCustomerStats === 'function') {
                    try { updateCustomerStats((getCustomers() || [])); } catch (e) {}
                }
            }
        );
    },

    restoreCustomer: function(customerId) {
        const customers = getCustomers();
        const customer = customers.find(c => String(c.id) === String(customerId));
        if (!customer) {
            showNotification('Customer not found', 'error');
            return;
        }
        const fullName = `${customer.firstName} ${customer.lastName}`.trim() || 'this customer';
        DataProtection.confirmAction(`Restore ${fullName}?`, function() {
            const updated = customers.map(c => {
                if (String(c.id) !== String(customerId)) return c;
                const clone = { ...c };
                delete clone.archived;
                delete clone.archivedAt;
                return clone;
            });
            localStorage.setItem('customers', JSON.stringify(updated));
            showNotification('Customer restored', 'success');
            if (typeof loadCustomers === 'function') loadCustomers();
        });
    },

// Appointment management
    // Cancel appointment (soft delete) so history is preserved
    deleteAppointment: function(appointmentId) {
        const appointments = getAppointments();
        const appointment = appointments.find(apt => String(apt.id) === String(appointmentId));

        if (!appointment) {
            showNotification('Appointment not found', 'error');
            return;
        }

        DataProtection.confirmAction(`Cancel appointment for ${appointment.customer}?`, function() {
            const updated = appointments.map(apt => {
                if (String(apt.id) !== String(appointmentId)) return apt;
                return { ...apt, status: 'canceled', canceledAt: new Date().toISOString() };
            });
            localStorage.setItem('appointments', JSON.stringify(updated));

            showNotification('Appointment canceled', 'success');
            if (typeof loadAppointments === 'function') loadAppointments();
            // If we're on the appointments page, refresh calendar dots immediately
            try { if (typeof generateCalendar === 'function') generateCalendar(); } catch (e) {}
        });
    },
    
    updateAppointmentStatus: function(appointmentId) {
        const appointments = getAppointments();
        const appointment = appointments.find(apt => String(apt.id) === String(appointmentId));

        if (!appointment) {
            showNotification('Appointment not found', 'error');
            return;
        }

        const stages = ['scheduled','confirmed','in-progress','completed'];
        const labels = {
            'scheduled': 'Scheduled',
            'confirmed': 'Confirmed',
            'in-progress': 'In Progress',
            'completed': 'Completed'
        };

        const currentStatus = appointment.status || 'scheduled';
        const terminal = ['completed','no-show','canceled'];
        const currentIndex = Math.max(0, stages.indexOf(currentStatus));
        if (terminal.includes(currentStatus)) {
            showNotification(`Status is ${labels[currentStatus] || currentStatus} (no further changes)`, 'info');
            return;
        }
        const nextStatus = stages[Math.min(currentIndex + 1, stages.length - 1)];

        DataProtection.confirmAction(
            `Are you sure you want to move this appointment to "${labels[nextStatus]}"?`,
            function() {
                appointment.status = nextStatus;
                localStorage.setItem('appointments', JSON.stringify(appointments));
                
                showNotification(`Status updated to ${labels[nextStatus]}`, 'success');
                if (typeof loadAppointments === 'function') loadAppointments();
            }
        );
    }
};

// Override global functions with protected versions
if (typeof window.editCustomer === 'function') {
    window.editCustomer = ButtonHandlers.editCustomer;
}

if (typeof window.deleteCustomer === 'function') {
    window.deleteCustomer = ButtonHandlers.deleteCustomer;
}

if (typeof window.deleteAppointment === 'function') {
    window.deleteAppointment = ButtonHandlers.deleteAppointment;
}

if (typeof window.updateAppointmentStatus === 'function') {
    window.updateAppointmentStatus = ButtonHandlers.updateAppointmentStatus;
  window.permanentDeleteCustomer = ButtonHandlers.permanentDeleteCustomer;
  window.restoreCustomer = ButtonHandlers.restoreCustomer;
}
// === Local Storage Helpers ===
function saveData(key, data) {
  localStorage.setItem(key, JSON.stringify(data));
}

function loadData(key) {
  return JSON.parse(localStorage.getItem(key)) || [];
}


// === Expose handlers globally (fix script load order issues) ===
if (typeof window !== 'undefined') {
  window.ButtonHandlers = ButtonHandlers;
  window.editCustomer = ButtonHandlers.editCustomer;
  window.deleteCustomer = ButtonHandlers.deleteCustomer;
  window.deleteAppointment = ButtonHandlers.deleteAppointment;
  window.updateAppointmentStatus = ButtonHandlers.updateAppointmentStatus;
  window.permanentDeleteCustomer = ButtonHandlers.permanentDeleteCustomer;
  window.restoreCustomer = ButtonHandlers.restoreCustomer;
}

// === Global Search (Ctrl+K) ===
(function initGlobalSearch(){
  function ensureSearchModal(){
    if (document.getElementById('globalSearchModal')) return;
    const modal = document.createElement('div');
    modal.id = 'globalSearchModal';
    modal.className = 'fixed inset-0 bg-black/50 z-50 hidden';
    modal.innerHTML = `
      <div class="min-h-screen flex items-start justify-center p-4 pt-20">
        <div class="bg-white w-full max-w-xl rounded-2xl shadow-xl overflow-hidden">
          <div class="p-4 border-b border-gray-200 flex items-center gap-3">
            <i class="fas fa-search text-gray-400"></i>
            <input id="globalSearchInput" type="text" placeholder="Search customers, appointments, invoices..." class="w-full outline-none text-sm" />
            <button id="globalSearchClose" class="text-gray-400 hover:text-gray-600"><i class="fas fa-times"></i></button>
          </div>
          <div id="globalSearchResults" class="max-h-[60vh] overflow-y-auto p-2"></div>
          <div class="p-3 border-t border-gray-100 text-xs text-gray-500">Tip: Press <span class="font-mono">Esc</span> to close • <span class="font-mono">Ctrl+K</span> to open</div>
        </div>
      </div>`;
    document.body.appendChild(modal);

    const close = () => modal.classList.add('hidden');
    const open = () => {
      modal.classList.remove('hidden');
      const inp = document.getElementById('globalSearchInput');
      if (inp){ inp.value = ''; inp.focus(); renderResults(''); }
    };

    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
    document.getElementById('globalSearchClose')?.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){
        e.preventDefault();
        if (modal.classList.contains('hidden')) open(); else close();
      }
    });

    document.getElementById('globalSearchInput')?.addEventListener('input', (e) => {
      renderResults(e.target.value || '');
    });

    function norm(s){ return String(s||'').toLowerCase(); }

    function renderResults(query){
      const q = norm(query).trim();
      const resEl = document.getElementById('globalSearchResults');
      if (!resEl) return;
      if (!q){
        resEl.innerHTML = `<div class="p-4 text-sm text-gray-500">Type to search...</div>`;
        return;
      }

      const customers = (getCustomers()||[]);
      const appointments = (getAppointments()||[]);
      const invoices = (getInvoices()||[]);

      const customerMatches = customers.filter(c => {
        const full = `${c.firstName||''} ${c.lastName||''}`.trim();
        return norm(full).includes(q) || norm(c.phone).includes(q) || norm(c.email).includes(q) || norm(c.vehicleMake).includes(q) || norm(c.vehicleModel).includes(q);
      }).slice(0,5);

      const appointmentMatches = appointments.filter(a => {
        return norm(a.customer).includes(q) || norm(a.service).includes(q) || norm(a.date).includes(q) || norm(a.time).includes(q);
      }).slice(0,5);

      const invoiceMatches = invoices.filter(i => {
        return norm(i.customer).includes(q) || norm(i.invoiceNumber).includes(q);
      }).slice(0,5);

      const section = (title, itemsHtml) => itemsHtml ? `
        <div class="px-3 pt-3 pb-1 text-xs font-semibold text-gray-500 uppercase">${title}</div>
        <div class="px-2 pb-2">${itemsHtml}</div>` : '';

      const custHtml = customerMatches.map(c => {
        const full = `${c.firstName||''} ${c.lastName||''}`.trim() || 'Customer';
        const meta = [c.phone, c.vehicleMake, c.vehicleModel].filter(Boolean).join(' • ');
        const archivedTag = c.archived ? '<span class="ml-2 text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">Archived</span>' : '';
        const href = c.id ? `customer-profile.html?id=${encodeURIComponent(c.id)}` : 'customers.html';
        return `<a href="${href}" class="block p-3 rounded-xl hover:bg-gray-50">
          <div class="text-sm font-medium text-gray-900">${full}${archivedTag}</div>
          <div class="text-xs text-gray-500">${meta || ''}</div>
        </a>`;
      }).join('');

      const aptHtml = appointmentMatches.map(a => {
        return `<a href="appointments.html" class="block p-3 rounded-xl hover:bg-gray-50">
          <div class="text-sm font-medium text-gray-900">${a.customer || 'Appointment'}</div>
          <div class="text-xs text-gray-500">${[a.date,a.time,a.service].filter(Boolean).join(' • ')}</div>
        </a>`;
      }).join('');

      const invHtml = invoiceMatches.map(i => {
        return `<a href="invoices.html" class="block p-3 rounded-xl hover:bg-gray-50">
          <div class="text-sm font-medium text-gray-900">Invoice ${i.invoiceNumber || ''}</div>
          <div class="text-xs text-gray-500">${[i.customer, i.status].filter(Boolean).join(' • ')}</div>
        </a>`;
      }).join('');

      const html =
        section('Customers', custHtml) +
        section('Appointments', aptHtml) +
        section('Invoices', invHtml) ||
        `<div class="p-4 text-sm text-gray-500">No results.</div>`;

      resEl.innerHTML = html;
    }

    // Expose opener for optional buttons
    window.openGlobalSearch = open;
  }

  document.addEventListener('DOMContentLoaded', () => {
    try { ensureSearchModal(); } catch(e) {}
  });
})();

// ---- Admin-only pages + nav hiding (future staff roles) ----
(function adminVisibilityAndGuards(){
  const ADMIN_ONLY_PAGES = ['invoices.html','services.html','notifications.html'];

  function currentPage(){
    try {
      const p = (location.pathname || '').split('/').pop();
      return (p || '').toLowerCase();
    } catch(e){
      return '';
    }
  }

  function guardPage(){
    try {
      if (typeof window.dpIsAdmin !== 'function') return;
      if (window.dpIsAdmin()) return;
      const p = currentPage();
      if (ADMIN_ONLY_PAGES.includes(p)) {
        alert('This page is available to Admin users only.');
        window.location.href = 'index.html';
      }
    } catch(e) {}
  }

  function hideAdminOnlyNav(){
    try {
      if (typeof window.dpIsAdmin !== 'function') return;
      if (window.dpIsAdmin()) return;

      // Hide sidebar/nav links to admin-only pages
      document.querySelectorAll('a[href]').forEach(a => {
        const href = (a.getAttribute('href') || '').toLowerCase();
        if (!href) return;
        const base = href.split('#')[0].split('?')[0];
        if (ADMIN_ONLY_PAGES.includes(base)) {
          // Hide the whole nav item if possible
          const li = a.closest('li');
          if (li) li.style.display = 'none';
          else a.style.display = 'none';
        }
      });

      // Hide any explicit admin-only blocks
      document.querySelectorAll('[data-admin-only="true"]').forEach(el => {
        el.style.display = 'none';
      });
    } catch(e) {}
  }

  guardPage();
  document.addEventListener('DOMContentLoaded', () => {
    guardPage();
    hideAdminOnlyNav();
  });
})();


// -------------------------------------------------------------
// Pro Automated Email Reminders (no sending yet, $0 cost)
// - Stores due reminders into a local "outbox"
// - Marks appointment reminderStatus as 'due' when time is reached
// - Provides helpers to view/mark as sent (future email integration)
// -------------------------------------------------------------
(function dpReminderEngine(){
  function load(key, fallback){
    try { return JSON.parse(localStorage.getItem(key) || ''); } catch(e){ return fallback; }
  }
  function save(key, value){
    try { localStorage.setItem(key, JSON.stringify(value)); } catch(e) {}
  }
  function getAppointments(){ return load('appointments', []); }
  function setAppointments(apts){ save('appointments', apts); }
  function getCustomers(){ return load('customers', []); }
  function getOutbox(){ return load('reminderOutbox', []); }
  function setOutbox(items){ save('reminderOutbox', items); }

  // Email sending config (optional)
  function getEmailServerUrl(){
    return (localStorage.getItem('dpEmailServerUrl') || 'http://localhost:3333').trim();
  }
  function isEmailSendingEnabled(){
    // Default ON (when a server is running). Admins can disable via console.
    const v = (localStorage.getItem('dpEmailSendingEnabled') || 'true').toLowerCase();
    return v !== 'false' && v !== '0' && v !== 'no';
  }

  async function sendEmailViaServer(message){
    const url = getEmailServerUrl().replace(/\/$/, '') + '/api/send-email';
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Email server error (${res.status}) ${text}`.trim());
    }
    return res.json().catch(() => ({ ok: true }));
  }

  function normalizeName(n){ return String(n || '').trim().toLowerCase(); }

  function resolveCustomerEmail(fullName){
    const name = normalizeName(fullName);
    if (!name) return '';
    const customers = getCustomers();
    let match = customers.find(c => normalizeName(`${c.firstName||''} ${c.lastName||''}`) === name);
    if (!match) {
      match = customers.find(c => {
        const fn = normalizeName(c.firstName);
        const ln = normalizeName(c.lastName);
        return fn && ln && name.includes(fn) && name.includes(ln);
      });
    }
    const email = match?.email ? String(match.email).trim() : '';
    return email || '';
  }

  function buildReminderEmail(apt){
    const when = `${apt.date || ''} ${apt.time || ''}`.trim();
    const customer = apt.customer || 'Customer';
    const service = apt.service || 'your appointment';
    return {
      subject: `Reminder: ${service} on ${when}`,
      body:
`Hi ${customer},

Just a quick reminder about your appointment:

Service: ${service}
When: ${when}

If you need to reschedule, please reply to this email.

Thanks!
${window.DP_ACCOUNT?.businessName || 'DetailPro CRM'}`
    };
  }

  function process(){
    try {
      // Only meaningful on Pro, but we still "queue" due reminders if enabled.
      const now = Date.now();
      const apts = getAppointments();
      if (!Array.isArray(apts) || apts.length === 0) return;

      const outbox = getOutbox();
      const outboxKeys = new Set(outbox.map(x => x.key));

      let changed = false;
      let outChanged = false;

      for (const apt of apts) {
        if (!apt || !apt.reminderEnabled) continue;
        const st = String(apt.reminderStatus || 'scheduled').toLowerCase();
        if (st === 'sent') continue;

        const atISO = apt.reminderAt;
        const at = atISO ? Date.parse(atISO) : NaN;
        if (!isFinite(at)) continue;

        if (at <= now) {
          const key = `${apt.id}__${atISO}`;
          if (!outboxKeys.has(key)) {
            const toEmail = apt.reminderEmail || resolveCustomerEmail(apt.customer);
            const msg = buildReminderEmail(apt);
            outbox.push({
              id: `rem_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
              key,
              appointmentId: apt.id,
              toEmail,
              subject: msg.subject,
              body: msg.body,
              status: 'due',
              createdAt: new Date().toISOString()
            });
            outboxKeys.add(key);
            outChanged = true;
          }
          if (st !== 'due') {
            apt.reminderStatus = 'due';
            changed = true;
          }
        }
      }

      if (changed) setAppointments(apts);
      if (outChanged) setOutbox(outbox);
    } catch(e) {
      // fail open
    }
  }

  async function sendDue(){
    try {
      if (!isEmailSendingEnabled()) return;
      const outbox = getOutbox();
      const due = outbox.filter(x => x && x.status === 'due' && x.toEmail);
      if (due.length === 0) return;

      for (const item of due) {
        // mark as sending to avoid re-entrancy
        item.status = 'sending';
        item.sendingAt = new Date().toISOString();
        setOutbox(outbox);

        try {
          await sendEmailViaServer({
            to: item.toEmail,
            subject: item.subject,
            text: item.body,
            meta: { appointmentId: item.appointmentId, outboxId: item.id }
          });

          item.status = 'sent';
          item.sentAt = new Date().toISOString();
          setOutbox(outbox);

          const apts = getAppointments();
          const apt = apts.find(a => a.id === item.appointmentId);
          if (apt) {
            apt.reminderStatus = 'sent';
            apt.reminderSentAt = item.sentAt;
            setAppointments(apts);
          }
        } catch (err) {
          item.status = 'due';
          item.lastError = String(err?.message || err || 'Unknown error');
          item.lastErrorAt = new Date().toISOString();
          setOutbox(outbox);
          // Stop trying this tick if the server is down.
          if (/fetch|network|failed/i.test(item.lastError)) break;
        }
      }
    } catch(e) {
      // noop
    }
  }

  // Admin helpers
  window.dpSetEmailServerUrl = function(url){
    try { localStorage.setItem('dpEmailServerUrl', String(url || '').trim()); return true; } catch(e){ return false; }
  };
  window.dpSetEmailSendingEnabled = function(v){
    try { localStorage.setItem('dpEmailSendingEnabled', v ? 'true' : 'false'); return true; } catch(e){ return false; }
  };

  window.dpGetReminderOutbox = function(){ return getOutbox(); };
  window.dpMarkReminderSent = function(outboxId){
    try {
      const outbox = getOutbox();
      const item = outbox.find(x => x.id === outboxId);
      if (!item) return false;
      item.status = 'sent';
      item.sentAt = new Date().toISOString();
      setOutbox(outbox);

      const apts = getAppointments();
      const apt = apts.find(a => a.id === item.appointmentId);
      if (apt) {
        apt.reminderStatus = 'sent';
        apt.reminderSentAt = item.sentAt;
        setAppointments(apts);
      }
      return true;
    } catch(e) { return false; }
  };

  // Run on load + periodically while a page is open
  document.addEventListener('DOMContentLoaded', () => {
    process();
    sendDue();
    setInterval(() => { process(); sendDue(); }, 60 * 1000);
  });
})();
