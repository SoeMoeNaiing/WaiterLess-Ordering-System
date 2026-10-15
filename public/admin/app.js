const $ = (id) => document.getElementById(id);

// ---------- Toast ----------

function toast(message, kind = 'info') {
  const container = $('toast-container');
  if (!container) return;
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('toast-show'));
  setTimeout(() => {
    el.classList.remove('toast-show');
    setTimeout(() => el.remove(), 250);
  }, 2800);
}

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
  $('app-view').style.display = 'grid';
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
  const tables = await api('/api/admin/tables');
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
      try {
        await api(`/api/admin/tables/${t.id}/regenerate-token`, { method: 'POST' });
        toast('QR regenerated', 'success');
        await refresh();
      } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
    },
  });

  const toggle = el('button', {
    text: t.is_active ? 'Deactivate' : 'Reactivate',
    className: t.is_active ? 'danger' : '',
    onclick: async () => {
      if (t.is_active && !confirm(`Deactivate ${t.table_number}?`)) return;
      try {
        await api(`/api/admin/tables/${t.id}`, {
          method: 'PUT',
          body: JSON.stringify({ is_active: t.is_active ? 0 : 1 }),
        });
        toast(t.is_active ? 'Table deactivated' : 'Table reactivated', 'success');
        await refresh();
      } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
    },
  });

  const clear = el('button', {
    text: 'Clear session',
    onclick: async () => {
      if (!confirm(`Clear session for ${t.table_number}? Customer will no longer see previous orders.`)) return;
      try {
        const res = await api(`/api/admin/tables/${t.id}/clear-session`, { method: 'POST' });
        if (res.in_progress_count > 0) {
          toast(`Cleared ${res.cleared}. Warning: ${res.in_progress_count} order(s) still in kitchen.`, 'warn');
        } else {
          toast(`Cleared ${res.cleared} order(s)`, 'success');
        }
        await refresh();
      } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
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
    toast(`Table "${table_number}" added`, 'success');
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
      try {
        await api(`/api/admin/categories/${c.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: name.value.trim(),
            sort_order: Number(order.value) || 0,
          }),
        });
        toast('Category saved', 'success');
        await Promise.all([refreshCategories(), refreshMenuItems()]);
      } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
    },
  });

  const del = el('button', {
    text: 'Delete',
    className: 'danger',
    onclick: async () => {
      if (!confirm(`Delete "${c.name}"? Items in it will become uncategorized.`)) return;
      try {
        await api(`/api/admin/categories/${c.id}`, { method: 'DELETE' });
        toast('Category deleted', 'success');
        await Promise.all([refreshCategories(), refreshMenuItems()]);
      } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
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
    toast(`Category "${name}" added`, 'success');
    $('new-category-name').value = '';
    $('new-category-order').value = '0';
    await Promise.all([refreshCategories(), refreshMenuItems()]);
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
  if (newSelect) {
    newSelect.replaceChildren(el('option', { value: '', text: 'Uncategorized' }));
    for (const c of cats) {
      newSelect.appendChild(el('option', { value: String(c.id), text: c.name }));
    }
  }

  const root = $('menu-items');
  if (!root) return;
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
    try {
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
      toast('Image updated', 'success');
      await refreshMenuItems();
    } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
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
      try {
        await api(`/api/admin/menu-items/${item.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            name: name.value.trim(),
            price: Number(price.value),
            category_id: cat.value === '' ? null : Number(cat.value),
          }),
        });
        toast('Item saved', 'success');
        await refreshMenuItems();
      } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
    },
  });

  const avail = el('button', {
    text: item.is_available ? 'Mark unavailable' : 'Mark available',
    onclick: async () => {
      try {
        await api(`/api/admin/menu-items/${item.id}`, {
          method: 'PUT',
          body: JSON.stringify({ is_available: item.is_available ? 0 : 1 }),
        });
        toast(item.is_available ? 'Marked unavailable' : 'Marked available', 'success');
        await refreshMenuItems();
      } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
    },
  });

  const del = el('button', {
    text: 'Delete',
    className: 'danger',
    onclick: async () => {
      if (!confirm(`Delete "${item.name}"? Order history will keep the price.`)) return;
      try {
        await api(`/api/admin/menu-items/${item.id}`, { method: 'DELETE' });
        toast('Item deleted', 'success');
        await refreshMenuItems();
      } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
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
    toast(`Item "${name}" added`, 'success');
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

// ---------- Live orders ----------

async function refreshLive() {
  const root = $('live-list');
  if (!root) return;
  try {
    const res = await fetch('/api/kitchen/orders');
    if (res.status === 401) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const orders = await res.json();

    root.replaceChildren();

    if (orders.length === 0) {
      root.appendChild(el('p', { className: 'muted', text: 'No active orders.' }));
      return;
    }

    for (const o of orders) {
      const info = el('div', { className: 'info' }, [
        el('div', { className: 'num' }, [
          `#${o.id} — Table ${o.table_number}`,
          el('span', {
            className: `badge ${o.status === 'preparing' ? 'warn' : o.status === 'ready' ? 'on' : 'idle'}`,
            text: o.status,
          }),
        ]),
        el('div', { className: 'label' }, o.items.map((it) => `${it.qty}× ${it.name_snapshot}`).join(', ')),
      ]);

      const actions = el('div', { className: 'actions' });

      if (o.status === 'placed') {
        actions.appendChild(el('button', {
          className: 'primary', text: 'Confirm',
          onclick: async () => {
            try {
              await api(`/api/kitchen/orders/${o.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'preparing' }) });
              toast(`Order #${o.id} confirmed`, 'success');
              refreshLive();
            } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
          },
        }));
      }
      if (o.status === 'preparing' || o.status === 'ready') {
        actions.appendChild(el('button', {
          className: 'primary', text: 'Mark served',
          onclick: async () => {
            try {
              await api(`/api/kitchen/orders/${o.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'served' }) });
              toast(`Order #${o.id} served`, 'success');
              refreshLive();
            } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
          },
        }));
      }

      actions.appendChild(el('button', {
        text: 'Reject', className: 'danger',
        onclick: async () => {
          if (!confirm(`Reject order #${o.id}?`)) return;
          try {
            await api(`/api/kitchen/orders/${o.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
            toast(`Order #${o.id} rejected`, 'warn');
            refreshLive();
          } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
        },
      }));

      root.appendChild(el('div', { className: 'row' }, [info, actions]));
    }
  } catch (e) {
    if (e.message !== 'unauthorized') {
      root.replaceChildren(el('p', { className: 'error', text: 'Error: ' + e.message }));
    }
  }
}

// ---------- Order history ----------

function ymd(date) {
  return date.toLocaleDateString('en-CA');
}

async function loadHistory(from, to) {
  const msg = $('hist-summary');
  const root = $('hist-list');
  msg.textContent = 'loading…';
  root.replaceChildren();

  const params = new URLSearchParams();
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  params.set('limit', '500');

  try {
    const data = await api(`/api/admin/orders?${params.toString()}`);
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
            el('span', { className: `badge ${o.status === 'served' ? 'on' : o.status === 'cancelled' ? 'off' : 'idle'}`, text: o.status }),
          ]),
          el('div', { className: 'label', text: o.created_at }),
          items,
        ]),
        el('div', { style: 'text-align:right; font-weight:600;', text: o.total.toFixed(2) }),
      ]));
    }
  } catch (e) {
    if (e.message === 'unauthorized') return;
    msg.textContent = 'error: ' + e.message;
  }
}

