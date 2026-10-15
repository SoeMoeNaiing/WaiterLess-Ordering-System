const $ = (id) => document.getElementById(id);

// ---------- Helpers ----------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    showLogin();
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'className') node.className = v;
    else if (k === 'onclick') node.onclick = v;
    else if (k === 'onerror') node.onerror = v;
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
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

  const res = await fetch('/api/admin/auth/login', {
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
  loadApp();
}

async function logout() {
  await fetch('/api/admin/auth/logout', { method: 'POST' });
  showLogin();
}

// ---------- Tables ----------

async function refresh() {
  const [health, tables] = await Promise.all([
    fetch('/health').then(r => r.json()),
    api('/api/admin/tables'),
  ]);

  $('status').textContent = `db: ${health.db} — ${tables.length} table(s)`;

  const root = $('tables');
  root.replaceChildren();

  if (tables.length === 0) {
    root.appendChild(el('p', { className: 'muted', text: 'No tables yet. Add one above.' }));
    return;
  }

  for (const t of tables) root.appendChild(renderTable(t));
}

function renderTable(t) {
  const img = el('img', { src: `/api/admin/tables/${t.id}/qr.png?size=192`, alt: `QR for ${t.table_number}` });

    const orderBadge = t.active_orders_count > 0
    ? el('span', { className: 'badge warn', text: `${t.active_orders_count} active` })
    : el('span', { className: 'badge idle', text: 'idle' });

  const info = el('div', { className: 'info' }, [
    el('div', { className: 'num' }, [
      t.table_number,
      el('span', {
        className: `badge ${t.is_active ? 'on' : 'off'}`,
        text: t.is_active ? 'active' : 'inactive',
      }),
      orderBadge,
    ]),
    t.label ? el('div', { className: 'label', text: t.label }) : null,
    el('div', { className: 'token', text: t.qr_token }),
  ]);

  const regen = el('button', {
    text: 'Regenerate QR',
    onclick: async () => {
      if (!confirm(`Regenerate QR for ${t.table_number}? The old QR code will stop working.`)) return;
      await api(`/api/admin/tables/${t.id}/regenerate-token`, { method: 'POST' });
      await refresh();
    },
  });

  const toggle = el('button', {
    text: t.is_active ? 'Deactivate' : 'Reactivate',
    className: t.is_active ? 'danger' : '',
    onclick: async () => {
      if (t.is_active && !confirm(`Deactivate ${t.table_number}?`)) return;
      await api(`/api/admin/tables/${t.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: t.is_active ? 0 : 1 }),
      });
      await refresh();
    },
  });

     const clear = el('button', {
    text: 'Clear session',
    onclick: async () => {
      if (!confirm(`Clear session for ${t.table_number}? Customer will no longer see previous orders.`)) return;
      const res = await api(`/api/admin/tables/${t.id}/clear-session`, { method: 'POST' });

      if (res.in_progress_count > 0) {
        alert(
          `Cleared ${res.cleared} order(s).\n\n` +
          `Warning: ${res.in_progress_count} order(s) are still in the kitchen. ` +
          `The customer can no longer see them on their status page. ` +
          `If you want them visible to the customer, do not clear the session until they are served.`
        );
      } else {
        alert(`Cleared ${res.cleared} order(s).`);
      }
      await refresh();
    },
  });

  return el('div', { className: 'row' }, [img, info, el('div', { className: 'actions' }, [regen, toggle, clear])]);
}

$('add-table').onclick = async () => {
  const table_number = $('new-table-number').value.trim();
  const label = $('new-table-label').value.trim();
  $('add-error').textContent = '';

  if (!table_number) {
    $('add-error').textContent = 'Table number is required.';
    return;
  }

  try {
    await api('/api/admin/tables', {
      method: 'POST',
      body: JSON.stringify({ table_number, label: label || undefined }),
    });
    $('new-table-number').value = '';
    $('new-table-label').value = '';
    await refresh();
  } catch (e) {
    if (e.message !== 'unauthorized') $('add-error').textContent = e.message;
  }
};

// ---------- Categories ----------

async function refreshCategories() {
  const cats = await api('/api/admin/categories');
  const root = $('categories');
  root.replaceChildren();

  if (cats.length === 0) {
    root.appendChild(el('p', { className: 'muted', text: 'No categories yet.' }));
    return;
  }

  for (const c of cats) root.appendChild(renderCategory(c));
}

function renderCategory(c) {
  const name = el('input', { type: 'text', value: c.name, style: 'flex:1; max-width: 16rem;' });
  const order = el('input', { type: 'number', value: c.sort_order, style: 'max-width: 6rem;' });

  const save = el('button', {
    text: 'Save',
    onclick: async () => {
      await api(`/api/admin/categories/${c.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: name.value.trim(),
          sort_order: Number(order.value) || 0,
        }),
      });
      await refreshCategories();
    },
  });

  const del = el('button', {
    text: 'Delete',
    className: 'danger',
    onclick: async () => {
      if (!confirm(`Delete "${c.name}"? Items in it will become uncategorized.`)) return;
      await api(`/api/admin/categories/${c.id}`, { method: 'DELETE' });
      await refreshCategories();
    },
  });

  return el('div', { className: 'row' }, [
    el('div', { className: 'info', style: 'display:flex; gap:0.5rem; align-items:center;' }, [name, order]),
    el('div', { className: 'actions' }, [save, del]),
  ]);
}

