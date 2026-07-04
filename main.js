/* DetailPro CRM - Dashboard (Overview) logic
   This file is intentionally self-contained and only used by index.html.
*/

// ===== Utilities =====
function pad2(n){ return String(n).padStart(2,'0'); }

function getLocalDateKey(dateObj=new Date()){
  return `${dateObj.getFullYear()}-${pad2(dateObj.getMonth()+1)}-${pad2(dateObj.getDate())}`;
}

function normalizeDateKey(value){
  if (!value) return null;
  if (typeof value === 'string'){
    // Prefer YYYY-MM-DD if present
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return getLocalDateKey(d);
}

function formatDatePretty(dateKey){
  if (!dateKey) return '';
  const m = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateKey;
  const d = new Date(Number(m[1]), Number(m[2])-1, Number(m[3]));
  return d.toLocaleDateString(undefined, { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}

function money(val){
  const num = Number(val || 0);
  return num.toLocaleString(undefined, { style:'currency', currency:'USD' });
}

function parseMoney(val){
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  const s = String(val).trim();
  if (!s) return 0;
  const cleaned = s.replace(/[^0-9.-]/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function safeText(v){ return (v===0 ? "0" : (v ? String(v) : "—")); }

function getStatusClass(status){
  const s = String(status || '').toLowerCase().replace(/\s+/g,'-');
  switch (s){
    case 'new-lead': return 'bg-gray-100 text-gray-700';
    case 'scheduled': return 'bg-blue-100 text-blue-700';
    case 'in-progress': return 'bg-yellow-100 text-yellow-700';
    case 'completed': return 'bg-green-100 text-green-700';
    case 'paid': return 'bg-purple-100 text-purple-700';
    default: return 'bg-blue-100 text-blue-700';
  }
}

function normalizeStatus(status){
  const s = String(status || '').toLowerCase().trim();
  if (!s) return 'scheduled';
  if (s === 'in progress') return 'in-progress';
  return s.replace(/\s+/g,'-');
}

// ===== Local Storage =====
function loadData(key){
  try { return JSON.parse(localStorage.getItem(key) || '[]'); }
  catch { return []; }
}

// ===== Modal helpers =====
function openModal(id){
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.remove('hidden');
}

function closeModal(id){
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('hidden');
}

// ===== Toast notification (non-blocking) =====
let __toastTimer = null;
function showNotification(message, type='info'){
  // Minimal toast so we don't rely on a specific DOM container
  const existing = document.getElementById('__toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = '__toast';
  toast.className = 'fixed top-4 right-4 z-[9999] rounded-xl shadow-lg px-4 py-3 text-sm max-w-[320px]';
  const cls = (type==='error') ? 'bg-red-600 text-white' :
              (type==='success') ? 'bg-green-600 text-white' :
              (type==='warning') ? 'bg-yellow-500 text-black' :
              'bg-gray-900 text-white';
  toast.classList.add(...cls.split(' '));
  toast.textContent = message;

  document.body.appendChild(toast);
  clearTimeout(__toastTimer);
  __toastTimer = setTimeout(() => toast.remove(), 3000);
}

// ===== Appointment info modal =====
function closeAppointmentInfo(){
  closeModal('appointmentInfoModal');
}

function openAppointmentInfo(appointmentId){
  const appointments = loadData('appointments');
  const customers = loadData('customers');

  const appointment = appointments.find(a => String(a.id) === String(appointmentId));
  if (!appointment){
    showNotification('Appointment not found', 'error');
    return;
  }

  const custName = String(appointment.customer || '').trim();
  const customer = customers.find(c => {
    const full = `${c.firstName || ''} ${c.lastName || ''}`.trim();
    return (full && full === custName) || String(c.id) === String(appointment.customerId || '');
  }) || {};

  const dateKey = normalizeDateKey(appointment.date) || '';
  const when = [formatDatePretty(dateKey), appointment.time || ''].filter(Boolean).join(' • ');
  const status = normalizeStatus(appointment.status);

  const vehicle = [
    customer.vehicleYear, customer.vehicleMake, customer.vehicleModel
  ].filter(Boolean).join(' ') || safeText(appointment.vehicle);

  const phone = customer.phone || '';
  const email = customer.email || '';

  const setText = (id,val) => { const el=document.getElementById(id); if(el) el.textContent = safeText(val); };
  setText('aptInfoCustomer', custName || `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unknown');
  setText('aptInfoWhen', when);
  setText('aptInfoStatus', status.charAt(0).toUpperCase() + status.slice(1));
  setText('aptInfoService', appointment.service || '');
  setText('aptInfoVehicle', vehicle);
  setText('aptInfoPhone', phone);
  setText('aptInfoEmail', email);
  setText('aptInfoNotes', appointment.notes || '');

  const callBtn = document.getElementById('aptInfoCallBtn');
  if (callBtn){
    if (phone){
      callBtn.classList.remove('opacity-50','pointer-events-none');
      callBtn.href = `tel:${phone.replace(/[^\d+]/g,'')}`;
    } else {
      callBtn.classList.add('opacity-50','pointer-events-none');
      callBtn.removeAttribute('href');
    }
  }

  const emailBtn = document.getElementById('aptInfoEmailBtn');
  if (emailBtn){
    if (email){
      emailBtn.classList.remove('opacity-50','pointer-events-none');
      emailBtn.href = `mailto:${email}`;
    } else {
      emailBtn.classList.add('opacity-50','pointer-events-none');
      emailBtn.removeAttribute('href');
    }
  }

  openModal('appointmentInfoModal');
}

// ===== Dashboard rendering =====
function updateDateHeader(){
  const el = document.getElementById('currentDate');
  if (!el) return;
  el.textContent = new Date().toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' });
}

function getTodayScheduledAppointments(){
  const todayKey = getLocalDateKey(new Date());
  const appointments = loadData('appointments')
    .map(a => ({...a, _dateKey: normalizeDateKey(a.date), _status: normalizeStatus(a.status)}));

  return appointments
    .filter(a => a._dateKey === todayKey && a._status === 'scheduled')
    .sort((a,b) => String(a.time || '').localeCompare(String(b.time || '')));
}

function updateMetrics(){
  const today = getTodayScheduledAppointments();

  const revenue = today.reduce((sum,a) => sum + Number(a.totalPrice || a.price || 0), 0);
  const inProgress = loadData('appointments')
    .map(a => ({...a, _dateKey: normalizeDateKey(a.date), _status: normalizeStatus(a.status)}))
    .filter(a => a._dateKey === getLocalDateKey(new Date()) && a._status === 'in-progress').length;

  const revEl = document.getElementById('todayRevenue');
  const revSub = document.getElementById('todayRevenueSub');
  const apptEl = document.getElementById('todayAppointments');
  const apptSub = document.getElementById('todayAppointmentsSub');
  const activeEl = document.getElementById('activeJobs');
  const activeSub = document.getElementById('activeJobsSub');

  if (revEl) revEl.textContent = money(revenue);
  if (revSub) revSub.textContent = `${today.length} scheduled today`;

  if (apptEl) apptEl.textContent = String(today.length);
  if (apptSub) apptSub.textContent = 'Scheduled jobs';

  if (activeEl) activeEl.textContent = String(inProgress);
  if (activeSub) activeSub.textContent = 'In progress today';
}

function loadTodaySchedule(){
  const container = document.getElementById('todaySchedule');
  if (!container) return;

  const today = getTodayScheduledAppointments();

  if (today.length === 0){
    container.innerHTML = `
      <div class="text-center py-8 text-gray-500">
        No scheduled jobs for today.
      </div>
    `;
    return;
  }

  container.innerHTML = today.map(a => {
    const price = Number(a.totalPrice || a.price || 0);
    const status = normalizeStatus(a.status);
    return `
      <div class="bg-white rounded-2xl shadow-sm p-4 border border-gray-100 hover:shadow-md transition cursor-pointer"
           data-apt-id="${String(a.id)}">
        <div class="flex items-start justify-between">
          <div>
            <div class="font-semibold text-gray-900">${(a.customer || 'Unknown')}</div>
            <div class="text-sm text-gray-600">${(a.service || '')}${a.time ? ` • ${a.time}` : ''}</div>
          </div>
          <div class="text-right">
            <div class="text-sm font-semibold text-gray-900">${money(price)}</div>
            <div class="inline-flex mt-1 px-2 py-0.5 rounded-full text-xs font-medium ${getStatusClass(status)}">
              ${status.charAt(0).toUpperCase()+status.slice(1)}
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Click handler (event delegation)
  container.addEventListener('click', (e) => {
    const card = e.target.closest('[data-apt-id]');
    if (!card) return;
    openAppointmentInfo(card.getAttribute('data-apt-id'));
  }, { once: true });
}

// ===== Weekly Analytics =====
function startOfWeek(dateObj, weekStartsMonday=true){
  const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  const day = d.getDay(); // 0=Sun
  const diff = weekStartsMonday
    ? (day === 0 ? -6 : 1 - day)
    : (0 - day);
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
}

function addDays(dateObj, days){
  const d = new Date(dateObj.getTime());
  d.setDate(d.getDate() + days);
  return d;
}

function dateKeyFromDateObj(d){
  return getLocalDateKey(d);
}

function formatRangeLabel(startDateObj){
  const end = addDays(startDateObj, 6);
  const fmt = (x) => x.toLocaleDateString(undefined, { month:'short', day:'numeric' });
  return `${fmt(startDateObj)} – ${fmt(end)}`;
}

function buildRecentWeeks(count=8){
  const now = new Date();
  const thisWeekStart = startOfWeek(now, true);
  const weeks = [];
  for (let i = count - 1; i >= 0; i--){
    const s = addDays(thisWeekStart, -7 * i);
    weeks.push({ start: s, startKey: dateKeyFromDateObj(s), label: formatRangeLabel(s) });
  }
  return weeks;
}

function inRange(dateKey, startKey, endKeyInclusive){
  return !!dateKey && dateKey >= startKey && dateKey <= endKeyInclusive;
}

function groupByDayKeys(startDateObj){
  const keys = [];
  for (let i = 0; i < 7; i++) keys.push(dateKeyFromDateObj(addDays(startDateObj, i)));
  return keys;
}

function computeWeeklySnapshot(weekStart){
  const startKey = dateKeyFromDateObj(weekStart);
  const endKey = dateKeyFromDateObj(addDays(weekStart, 6));

  const appointments = loadData('appointments')
    .map(a => ({
      ...a,
      _dateKey: normalizeDateKey(a.date),
      _status: normalizeStatus(a.status)
    }))
    .filter(a => inRange(a._dateKey, startKey, endKey));

  const invoices = loadData('invoices')
    .map(inv => ({
      ...inv,
      _dateKey: normalizeDateKey(inv.createdAt || inv.date || inv.created || inv.timestamp),
      _status: normalizeStatus(inv.status)
    }))
    .filter(inv => inRange(inv._dateKey, startKey, endKey));

  const customers = loadData('customers')
    .map(c => ({...c, _dateKey: normalizeDateKey(c.createdAt || c.created || c.dateCreated)}))
    .filter(c => inRange(c._dateKey, startKey, endKey));

  const counts = { scheduled:0, 'in-progress':0, completed:0, cancelled:0, 'no-show':0, other:0 };
  for (const a of appointments){
    const s = a._status;
    if (counts[s] !== undefined) counts[s]++;
    else counts.other++;
  }

  const totalAppointments = appointments.length;
  const completed = counts.completed || 0;
  const completionRate = totalAppointments ? Math.round((completed / totalAppointments) * 100) : 0;

  const invoicedTotal = invoices.reduce((sum, inv) => sum + parseMoney(inv.total || inv.amount || inv.totalAmount || inv.balance), 0);
  const paidTotal = invoices
    .filter(inv => normalizeStatus(inv.status) === 'paid')
    .reduce((sum, inv) => sum + parseMoney(inv.total || inv.amount || inv.totalAmount || inv.balance), 0);

  const avgTicket = invoices.length ? (invoicedTotal / invoices.length) : 0;

  // Day-by-day for chart
  const dayKeys = groupByDayKeys(weekStart);
  const dayBuckets = {};
  for (const k of dayKeys){
    dayBuckets[k] = {
      scheduled:0,
      'in-progress':0,
      completed:0,
      cancelled:0,
      revenue:0
    };
  }

  for (const a of appointments){
    const k = a._dateKey;
    if (!dayBuckets[k]) continue;
    const s = a._status;
    if (dayBuckets[k][s] !== undefined) dayBuckets[k][s]++;
  }

  for (const inv of invoices){
    const k = inv._dateKey;
    if (!dayBuckets[k]) continue;
    dayBuckets[k].revenue += parseMoney(inv.total || inv.amount || inv.totalAmount || inv.balance);
  }

  return {
    startKey,
    endKey,
    counts,
    totalAppointments,
    completed,
    completionRate,
    invoicedTotal,
    paidTotal,
    avgTicket,
    newCustomers: customers.length,
    dayKeys,
    dayBuckets
  };
}

function renderWeeklyAnalytics(){
  const chartEl = document.getElementById('revenueChart');
  const selectEl = document.getElementById('weekRangeSelect');
  if (!chartEl || !selectEl || typeof echarts === 'undefined') return;

  const weeks = buildRecentWeeks(8);
  // Populate once
  if (!selectEl.__populated){
    selectEl.innerHTML = weeks.map(w => `<option value="${w.startKey}">${w.label}</option>`).join('');
    selectEl.value = weeks[weeks.length-1].startKey;
    selectEl.__populated = true;
  }

  const selectedKey = selectEl.value || weeks[weeks.length-1].startKey;
  const selected = weeks.find(w => w.startKey === selectedKey) || weeks[weeks.length-1];
  const snap = computeWeeklySnapshot(selected.start);

  // KPIs
  const set = (id, val) => { const el=document.getElementById(id); if(el) el.textContent = val; };
  set('wkAppointments', String(snap.totalAppointments));
  set('wkAppointmentsSub', `${snap.counts.scheduled || 0} scheduled • ${snap.counts['in-progress'] || 0} in progress • ${snap.counts.cancelled || 0} cancelled`);
  set('wkCompleted', String(snap.completed));
  set('wkCompletionRate', snap.totalAppointments ? `${snap.completionRate}% completion` : '—');
  set('wkInvoiced', money(snap.invoicedTotal));
  set('wkPaidSub', `Paid: ${money(snap.paidTotal)}`);
  set('wkAvgTicket', money(snap.avgTicket));
  set('wkNewCustomers', `New customers: ${snap.newCustomers}`);

  const hint = document.getElementById('wkChartHint');
  if (hint){
    hint.textContent = `Appointments are grouped by status (bars). Revenue is total invoiced per day (line).`;
  }

  // Chart
  const xLabels = snap.dayKeys.map(k => {
    const d = new Date(k + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday:'short' });
  });
  const seriesScheduled = snap.dayKeys.map(k => snap.dayBuckets[k].scheduled);
  const seriesProgress = snap.dayKeys.map(k => snap.dayBuckets[k]['in-progress']);
  const seriesCompleted = snap.dayKeys.map(k => snap.dayBuckets[k].completed);
  const seriesCancelled = snap.dayKeys.map(k => snap.dayBuckets[k].cancelled);
  const seriesRevenue = snap.dayKeys.map(k => snap.dayBuckets[k].revenue);

  const chart = echarts.init(chartEl);
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['Scheduled','In Progress','Completed','Cancelled','Revenue'] },
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    xAxis: { type: 'category', data: xLabels },
    yAxis: [
      { type: 'value', name: 'Jobs' },
      { type: 'value', name: 'Revenue', axisLabel: { formatter: (v) => `$${v}` } }
    ],
    series: [
      { name: 'Scheduled', type: 'bar', stack: 'jobs', data: seriesScheduled },
      { name: 'In Progress', type: 'bar', stack: 'jobs', data: seriesProgress },
      { name: 'Completed', type: 'bar', stack: 'jobs', data: seriesCompleted },
      { name: 'Cancelled', type: 'bar', stack: 'jobs', data: seriesCancelled },
      { name: 'Revenue', type: 'line', yAxisIndex: 1, data: seriesRevenue, smooth: true }
    ]
  }, true);

  window.addEventListener('resize', () => {
    try { chart.resize(); } catch(e) {}
  }, { once: true });

  if (!selectEl.__bound){
    selectEl.addEventListener('change', () => {
      try { renderWeeklyAnalytics(); } catch(e) {}
    });
    selectEl.__bound = true;
  }
}

function initializeDashboard(){
  updateDateHeader();
  updateMetrics();
  loadTodaySchedule();
  renderWeeklyAnalytics();
}

// Run on load
document.addEventListener('DOMContentLoaded', () => {
  try { initializeDashboard(); }
  catch (e){
    console.error(e);
    showNotification('Dashboard script error — check console.', 'error');
  }
});