function wireHistory() {
  const todayBtn = $('hist-today');
  if (!todayBtn) return;

  const today = new Date();
  const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
  const monthAgo = new Date(today); monthAgo.setDate(today.getDate() - 30);

  const setDates = (from, to) => {
    $('hist-from').value = from || '';
    $('hist-to').value = to || '';
  };

  todayBtn.onclick = () => {
    const t = ymd(today);
    setDates(t, t);
    loadHistory(t, t);
  };
  $('hist-week').onclick = () => {
    const from = ymd(weekAgo), to = ymd(today);
    setDates(from, to);
    loadHistory(from, to);
  };
  $('hist-month').onclick = () => {
    const from = ymd(monthAgo), to = ymd(today);
    setDates(from, to);
    loadHistory(from, to);
  };
  $('hist-all').onclick = () => {
    setDates('', '');
    loadHistory('', '');
  };
  $('hist-apply').onclick = () => {
    loadHistory($('hist-from').value, $('hist-to').value);
  };

  // Default: load today on first view
  const t = ymd(today);
  setDates(t, t);
  loadHistory(t, t);
}

// ---------- Settings ----------

async function refreshSettings() {
  try {
    const s = await api('/api/admin/settings');
    $('setting-restaurant-name').value = s.restaurant_name || '';
    $('setting-currency').value = s.currency || '';
    $('setting-default-language').value = s.default_language || '';
    const brand = $('brand-name');
    if (brand && s.restaurant_name) brand.textContent = s.restaurant_name;
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
    toast('Settings saved', 'success');
    const brand = $('brand-name');
    if (brand) brand.textContent = payload.restaurant_name || 'Restaurant';
  } catch (e) {
    if (e.message === 'unauthorized') return;
    msg.textContent = e.message;
    msg.style.color = '#b02a37';
    toast(e.message, 'error');
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
    toast(`${target} PIN changed`, 'success');
  } catch (e) {
    if (e.message === 'unauthorized') return;
    msg.textContent = e.message;
    msg.style.color = '#b02a37';
    toast(e.message, 'error');
  }
}

