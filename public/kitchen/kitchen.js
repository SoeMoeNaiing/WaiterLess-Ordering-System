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
  refresh();
  startPolling();
}

async function logout() {
  await fetch('/api/kitchen/auth/logout', { method: 'POST' });
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

function renderOrder(o) {
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
    closeBtn,
  ]);

  const items = el('ul', { className: 'items' },
    o.items.map((it) =>
      el('li', {}, [
        el('span', { className: 'qty', text: `${it.qty}\u00d7` }),
        el('span', { text: it.name_snapshot }),
      ])
    )
  );

  const nodes = [head, items];

  if (o.notes) {
    nodes.push(el('div', { className: 'notes', text: `Note: ${o.notes}` }));
  }

  // Status label + action buttons per state
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

  return el('div', { className: cls.filter(Boolean).join(' ') }, nodes);
}

async function refresh() {
  try {
    const res = await fetch('/api/kitchen/orders');
    if (res.status === 401) {
      stopPolling();
      showLogin();
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const orders = await res.json();

    const board = $('board');
    board.replaceChildren();

    if (orders.length === 0) {
      board.appendChild(el('div', { className: 'empty', text: 'No active orders.' }));
    } else {
      for (const o of orders) board.appendChild(renderOrder(o));
    }

    const now = new Date().toLocaleTimeString();
    $('status').textContent = `${orders.length} active \u00b7 updated ${now}`;
  } catch (e) {
    $('status').textContent = 'error: ' + e.message;
  }
}

// ---------- Polling ----------

let pollTimer = null;
function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(refresh, 5000);
}
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ---------- Boot ----------

$('pin-submit').onclick = login;
$('pin-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('logout-btn').onclick = logout;

async function boot() {
  const res = await fetch('/api/kitchen/orders');
  if (res.ok) {
    showApp();
    refresh();
    startPolling();
  } else {
    showLogin();
  }
}

boot();