$('add-category').onclick = async () => {
  const name = $('new-category-name').value.trim();
  const sort_order = Number($('new-category-order').value) || 0;
  $('add-category-error').textContent = '';

  if (!name) {
    $('add-category-error').textContent = 'Name is required.';
    return;
  }

  try {
    await api('/api/admin/categories', {
      method: 'POST',
      body: JSON.stringify({ name, sort_order }),
    });
    $('new-category-name').value = '';
    $('new-category-order').value = '0';
    await refreshCategories();
  } catch (e) {
    if (e.message !== 'unauthorized') $('add-category-error').textContent = e.message;
  }
};

// ---------- Menu items ----------

async function refreshMenuItems() {
  const [items, cats] = await Promise.all([
    api('/api/admin/menu-items'),
    api('/api/admin/categories'),
  ]);

  const newSelect = $('new-item-category');
  newSelect.replaceChildren(el('option', { value: '', text: 'Uncategorized' }));
  for (const c of cats) {
    newSelect.appendChild(el('option', { value: String(c.id), text: c.name }));
  }

  const root = $('menu-items');
  root.replaceChildren();

  if (items.length === 0) {
    root.appendChild(el('p', { className: 'muted', text: 'No menu items yet.' }));
    return;
  }

  for (const item of items) root.appendChild(renderMenuItem(item, cats));
}

function renderMenuItem(item, cats) {
  const img = el('img', {
    className: 'thumb',
    src: item.image_path || '/admin/placeholder.svg',
    alt: item.name,
    onerror: (e) => { e.target.src = '/admin/placeholder.svg'; },
  });

  const upload = el('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/webp',
    style: 'display:none;',
  });
  upload.onchange = async () => {
    const f = upload.files[0];
    if (!f) return;
    const fd = new FormData();
    fd.append('file', f);
    const up = await fetch('/api/admin/upload', { method: 'POST', body: fd }).then(async (r) => {
      if (r.status === 401) { showLogin(); throw new Error('unauthorized'); }
      if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
      return r.json();
    });
    await api(`/api/admin/menu-items/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify({ image_path: up.path }),
    });
    await refreshMenuItems();
  };
  const uploadBtn = el('button', { text: 'Image…', onclick: () => upload.click() });

  const name = el('input', { type: 'text', value: item.name, style: 'flex: 1; min-width: 8rem;' });
  const price = el('input', { type: 'number', step: '0.01', min: '0', value: item.price, style: 'max-width: 6rem;' });

  const cat = el('select', {});
  cat.appendChild(el('option', { value: '', text: 'Uncategorized' }));
  for (const c of cats) {
    cat.appendChild(el('option', { value: String(c.id), text: c.name, selected: c.id === item.category_id }));
  }

  const save = el('button', {
    text: 'Save',
    onclick: async () => {
      await api(`/api/admin/menu-items/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: name.value.trim(),
          price: Number(price.value),
          category_id: cat.value === '' ? null : Number(cat.value),
        }),
      });
      await refreshMenuItems();
    },
  });

  const avail = el('button', {
    text: item.is_available ? 'Mark unavailable' : 'Mark available',
    onclick: async () => {
      await api(`/api/admin/menu-items/${item.id}`, {
        method: 'PUT',
        body: JSON.stringify({ is_available: item.is_available ? 0 : 1 }),
      });
      await refreshMenuItems();
    },
  });

  const del = el('button', {
    text: 'Delete',
    className: 'danger',
    onclick: async () => {
      if (!confirm(`Delete "${item.name}"? Order history will keep the price.`)) return;
      await api(`/api/admin/menu-items/${item.id}`, { method: 'DELETE' });
      await refreshMenuItems();
    },
  });

  const info = el('div', { className: 'info', style: 'display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;' }, [
    name, price, cat,
    el('span', {
      className: `badge ${item.is_available ? 'on' : 'off'}`,
      text: item.is_available ? 'available' : 'unavailable',
    }),
  ]);

  const actions = el('div', { className: 'actions' }, [uploadBtn, save, avail, del]);

  return el('div', { className: 'row' }, [img, info, actions, upload]);
}

