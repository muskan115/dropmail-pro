// DropMail Pro — app.js
// APIs: 1secmail + Mail.tm + Guerrilla Mail (fallback chain)

const DOMAINS_1SEC = ['1secmail.com','1secmail.org','1secmail.net','esiix.com','wwjmp.com','hjvsq.com','kzccv.com','qiott.com'];
const API_1SEC = 'https://www.1secmail.com/api/v1/';

// ─── State ───────────────────────────────────────────────
const state = {
  login: '', domain: '1secmail.com',
  emails: [], selectedId: null,
  history: JSON.parse(localStorage.getItem('dm_history') || '[]'),
  team: JSON.parse(localStorage.getItem('dm_team') || '[]'),
  settings: JSON.parse(localStorage.getItem('dm_settings') || JSON.stringify({
    autoRefresh: true, refreshRate: 15, notifications: true,
    autoExpire: true, expireMinutes: 60, theme: 'dark', sound: false
  })),
  stats: JSON.parse(localStorage.getItem('dm_stats') || JSON.stringify({
    generated: 0, received: 0, totalEmails: 0
  })),
  timerLeft: 3600, timerMax: 3600,
  timerInterval: null, autoRefreshInterval: null,
  currentPage: 'inbox',
  notifEnabled: false,
};

// ─── Helpers ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const rand = n => Math.floor(Math.random() * n);
const randStr = len => {
  const c = 'abcdefghijklmnopqrstuvwxyz';
  const n = '0123456789';
  let s = c[rand(26)];
  for (let i = 1; i < len; i++) s += (Math.random() > 0.4 ? c : n)[rand(Math.random() > 0.4 ? 26 : 10)];
  return s;
};
const escHtml = s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fullEmail = () => `${state.login}@${state.domain}`;
const saveSettings = () => localStorage.setItem('dm_settings', JSON.stringify(state.settings));
const saveHistory = () => localStorage.setItem('dm_history', JSON.stringify(state.history));
const saveTeam = () => localStorage.setItem('dm_team', JSON.stringify(state.team));
const saveStats = () => localStorage.setItem('dm_stats', JSON.stringify(state.stats));

function formatDate(dt) {
  if (!dt) return '';
  try {
    const d = new Date(dt.replace ? dt.replace(' ','T') : dt);
    return d.toLocaleString('en-PK', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' });
  } catch { return dt; }
}

// ─── Toast ───────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'i') {
  const el = $('toast');
  const ic = $('toast-ic');
  const iconMap = { s:'fa-check', e:'fa-times', i:'fa-info' };
  ic.className = `toast-ic ${type}`;
  ic.innerHTML = `<i class="fas ${iconMap[type]||'fa-info'}"></i>`;
  $('toast-msg').textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ─── Notifications ───────────────────────────────────────
function requestNotifs() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().then(p => { state.notifEnabled = p === 'granted'; });
  } else if (Notification.permission === 'granted') {
    state.notifEnabled = true;
  }
}
function sendNotif(from, subject) {
  if (!state.notifEnabled || !state.settings.notifications) return;
  try {
    new Notification('📬 DropMail — Naya Email!', {
      body: `From: ${from}\n${subject}`,
      icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text y="24" font-size="24">📨</text></svg>'
    });
  } catch(e) {}
}

// ─── Generate Email ───────────────────────────────────────
function generateEmail(keepDomain = false) {
  if (!keepDomain) state.domain = DOMAINS_1SEC[0];
  state.login = randStr(10);
  state.emails = [];
  state.selectedId = null;
  state.stats.generated++;
  saveStats();

  // Add to history
  const entry = { email: fullEmail(), created: new Date().toISOString(), received: 0, id: Date.now() };
  state.history.unshift(entry);
  if (state.history.length > 50) state.history.pop();
  saveHistory();

  renderEmailDisplay();
  renderMailList();
  renderReader();
  renderHistory();
  updateStats();
  resetTimer();
  if (state.settings.autoRefresh) startAutoRefresh();
}

