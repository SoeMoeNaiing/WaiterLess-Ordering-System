import { io } from '/socket.io/socket.io.esm.min.js';

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'className') node.className = v;
    else if (k === 'onclick') node.onclick = v;
    else node[k] = v;
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function ageMinutes(created_at) {
  const iso = created_at.replace(' ', 'T') + 'Z';
  return Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
}

function ageClass(mins) {
  if (mins >= 10) return 'age-late';
  if (mins >= 5) return 'age-warn';
  return '';
}

// ---------- Sound ----------

const SOUND_KEY = 'rs_kitchen_sound';
let soundEnabled = localStorage.getItem(SOUND_KEY) !== '0';
let seenOrderKeys = new Set();
let seenOrderKeysInitialized = false;
let audioCtx = null;

function orderKey(o) { return `${o.id}:${o.created_at}`; }

function updateSoundButton() {
  const btn = $('sound-btn');
  if (!btn) return;
  btn.textContent = soundEnabled ? '🔔' : '🔕';
  btn.classList.toggle('muted', !soundEnabled);
  btn.title = soundEnabled ? 'Mute sound (M)' : 'Unmute sound (M)';
}

function toggleSound() {
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_KEY, soundEnabled ? '1' : '0');
  updateSoundButton();
  if (soundEnabled) playNewOrderSound();
}

function ensureAudio() {
  if (!audioCtx) {
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch { return null; }
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function beep(freq, duration, delay = 0) {
  const ctx = ensureAudio();
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime + delay;
  osc.type = 'sine';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

function isAudioReady() {
  return audioCtx && audioCtx.state === 'running';
}

function playNewOrderSound() {
  if (!soundEnabled) return;
  // Silently skip if the browser hasn't unlocked audio yet (no gesture)
  if (!isAudioReady()) return;
  beep(880, 0.18, 0);
  beep(1100, 0.18, 0.20);
}

// ---------- Socket ----------

let socket = null;

function updateLiveDot(state) {
  const dot = $('live-dot');
  if (!dot) return;
  dot.classList.remove('live', 'polling');
  if (state === 'live') {
    dot.classList.add('live');
    dot.title = 'Live (Socket.IO connected)';
  } else if (state === 'polling') {
    dot.classList.add('polling');
    dot.title = 'Polling fallback (socket disconnected)';
  } else {
    dot.title = 'Connecting…';
  }
}

function connectSocket() {
  if (socket) return;

  socket = io({
    path: '/socket.io/',
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });

  socket.on('connected', (data) => {
    console.log('[kitchen socket] connected, scope:', data?.scope);
    updateLiveDot('live');
    // Sync immediately in case we missed events while disconnected
    refresh();
  });

  socket.on('order:new', (payload) => {
    console.log('[kitchen socket] order:new', payload?.order?.id);
    refresh();
  });

  socket.on('order:updated', (payload) => {
    console.log('[kitchen socket] order:updated', payload?.order?.id || payload?.orderId);
    refresh();
  });

  socket.on('disconnect', (reason) => {
    console.log('[kitchen socket] disconnected:', reason);
    updateLiveDot('polling');
  });

  socket.on('connect_error', (err) => {
    console.warn('[kitchen socket] connect_error:', err.message);
    updateLiveDot('polling');
  });

  socket.io.on('reconnect', () => {
    console.log('[kitchen socket] reconnected');
    updateLiveDot('live');
    refresh();
  });
}

function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
  updateLiveDot('polling');
}

// ---------- Auth ----------

function showLogin() {
  $('login-view').style.display = 'block';
  $('app-view').style.display = 'none';
  $('pin-error').textContent = '';
  $('pin-input').value = '';
  setTimeout(() => $('pin-input').focus(), 50);
}

function showApp() {
  $('login-view').style.display = 'none';
  $('app-view').style.display = 'block';
}

async function login() {
  const pin = $('pin-input').value.trim();
  $('pin-error').textContent = '';
  if (!pin) { $('pin-error').textContent = 'Enter a PIN.'; return; }

  const res = await fetch('/api/kitchen/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    $('pin-error').textContent =
      res.status === 429 ? 'Too many attempts. Try again later.' :
      (body.error || 'Login failed.');
    return;
  }
  showApp();
  ensureAudio();
  if (soundEnabled) beep(880, 0.15, 0);
  setTimeout(() => {
    if (isAudioReady()) hideAudioBanner();
  }, 100);
  connectSocket();
  refresh();
  startPolling();
}

async function logout() {
  await fetch('/api/kitchen/auth/logout', { method: 'POST' });
  disconnectSocket();
  stopPolling();
  showLogin();
}

// ---------- Order actions ----------

async function patchOrder(id, payload) {
  const res = await fetch(`/api/kitchen/orders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.status === 401) {
    stopPolling();
    disconnectSocket();
    showLogin();
    return null;
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    alert(`Failed: ${body.error || res.status}`);
    return null;
  }
  return res.json();
}

function renderOrder(o, isNew) {
  const mins = ageMinutes(o.created_at);

  const closeBtn = el('button', {
    className: 'card-close',
    text: '\u00d7',
    title: 'Cancel order',
    onclick: async () => {
      if (!confirm(`Reject order #${o.id} for Table ${o.table_number}?`)) return;
      await patchOrder(o.id, { status: 'cancelled' });
      refresh();
    },
  });

  const head = el('div', { className: 'card-head' }, [
    el('span', { className: 'table', text: `Table ${o.table_number}` }),
    el('span', { className: 'order-id', text: `#${o.id}` }),
    el('span', { className: 'age', text: `${mins}m` }),
    isNew ? el('span', { className: 'new-badge', text: 'new' }) : null,
    closeBtn,
  ]);

  const itemsList = el('ul', { className: 'items' });

  for (const it of o.items) {
    const opts = Array.isArray(it.options) ? it.options : [];
    const optText = opts.map((x) => x.choice_name_snapshot).join(' \u00b7 ');

    const line = el('li', { className: 'item-line' }, [
      el('div', { className: 'item-main' }, [
        el('span', { className: 'qty', text: `${it.qty}\u00d7` }),
        el('span', { className: 'item-name', text: it.name_snapshot }),
      ]),
      optText ? el('div', { className: 'item-options', text: optText }) : null,
      it.notes ? el('div', { className: 'item-notes', text: `\u201c${it.notes}\u201d` }) : null,
    ]);
    itemsList.appendChild(line);
  }

  const nodes = [head, itemsList];

  if (o.notes) {
    nodes.push(el('div', { className: 'notes', text: `Note: ${o.notes}` }));
  }

  const actions = el('div', { className: 'actions' });

  if (o.status === 'placed') {
    actions.appendChild(el('button', {
      className: 'btn-confirm',
      text: 'Confirm',
      onclick: async () => {
        await patchOrder(o.id, { status: 'preparing' });
        refresh();
      },
    }));
  } else if (o.status === 'preparing' || o.status === 'ready') {
    actions.appendChild(el('button', {
      className: 'btn-serve',
      text: 'Mark served',
      onclick: async () => {
        await patchOrder(o.id, { status: 'served' });
        refresh();
      },
    }));
  }

  nodes.push(actions);

  const cls = ['card', ageClass(mins)];
  if (o.status === 'preparing') cls.push('preparing');
  if (o.status === 'ready') cls.push('ready');
  if (isNew) cls.push('row-pulse');

  return el('div', { className: cls.filter(Boolean).join(' ') }, nodes);
}