$('add-item').onclick = async () => {
  const name = $('new-item-name').value.trim();
  const priceStr = $('new-item-price').value;
  const price = Number(priceStr);
  const catVal = $('new-item-category').value;
  const fileInput = $('new-item-image');
  const file = fileInput.files[0];
  $('add-item-error').textContent = '';

  if (!name) { $('add-item-error').textContent = 'Name is required.'; return; }
  if (!priceStr || !Number.isFinite(price) || price < 0) {
    $('add-item-error').textContent = 'Price must be a non-negative number.'; return;
  }

  try {
    let image_path = null;
    if (file) {
      const fd = new FormData();
      fd.append('file', file);
      const up = await fetch('/api/admin/upload', { method: 'POST', body: fd }).then(async (r) => {
        if (r.status === 401) { showLogin(); throw new Error('unauthorized'); }
        if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
        return r.json();
      });
      image_path = up.path;
    }

    await api('/api/admin/menu-items', {
      method: 'POST',
      body: JSON.stringify({
        name, price,
        category_id: catVal === '' ? null : Number(catVal),
        image_path,
      }),
    });
    $('new-item-name').value = '';
    $('new-item-price').value = '';
    fileInput.value = '';
    await refreshMenuItems();
  } catch (e) {
    if (e.message !== 'unauthorized') $('add-item-error').textContent = e.message;
  }
};
// ---------- Dashboard ----------

async function refreshDashboard() {
  try {
    const d = await api('/api/admin/dashboard');
    $('dash-completed').textContent = d.orders_completed;
    $('dash-progress').textContent = d.orders_in_progress;
    $('dash-sales').textContent = d.sales_completed.toFixed(2);
    $('dash-avg').textContent = d.avg_order_value.toFixed(2);

    const root = $('dash-top');
    root.replaceChildren();
    if (d.top_items.length === 0) {
      root.appendChild(el('p', { className: 'muted', text: 'No items sold yet today.' }));
    } else {
      for (const it of d.top_items) {
        root.appendChild(el('div', { className: 'row' }, [
          el('div', { className: 'info' }, [
            el('div', { className: 'num', text: it.name }),
          ]),
          el('div', { text: `${it.qty}× — ${it.revenue.toFixed(2)}` }),
        ]));
      }
    }
  } catch (e) {
    if (e.message !== 'unauthorized') console.warn('dashboard failed', e);
  }
}
// ---------- Order history ----------

async function loadHistory(range) {
  const now = new Date();
  let from = '';
  if (range === 'today') from = now.toISOString().slice(0, 10);
  else if (range === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); from = d.toISOString().slice(0, 10); }
  else if (range === 'month') { const d = new Date(now); d.setDate(d.getDate() - 30); from = d.toISOString().slice(0, 10); }

  const url = from ? `/api/admin/orders?from=${from}&limit=200` : '/api/admin/orders?limit=200';
  const msg = $('hist-summary');
  const root = $('hist-list');
  msg.textContent = 'loading…';
  root.replaceChildren();

  try {
    const data = await api(url);
    msg.textContent = `${data.total_count} order(s) — total ${data.total_sum.toFixed(2)}`;

    if (data.orders.length === 0) {
      root.appendChild(el('p', { className: 'muted', text: 'No orders in this range.' }));
      return;
    }

    for (const o of data.orders) {
      const items = el('div', { className: 'muted' },
        o.items.map((it) => el('div', { text: `${it.qty}× ${it.name_snapshot} — ${(it.price_snapshot * it.qty).toFixed(2)}` }))
      );
      root.appendChild(el('div', { className: 'row' }, [
        el('div', { className: 'info' }, [
          el('div', { className: 'num' }, [
            `#${o.id} — Table ${o.table_number}`,
            el('span', { className: `badge ${o.status === 'served' ? 'on' : 'off'}`, text: o.status }),
          ]),
          el('div', { className: 'label', text: o.created_at }),
          items,
        ]),
        el('div', { style: 'text-align:right; font-weight:600;' , text: o.total.toFixed(2) }),
      ]));
    }
  } catch (e) {
    if (e.message === 'unauthorized') return;
    msg.textContent = 'error: ' + e.message;
  }
}