// ---------- Tabs ----------

const PAGE_TITLES = {
  dashboard: 'Dashboard',
  tables: 'Tables',
  menu: 'Menu',
  live: 'Live orders',
  orders: 'Orders',
  settings: 'Settings',
};

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === name);
  });
  document.querySelectorAll('.panel').forEach((p) => {
    p.classList.toggle('active', p.dataset.panel === name);
  });
  const title = $('page-title');
  if (title) title.textContent = PAGE_TITLES[name] || name;
  if (window.location.hash !== '#' + name) {
    history.replaceState(null, '', '#' + name);
  }
  const sb = $('sidebar');
  if (sb) sb.classList.remove('open');
  if (name === 'live') refreshLive();
}

// ---------- Boot ----------

function wireTabs() {
  document.querySelectorAll('.tab').forEach((t) => {
    t.onclick = () => showTab(t.dataset.tab);
  });
  const initialTab = (window.location.hash || '#dashboard').slice(1);
  showTab(initialTab);
}

function wireButtons() {
  $('pin-submit').onclick = login;
  $('pin-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('logout-btn').onclick = logout;

  const btnMenu = $('menu-toggle');
  if (btnMenu) {
    btnMenu.onclick = () => {
      const sb = $('sidebar');
      if (sb) sb.classList.toggle('open');
    };
  }

  const btnAdminPin = $('change-admin-pin');
  if (btnAdminPin) btnAdminPin.onclick = () => changePin('admin');
  const btnKitchenPin = $('change-kitchen-pin');
  if (btnKitchenPin) btnKitchenPin.onclick = () => changePin('kitchen');
  const btnSaveSettings = $('save-settings');
  if (btnSaveSettings) btnSaveSettings.onclick = saveSettings;
}

async function loadApp() {
  try {
    await Promise.all([
      refresh(),
      refreshCategories(),
      refreshMenuItems(),
      refreshSettings(),
      refreshDashboard(),
    ]);
    wireHistory();
  } catch (e) {
    if (e.message !== 'unauthorized') {
      console.error('loadApp error', e);
      toast('Failed to load: ' + e.message, 'error');
    }
  }
}

async function boot() {
  wireTabs();
  wireButtons();

  const res = await fetch('/api/admin/tables');
  if (res.ok) {
    showApp();
    loadApp();
  } else {
    showLogin();
  }

  setInterval(() => {
    const active = document.querySelector('.tab.active');
    if (active && active.dataset.tab === 'live') refreshLive();
  }, 5000);
}

boot();