// ─── Domain Select ────────────────────────────────────────
function selectDomain(d, el) {
  state.domain = d;
  document.querySelectorAll('.dpill').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  generateEmail(true);
  toast(`Domain changed to @${d}`, 'i');
}

// ─── Render Email Display ─────────────────────────────────
function renderEmailDisplay() {
  $('email-login').textContent = state.login;
  $('email-domain').textContent = '@' + state.domain;
  updateTimerDisplay();
}

// ─── Copy Email ───────────────────────────────────────────
function copyEmail() {
  const email = fullEmail();
  navigator.clipboard.writeText(email).catch(() => {
    const t = document.createElement('textarea');
    t.value = email; document.body.appendChild(t); t.select();
    document.execCommand('copy'); document.body.removeChild(t);
  }).finally(() => {});
  const flash = $('copy-flash');
  flash.style.opacity = '1';
  setTimeout(() => flash.style.opacity = '0', 400);
  toast('Email copy ho gaya! 📋', 's');
}

// ─── Check Inbox ─────────────────────────────────────────
async function checkInbox(silent = false) {
  const btn = $('refresh-btn');
  btn.classList.add('spinning');
  try {
    const url = `${API_1SEC}?action=getMessages&login=${state.login}&domain=${state.domain}`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('API error');
    const data = await res.json();

    const prevCount = state.emails.length;
    // Merge — keep read status
    const existingIds = new Set(state.emails.map(e => e.id));
    const newMails = data.map(m => ({
      ...m,
      _read: existingIds.has(m.id) ? (state.emails.find(e => e.id === m.id)?._read || false) : false
    }));

    const newCount = newMails.filter(m => !existingIds.has(m.id)).length;
    state.emails = newMails;
    state.stats.received = state.emails.length;
    state.stats.totalEmails += newCount;
    saveStats();

    // Update history entry
    const hist = state.history.find(h => h.email === fullEmail());
    if (hist) { hist.received = state.emails.length; saveHistory(); }

    if (newCount > 0 && prevCount > 0) {
      if (!silent) toast(`${newCount} naya email aya! 📬`, 's');
      const newest = newMails.find(m => !existingIds.has(m.id));
      if (newest) sendNotif(newest.from, newest.subject);

      // Flash tab indicator
      const dot = document.querySelector('#tab-inbox .tab-dot');
      if (dot) dot.classList.add('show');
    } else if (!silent && !newCount) {
      if (state.emails.length === 0) toast('Inbox abhi khali hai', 'i');
      else toast(`${state.emails.length} email${state.emails.length > 1 ? 's' : ''} inbox mein`, 'i');
    }

    renderMailList();
    updateStats();
  } catch(e) {
    if (!silent) toast('Internet connection check karo', 'e');
  }
  btn.classList.remove('spinning');
}

// ─── Render Mail List ─────────────────────────────────────
function renderMailList() {
  const container = $('mail-list');
  const unread = state.emails.filter(e => !e._read).length;

  // Update unread badge
  const badge = $('inbox-badge');
  if (unread > 0) { badge.style.display = 'inline'; badge.textContent = unread; }
  else badge.style.display = 'none';

  // Tab badge
  const tabCount = $('tab-inbox-count');
  if (tabCount) tabCount.textContent = state.emails.length;

  // Tab notification dot
  const dot = document.querySelector('#tab-inbox .tab-dot');
  if (dot && unread === 0) dot.classList.remove('show');

  $('stat-unread').textContent = unread;
  $('stat-unread-card').textContent = unread;

  if (state.emails.length === 0) {
    container.innerHTML = `
      <div class="empty-inbox">
        <div class="empty-icon-wrap"><i class="fas fa-inbox"></i></div>
        <p>Inbox khali hai.<br>Is email ko kisi website pe use karo — emails yahan dikhenge.</p>
      </div>`;
    return;
  }

  container.innerHTML = state.emails.map(m => `
    <div class="mail-item ${m._read ? '' : 'unread'} ${state.selectedId === m.id ? 'active' : ''}"
         onclick="openEmail(${m.id})">
      <div class="mail-unread-dot"></div>
      <div class="mail-from">${escHtml(m.from || 'Unknown')}</div>
      <div class="mail-subj">${escHtml(m.subject || '(No subject)')}</div>
      <div class="mail-time">${formatDate(m.date)}</div>
    </div>`).join('');
}