if ($('hist-today')) {
  $('hist-today').onclick = () => loadHistory('today');
  $('hist-week').onclick = () => loadHistory('week');
  $('hist-month').onclick = () => loadHistory('month');
  $('hist-all').onclick = () => loadHistory('all');
}
// ---------- Settings ----------

async function refreshSettings() {
  try {
    const s = await api('/api/admin/settings');
    $('setting-restaurant-name').value = s.restaurant_name || '';
    $('setting-currency').value = s.currency || '';
    $('setting-default-language').value = s.default_language || '';
  } catch (e) {
    if (e.message !== 'unauthorized') console.warn('settings load failed', e);
  }
}

async function saveSettings() {
  const msg = $('settings-message');
  msg.textContent = '';
  msg.style.color = '#888';

  const payload = {
    restaurant_name: $('setting-restaurant-name').value.trim(),
    currency: $('setting-currency').value.trim(),
    default_language: $('setting-default-language').value.trim(),
  };

  try {
    await api('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    msg.textContent = 'Settings saved.';
    msg.style.color = '#155724';
  } catch (e) {
    if (e.message === 'unauthorized') return;
    msg.textContent = e.message;
    msg.style.color = '#b02a37';
  }
}
// ---------- Security ----------

async function changePin(target) {
  const current_pin = $('current-pin').value.trim();
  const new_pin = target === 'admin'
    ? $('new-admin-pin').value.trim()
    : $('new-kitchen-pin').value.trim();
  const msg = $('security-message');
  msg.textContent = '';
  msg.style.color = '#888';

  try {
    await api('/api/admin/auth/change-pin', {
      method: 'POST',
      body: JSON.stringify({ current_pin, target, new_pin }),
    });
    $('current-pin').value = '';
    $('new-admin-pin').value = '';
    $('new-kitchen-pin').value = '';
    msg.textContent = `${target} PIN changed.`;
    msg.style.color = '#155724';
  } catch (e) {
    if (e.message === 'unauthorized') return;
    msg.textContent = e.message;
    msg.style.color = '#b02a37';
  }
}
// ---------- Tabs ----------

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('active', p.dataset.panel === name);
  });
  if (window.location.hash !== '#' + name) {
    history.replaceState(null, '', '#' + name);
  }
}

document.querySelectorAll('.tab').forEach((t) => {
  t.onclick = () => showTab(t.dataset.tab);
});

// Restore last tab from the URL hash on load; default dashboard.
const initialTab = (window.location.hash || '#dashboard').slice(1);
showTab(initialTab);
// ---------- Boot ----------

$('pin-submit').onclick = login;
$('pin-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
$('logout-btn').onclick = logout;

const btnAdminPin = $('change-admin-pin');
if (btnAdminPin) btnAdminPin.onclick = () => changePin('admin');
const btnKitchenPin = $('change-kitchen-pin');
if (btnKitchenPin) btnKitchenPin.onclick = () => changePin('kitchen');
const btnSaveSettings = $('save-settings');
if (btnSaveSettings) btnSaveSettings.onclick = saveSettings;

async function loadApp() {
  $('status').textContent = 'loading…';
  try {
   await Promise.all([refresh(), refreshCategories(), refreshMenuItems(), refreshSettings(), refreshDashboard()]);
  } catch (e) {
    if (e.message !== 'unauthorized') {
      $('status').textContent = 'error loading: ' + e.message;
    }
  }
}

async function boot() {
  const res = await fetch('/api/admin/tables');
  if (res.ok) {
    showApp();
    loadApp();
  } else {
    showLogin();
  }
}

boot();