async function refresh() {
  try {
    const res = await fetch('/api/kitchen/orders');
    if (res.status === 401) {
      stopPolling();
      disconnectSocket();
      showLogin();
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const orders = await res.json();

    // New-order detection via composite key
    const newKeys = new Set();
    if (seenOrderKeysInitialized) {
      for (const o of orders) {
        if (!seenOrderKeys.has(orderKey(o))) newKeys.add(orderKey(o));
      }
      if (newKeys.size > 0) playNewOrderSound();
    }
    seenOrderKeys = new Set(orders.map(orderKey));
    seenOrderKeysInitialized = true;

    const board = $('board');
    board.replaceChildren();

    if (orders.length === 0) {
      board.appendChild(el('div', { className: 'empty', text: 'No active orders.' }));
    } else {
      for (const o of orders) board.appendChild(renderOrder(o, newKeys.has(orderKey(o))));
    }

    const now = new Date().toLocaleTimeString();
    $('status').textContent = `${orders.length} active \u00b7 updated ${now}`;
  } catch (e) {
    $('status').textContent = 'error: ' + e.message;
  }
}

// ---------- Polling (safety net — socket is primary) ----------

let pollTimer = null;
function startPolling() {
  if (pollTimer) return;
  // 30s safety net in case socket drops silently
  pollTimer = setInterval(refresh, 30000);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ---------- Boot ----------

$('pin-submit').onclick = login;
$('pin-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('logout-btn').onclick = logout;

$('sound-btn')?.addEventListener('click', toggleSound);
function showAudioBanner() {
  const banner = document.getElementById('audio-banner');
  if (banner) banner.style.display = 'flex';
}

function hideAudioBanner() {
  const banner = document.getElementById('audio-banner');
  if (banner) banner.style.display = 'none';
}

function unlockAudioAndHideBanner() {
  ensureAudio();
  // Give the context a moment to transition to running, then hide
  setTimeout(() => {
    if (isAudioReady()) {
      hideAudioBanner();
    }
  }, 100);
}

document.addEventListener('click', unlockAudioAndHideBanner, { once: true });
document.addEventListener('keydown', unlockAudioAndHideBanner, { once: true });
document.addEventListener('touchstart', unlockAudioAndHideBanner, { once: true });

document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'm' || e.key === 'M') {
    e.preventDefault();
    toggleSound();
  }
});

updateSoundButton();
updateLiveDot('polling');

async function boot() {
  updateSoundButton();

  const res = await fetch('/api/kitchen/orders');
  if (res.ok) {
    showApp();
    connectSocket();
    refresh();
    startPolling();
    if (soundEnabled && !isAudioReady()) showAudioBanner();
  } else {
    showLogin();
  }
}

boot();