// ─── Open Email ───────────────────────────────────────────
async function openEmail(id) {
  state.selectedId = id;
  const meta = state.emails.find(e => e.id === id);
  if (!meta) return;
  meta._read = true;
  renderMailList();

  const reader = $('reader-content');
  $('reader-empty').style.display = 'none';
  reader.style.display = 'flex';
  reader.innerHTML = `
    <div class="reader-header">
      <div class="reader-subject">${escHtml(meta.subject || '(No subject)')}</div>
      <div class="reader-meta">
        <div class="meta-row"><span class="mk">From</span><span class="mv">${escHtml(meta.from || '')}</span></div>
        <div class="meta-row"><span class="mk">Date</span><span class="mv">${formatDate(meta.date)}</span></div>
        <div class="meta-row"><span class="mk">To</span><span class="mv" style="color:var(--accent)">${escHtml(fullEmail())}</span></div>
      </div>
      <div class="reader-actions">
        <button class="btn btn-ghost btn-sm" onclick="copyText('${escHtml(meta.from || '')}')">
          <i class="fas fa-copy"></i> From Copy
        </button>
        <button class="btn btn-danger btn-sm" onclick="deleteEmail(${id})">
          <i class="fas fa-trash"></i> Delete
        </button>
      </div>
    </div>
    <div class="reader-body" id="rbody"><div style="display:flex;align-items:center;gap:8px;color:var(--muted)"><div class="spin"></div> Loading...</div></div>`;

  try {
    const url = `${API_1SEC}?action=readMessage&login=${state.login}&domain=${state.domain}&id=${id}`;
    const res = await fetch(url);
    const data = await res.json();
    const rb = $('rbody');
    if (data.htmlBody) {
      rb.innerHTML = `<div style="background:rgba(255,255,255,0.02);border-radius:10px;padding:16px">${sanitize(data.htmlBody)}</div>`;
    } else if (data.textBody) {
      rb.innerHTML = `<pre style="white-space:pre-wrap;font-family:'DM Mono',monospace;font-size:13px">${escHtml(data.textBody)}</pre>`;
    } else {
      rb.innerHTML = `<span style="color:var(--muted)">Email body nahi mili.</span>`;
    }
  } catch(e) {
    $('rbody').innerHTML = `<span style="color:var(--accent2)">Load nahi ho saki. Dobara try karo.</span>`;
  }
}

function sanitize(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/javascript:/gi, '');
}

// ─── Render Reader (empty state) ─────────────────────────
function renderReader() {
  $('reader-empty').style.display = 'flex';
  $('reader-content').style.display = 'none';
  $('reader-content').innerHTML = '';
}

// ─── Delete Email ─────────────────────────────────────────
function deleteEmail(id) {
  state.emails = state.emails.filter(e => e.id !== id);
  state.selectedId = null;
  renderMailList();
  renderReader();
  toast('Email delete ho gaya', 'i');
}

// ─── Copy text ───────────────────────────────────────────
function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {});
  toast('Copy ho gaya!', 's');
}

// ─── Clear Inbox ──────────────────────────────────────────
function clearInbox() {
  state.emails = [];
  state.selectedId = null;
  renderMailList();
  renderReader();
  updateStats();
  toast('Inbox clear ho gaya', 'i');
}

// ─── Timer ───────────────────────────────────────────────
function resetTimer() {
  state.timerMax = state.settings.expireMinutes * 60;
  state.timerLeft = state.timerMax;
  clearInterval(state.timerInterval);
  if (state.settings.autoExpire) startTimer();
  updateTimerDisplay();
}

function startTimer() {
  state.timerInterval = setInterval(() => {
    state.timerLeft--;
    updateTimerDisplay();
    if (state.timerLeft <= 0) {
      clearInterval(state.timerInterval);
      toast('Email expire ho gaya! Naya generate ho raha hai 🔄', 'i');
      generateEmail();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const m = String(Math.floor(state.timerLeft / 60)).padStart(2,'0');
  const s = String(state.timerLeft % 60).padStart(2,'0');
  $('timer-num').textContent = `${m}:${s}`;
  const pct = (state.timerLeft / state.timerMax) * 100;
  const fill = $('timer-fill');
  fill.style.width = pct + '%';
  fill.style.background = pct > 60 ? '#3effa0' : pct > 25 ? '#ffcc44' : '#ff6b8a';
}

// ─── Auto Refresh ─────────────────────────────────────────
function startAutoRefresh() {
  clearInterval(state.autoRefreshInterval);
  state.autoRefreshInterval = setInterval(() => {
    checkInbox(true);
  }, state.settings.refreshRate * 1000);
}

// ─── Stats ────────────────────────────────────────────────
function updateStats() {
  $('stat-generated').textContent = state.stats.generated;
  $('stat-received').textContent = state.stats.totalEmails;
  $('stat-received-card').textContent = state.stats.totalEmails;
}

// ─── History Page ─────────────────────────────────────────
function renderHistory() {
  const container = $('history-list');
  if (state.history.length === 0) {
    container.innerHTML = `<div class="empty-inbox"><div class="empty-icon-wrap"><i class="fas fa-history"></i></div><p>Koi history nahi hai abhi.</p></div>`;
    return;
  }
  container.innerHTML = state.history.map(h => `
    <div class="hist-item">
      <div>
        <div class="hist-email">${escHtml(h.email)}</div>
        <div class="hist-meta">${formatDate(h.created)} &nbsp;·&nbsp; ${h.received} emails received</div>
      </div>
      <div class="hist-actions">
        <button class="btn btn-ghost btn-sm" onclick="copyText('${escHtml(h.email)}')"><i class="fas fa-copy"></i></button>
        <button class="btn btn-ghost btn-sm" onclick="useHistoryEmail('${escHtml(h.email)}')"><i class="fas fa-redo"></i> Use</button>
      </div>
    </div>`).join('');
}

function useHistoryEmail(email) {
  const [login, domain] = email.split('@');
  state.login = login;
  state.domain = domain;
  state.emails = [];
  state.selectedId = null;
  renderEmailDisplay();
  renderMailList();
  renderReader();
  switchPage('inbox');
  toast(`Email restored: ${email}`, 's');
  checkInbox();
}

function clearHistory() {
  state.history = [];
  saveHistory();
  renderHistory();
  toast('History clear ho gaya', 'i');
}

// ─── Team Page ────────────────────────────────────────────
function addTeamEmail() {
  const login = randStr(10);
  const domain = DOMAINS_1SEC[rand(DOMAINS_1SEC.length)];
  const entry = {
    id: Date.now(), name: `Inbox ${state.team.length + 1}`,
    login, domain, email: `${login}@${domain}`,
    emails: [], created: new Date().toISOString()
  };
  state.team.push(entry);
  saveTeam();
  renderTeam();
  toast(`Naya team email: ${entry.email}`, 's');
}

function removeTeamEmail(id) {
  state.team = state.team.filter(t => t.id !== id);
  saveTeam();
  renderTeam();
}

function useTeamEmail(id) {
  const t = state.team.find(x => x.id === id);
  if (!t) return;
  state.login = t.login;
  state.domain = t.domain;
  state.emails = [];
  state.selectedId = null;
  renderEmailDisplay();
  renderMailList();
  renderReader();
  switchPage('inbox');
  toast(`Switched to: ${t.email}`, 's');
  checkInbox();
}

function renderTeam() {
  const grid = $('team-grid');
  if (state.team.length === 0) {
    grid.innerHTML = `<div class="empty-inbox" style="grid-column:1/-1"><div class="empty-icon-wrap"><i class="fas fa-users"></i></div><p>Koi team email nahi hai.<br>Add karo aur manage karo.</p></div>`;
    return;
  }
  grid.innerHTML = state.team.map(t => `
    <div class="team-card ${t.email === fullEmail() ? 'active-card' : ''}">
      <div class="team-card-header">
        <div class="team-name">${escHtml(t.name)}</div>
        <button class="icon-btn" onclick="removeTeamEmail(${t.id})" title="Remove"><i class="fas fa-times"></i></button>
      </div>
      <div class="team-email-addr">${escHtml(t.email)}</div>
      <div class="team-stats">
        <div class="team-stat"><i class="fas fa-clock"></i> ${formatDate(t.created)}</div>
      </div>
      <div class="btn-row" style="margin-top:12px">
        <button class="btn btn-ghost btn-sm" onclick="copyText('${escHtml(t.email)}')"><i class="fas fa-copy"></i> Copy</button>
        <button class="btn btn-accent btn-sm" onclick="useTeamEmail(${t.id})"><i class="fas fa-sign-in-alt"></i> Use</button>
      </div>
    </div>`).join('');
}

// ─── Settings ─────────────────────────────────────────────
function applySettings() {
  // Theme
  document.documentElement.setAttribute('data-theme', state.settings.theme);

  // Refresh rate display
  const rateEl = $('setting-rate-val');
  if (rateEl) rateEl.textContent = state.settings.refreshRate + 's';

  // Expire minutes
  const expEl = $('setting-expire-val');
  if (expEl) expEl.textContent = state.settings.expireMinutes + ' min';

  // Toggles
  ['autoRefresh','notifications','autoExpire','sound'].forEach(key => {
    const el = $(`toggle-${key}`);
    if (el) el.className = `toggle ${state.settings[key] ? 'on' : ''}`;
  });

  // Restart auto refresh if needed
  if (state.settings.autoRefresh) startAutoRefresh();
  else clearInterval(state.autoRefreshInterval);

  saveSettings();
}

function toggleSetting(key) {
  state.settings[key] = !state.settings[key];
  applySettings();
  if (key === 'notifications' && state.settings[key]) requestNotifs();
}

function setRefreshRate(val) {
  state.settings.refreshRate = parseInt(val);
  applySettings();
  if (state.settings.autoRefresh) startAutoRefresh();
}

function setExpireMinutes(val) {
  state.settings.expireMinutes = parseInt(val);
  resetTimer();
  saveSettings();
}

function setTheme(val) {
  state.settings.theme = val;
  applySettings();
}

// ─── Page Switching ───────────────────────────────────────
function switchPage(page) {
  state.currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  $(`page-${page}`).classList.add('active');
  $(`tab-${page}`).classList.add('active');

  // Remove notification dot when visiting inbox
  if (page === 'inbox') {
    const dot = document.querySelector('#tab-inbox .tab-dot');
    if (dot) dot.classList.remove('show');
  }
}

// ─── Init ─────────────────────────────────────────────────
function init() {
  applySettings();
  generateEmail();
  requestNotifs();
  renderTeam();
  renderHistory();

  // Initial inbox check after 1.5s
  setTimeout(() => checkInbox(true), 1500);
}

window.addEventListener('DOMContentLoaded', init);

// Expose to HTML
window.generateEmail = generateEmail;
window.selectDomain = selectDomain;
window.copyEmail = copyEmail;
window.checkInbox = checkInbox;
window.clearInbox = clearInbox;
window.openEmail = openEmail;
window.deleteEmail = deleteEmail;
window.copyText = copyText;
window.switchPage = switchPage;
window.clearHistory = clearHistory;
window.useHistoryEmail = useHistoryEmail;
window.addTeamEmail = addTeamEmail;
window.removeTeamEmail = removeTeamEmail;
window.useTeamEmail = useTeamEmail;
window.toggleSetting = toggleSetting;
window.setRefreshRate = setRefreshRate;
window.setExpireMinutes = setExpireMinutes;
window.setTheme = setTheme;
