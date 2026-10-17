import { initI18n, t, getLang, setLang, applyTranslations } from '/i18n/i18n.js';

const $ = (id) => document.getElementById(id);

const TAB_ORDER = ['dashboard', 'tables', 'menu', 'live', 'orders', 'settings'];
const PAGE_TITLES = {
  dashboard: 'admin.tab_dashboard',
  tables:    'admin.tab_tables',
  menu:      'admin.tab_menu',
  live:      'admin.tab_live',
  orders:    'admin.tab_orders',
  settings:  'admin.tab_settings',
};

let isLoggedIn = false;
let selectedLiveOrderId = null;
let liveOrdersCache = [];

// ---------- Helpers ----------

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) { showLogin(); throw new Error('unauthorized'); }
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

function toast(message, kind = 'info') {
  const container = $('toast-container');
  if (!container) { console.log('[toast]', message); return; }
  const box = document.createElement('div');
  box.className = `toast toast-${kind}`;
  box.textContent = message;
  container.appendChild(box);
  requestAnimationFrame(() => box.classList.add('toast-show'));
  setTimeout(() => {
    box.classList.remove('toast-show');
    setTimeout(() => box.remove(), 250);
  }, 2800);
}

function isTyping(e) {
  if (!e) return false;
  const tag = e.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.isContentEditable;
}

function ymd(date) { return date.toLocaleDateString('en-CA'); }

// ---------- Auth ----------

function showLogin() {
  isLoggedIn = false;
  $('splash')?.classList.add('hide');
  $('login-view').style.display = 'block';
  $('app-view').style.display = 'none';
  $('pin-error').textContent = '';
  $('pin-input').value = '';
  setTimeout(() => $('pin-input').focus(), 50);
}

function showApp() {
  isLoggedIn = true;
  $('splash')?.classList.add('hide');
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
  if (!root) return;
  root.replaceChildren();

  if (tables.length === 0) {
    root.appendChild(el('p', { className: 'muted', text: 'No tables yet. Add one above.' }));
    updatePrintSelectedButton();
    return;
  }
  for (const tbl of tables) root.appendChild(renderTable(tbl));
  updatePrintSelectedButton();
}

function renderTable(tbl) {
  const checkbox = el('input', { type: 'checkbox', className: 'row-check', 'data-table-id': String(tbl.id) });
  checkbox.addEventListener('change', updatePrintSelectedButton);

  const img = el('img', { src: `/api/admin/tables/${tbl.id}/qr.png?size=192`, alt: `QR for ${tbl.table_number}` });

  const orderBadge = tbl.active_orders_count > 0
    ? el('span', { className: 'badge warn', text: `${tbl.active_orders_count} active` })
    : el('span', { className: 'badge idle', text: 'idle' });

  const info = el('div', { className: 'info' }, [
    el('div', { className: 'num' }, [
      tbl.table_number,
      el('span', {
        className: `badge ${tbl.is_active ? 'on' : 'off'}`,
        text: tbl.is_active ? 'active' : 'inactive',
      }),
      orderBadge,
    ]),
    tbl.label ? el('div', { className: 'label', text: tbl.label }) : null,
    el('div', { className: 'token', text: tbl.qr_token }),
  ]);

  const rename = el('button', {
    text: 'Rename',
    onclick: async () => {
      const newNum = prompt(`New table number for ${tbl.table_number}:`, tbl.table_number);
      if (newNum === null) return;
      const newLabel = prompt(`New label (optional):`, tbl.label || '');
      if (newLabel === null) return;
      try {
        await api(`/api/admin/tables/${tbl.id}`, {
          method: 'PUT',
          body: JSON.stringify({
            table_number: newNum.trim() || tbl.table_number,
            label: newLabel.trim() || null,
          }),
        });
        toast('Table renamed', 'success');
        await refresh();
      } catch (e) {
        if (e.message === 'unauthorized') return;
        toast(e.message, 'error');
      }
    },
  });

  const regen = el('button', {
    text: t('admin.regenerate_qr'),
    onclick: async () => {
      if (!confirm(`Regenerate QR for ${tbl.table_number}?`)) return;
      try {
        await api(`/api/admin/tables/${tbl.id}/regenerate-token`, { method: 'POST' });
        toast('QR regenerated', 'success');
        await refresh();
      } catch (e) {
        if (e.message === 'unauthorized') return;
        if (e.message.includes('not found')) {
          toast('Table no longer exists — refreshing list', 'warn');
          await refresh();
        } else {
          toast(e.message, 'error');
        }
      }
    },
  });

  const toggle = el('button', {
    text: t(tbl.is_active ? 'admin.deactivate' : 'admin.reactivate'),
    className: tbl.is_active ? 'danger' : '',
    onclick: async () => {
      if (tbl.is_active && !confirm(`Deactivate ${tbl.table_number}?`)) return;
      try {
        await api(`/api/admin/tables/${tbl.id}`, {
          method: 'PUT',
          body: JSON.stringify({ is_active: tbl.is_active ? 0 : 1 }),
        });
        toast(tbl.is_active ? 'Table deactivated' : 'Table reactivated', 'success');
        await refresh();
      } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
    },
  });

  const clear = el('button', {
    text: t('admin.clear_session'),
    onclick: async () => {
      if (!confirm(`Clear session for ${tbl.table_number}?`)) return;
      try {
        const res = await api(`/api/admin/tables/${tbl.id}/clear-session`, { method: 'POST' });
        if (res.in_progress_count > 0) {
          toast(`Cleared ${res.cleared}. Warning: ${res.in_progress_count} still in kitchen.`, 'warn');
        } else {
          toast(`Cleared ${res.cleared} order(s)`, 'success');
        }
        await refresh();
      } catch (e) {
        if (e.message === 'unauthorized') return;
        if (e.message.includes('not found')) {
          toast('Table no longer exists — refreshing list', 'warn');
          await refresh();
        } else {
          toast(e.message, 'error');
        }
      }
    },
  });

  return el('div', { className: 'row' }, [
    checkbox, img, info,
    el('div', { className: 'actions' }, [rename, regen, toggle, clear]),
  ]);
}

function getSelectedTableIds() {
  return Array.from(document.querySelectorAll('.row-check:checked'))
    .map((c) => c.dataset.tableId);
}

function updatePrintSelectedButton() {
  const btn = $('print-selected');
  if (!btn) return;
  const ids = getSelectedTableIds();
  if (ids.length === 0) {
    btn.style.display = 'none';
  } else {
    btn.style.display = 'inline-block';
    btn.textContent = `Print selected (${ids.length})`;
  }
}

$('add-table').onclick = async () => {
  const table_number = $('new-table-number').value.trim();
  const label = $('new-table-label').value.trim();
  $('add-error').textContent = '';

  if (!table_number) { $('add-error').textContent = 'Table number is required.'; return; }
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
  if (!root) return;
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
    text: t('admin.save'),
    onclick: async () => {
      try {
        await api(`/api/admin/categories/${c.id}`, {
          method: 'PUT',
          body: JSON.stringify({ name: name.value.trim(), sort_order: Number(order.value) || 0 }),
        });
        toast('Category saved', 'success');
        await Promise.all([refreshCategories(), refreshMenuItems()]);
      } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
    },
  });

  const del = el('button', {
    text: t('admin.delete'),
    className: 'danger',
    onclick: async () => {
      if (!confirm(`Delete "${c.name}"?`)) return;
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

  if (!name) { $('add-category-error').textContent = 'Name is required.'; return; }
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
    for (const c of cats) newSelect.appendChild(el('option', { value: String(c.id), text: c.name }));
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

  const upload = el('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', style: 'display:none;' });
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
      await api(`/api/admin/menu-items/${item.id}`, { method: 'PUT', body: JSON.stringify({ image_path: up.path }) });
      toast('Image updated', 'success');
      await refreshMenuItems();
    } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
  };
  const uploadBtn = el('button', { text: 'Image…', onclick: () => upload.click() });

  const name = el('input', { type: 'text', value: item.name, style: 'flex: 1; min-width: 8rem;' });
  const price = el('input', { type: 'number', step: '0.01', min: '0', value: item.price, style: 'max-width: 6rem;' });

  const cat = el('select', {});
  cat.appendChild(el('option', { value: '', text: 'Uncategorized' }));
  for (const c of cats) cat.appendChild(el('option', { value: String(c.id), text: c.name, selected: c.id === item.category_id }));

  const save = el('button', {
    text: t('admin.save'),
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
    text: t(item.is_available ? 'admin.mark_unavailable' : 'admin.mark_available'),
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
    text: t('admin.delete'),
    className: 'danger',
    onclick: async () => {
      if (!confirm(`Delete "${item.name}"?`)) return;
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

  return el('div', { className: 'row' }, [img, info, el('div', { className: 'actions' }, [uploadBtn, save, avail, del]), upload]);
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
      body: JSON.stringify({ name, price, category_id: catVal === '' ? null : Number(catVal), image_path }),
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

    const updated = $('dash-updated');
    if (updated) updated.textContent = 'Updated ' + new Date().toLocaleTimeString();

    const root = $('dash-top');
    root.replaceChildren();
    if (d.top_items.length === 0) {
      root.appendChild(el('p', { className: 'muted', text: 'No items sold yet today.' }));
    } else {
      for (const it of d.top_items) {
        root.appendChild(el('div', { className: 'row' }, [
          el('div', { className: 'info' }, [el('div', { className: 'num', text: it.name })]),
          el('div', { text: `${it.qty}× — ${it.revenue.toFixed(2)}` }),
        ]));
      }
    }
  } catch (e) {
    if (e.message !== 'unauthorized') console.warn('dashboard failed', e);
  }
}

// ---------- Live orders ----------

function updateLiveBadge(count) {
  const badge = $('live-badge');
  if (!badge) return;
  if (count > 0) { badge.textContent = String(count); badge.style.display = 'inline-block'; }
  else { badge.style.display = 'none'; }
}

async function refreshLiveBadgeOnly() {
  try {
    const res = await fetch('/api/kitchen/orders');
    if (!res.ok) return;
    const orders = await res.json();
    updateLiveBadge(orders.length);
  } catch {}
}

async function refreshLive() {
  const root = $('live-list');
  if (!root) return;
  try {
    const res = await fetch('/api/kitchen/orders');
    if (res.status === 401) return;
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const orders = await res.json();

    liveOrdersCache = orders;
    updateLiveBadge(orders.length);
    root.replaceChildren();

    if (orders.length === 0) {
      selectedLiveOrderId = null;
      root.appendChild(el('p', { className: 'muted', text: 'No active orders.' }));
      return;
    }
    if (!selectedLiveOrderId || !orders.find((o) => o.id === selectedLiveOrderId)) {
      selectedLiveOrderId = orders[0].id;
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
          className: 'primary', text: `${t('admin.confirm')} (C)`,
          onclick: (e) => { e.stopPropagation(); confirmOrder(o.id); },
        }));
      }
      if (o.status === 'preparing' || o.status === 'ready') {
        actions.appendChild(el('button', {
          className: 'primary', text: `${t('admin.serve')} (S)`,
          onclick: (e) => { e.stopPropagation(); serveOrder(o.id); },
        }));
      }
      actions.appendChild(el('button', {
        text: `${t('admin.reject')} (X)`, className: 'danger',
        onclick: (e) => { e.stopPropagation(); rejectOrder(o.id); },
      }));

      const row = el('div', { className: `row${o.id === selectedLiveOrderId ? ' selected' : ''}` }, [info, actions]);
      row.onclick = () => { selectedLiveOrderId = o.id; refreshLive(); };
      root.appendChild(row);
    }
  } catch (e) {
    if (e.message !== 'unauthorized') {
      root.replaceChildren(el('p', { className: 'error', text: 'Error: ' + e.message }));
    }
  }
}

async function confirmOrder(id) {
  const o = liveOrdersCache.find((x) => x.id === id);
  if (!o) return;
  if (o.status !== 'placed') { toast(`Order #${id} is already ${o.status}`, 'warn'); return; }
  try {
    await api(`/api/kitchen/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'preparing' }) });
    toast(`Order #${id} confirmed`, 'success');
    await refreshLive();
    refreshDashboard();
  } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
}

async function serveOrder(id) {
  const o = liveOrdersCache.find((x) => x.id === id);
  if (!o) return;
  if (o.status !== 'preparing' && o.status !== 'ready') { toast(`Order #${id} cannot be served (${o.status})`, 'warn'); return; }
  try {
    await api(`/api/kitchen/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'served' }) });
    toast(`Order #${id} served`, 'success');
    await refreshLive();
    refreshDashboard();
  } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
}

async function rejectOrder(id) {
  const o = liveOrdersCache.find((x) => x.id === id);
  if (!o) return;
  if (!confirm(`Reject order #${id}?`)) return;
  try {
    await api(`/api/kitchen/orders/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) });
    toast(`Order #${id} rejected`, 'warn');
    await refreshLive();
    refreshDashboard();
  } catch (e) { if (e.message !== 'unauthorized') toast(e.message, 'error'); }
}

function moveLiveSelection(delta) {
  if (liveOrdersCache.length === 0) return;
  const idx = liveOrdersCache.findIndex((o) => o.id === selectedLiveOrderId);
  const next = (idx + delta + liveOrdersCache.length) % liveOrdersCache.length;
  selectedLiveOrderId = liveOrdersCache[next].id;
  refreshLive();
}

// ---------- Order history ----------

async function loadHistory(range) {
  const now = new Date();
  let from = '';
  if (range === 'today') from = ymd(now);
  else if (range === 'week') { const d = new Date(now); d.setDate(d.getDate() - 7); from = ymd(d); }
  else if (range === 'month') { const d = new Date(now); d.setDate(d.getDate() - 30); from = ymd(d); }

  const url = from ? `/api/admin/orders?from=${from}&limit=200` : '/api/admin/orders?limit=200';
  const msg = $('hist-summary');
  const root = $('hist-list');
  if (!msg || !root) return;
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
  if (!$('hist-today')) return;
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
    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(payload) });
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
  const new_pin = target === 'admin' ? $('new-admin-pin').value.trim() : $('new-kitchen-pin').value.trim();
  const msg = $('security-message');
  msg.textContent = '';
  msg.style.color = '#888';
  try {
    await api('/api/admin/auth/change-pin', { method: 'POST', body: JSON.stringify({ current_pin, target, new_pin }) });
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

function showTab(name) {
  if (!PAGE_TITLES[name]) name = 'dashboard';
  document.querySelectorAll('.tab').forEach((tb) => tb.classList.toggle('active', tb.dataset.tab === name));
  document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === name));
  const title = $('page-title');
  if (title) title.textContent = t(PAGE_TITLES[name]);
  if (window.location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  const sb = $('sidebar');
  if (sb) sb.classList.remove('open');

  if (name === 'live') refreshLive();
  else if (name === 'dashboard') refreshDashboard();
  else if (name === 'tables') refresh();
  else if (name === 'menu') { refreshCategories(); refreshMenuItems(); }
  else if (name === 'settings') refreshSettings();
}

function refreshActiveTab() {
  const active = document.querySelector('.tab.active')?.dataset.tab;
  if (!active) return;
  if (active === 'dashboard') refreshDashboard();
  else if (active === 'tables') refresh();
  else if (active === 'menu') { refreshCategories(); refreshMenuItems(); }
  else if (active === 'live') refreshLive();
  else if (active === 'settings') refreshSettings();
  toast('Refreshed', 'info');
}

// ---------- Help modal ----------

function openHelp() {
  const url = `${window.location.origin}/kitchen/`;
  const h = $('help-kitchen-url');
  if (h) h.textContent = url;
  $('help-modal')?.classList.add('open');
}
function closeHelp() { $('help-modal')?.classList.remove('open'); }

// ---------- Keyboard shortcuts ----------

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeHelp();
    $('sidebar')?.classList.remove('open');
    if (isTyping(document.activeElement)) document.activeElement.blur();
    return;
  }
  if (isTyping(e.target)) return;
  if (!isLoggedIn) return;

  const activeTab = document.querySelector('.tab.active')?.dataset.tab;

  if (activeTab === 'live') {
    if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J') { e.preventDefault(); moveLiveSelection(1); return; }
    if (e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K') { e.preventDefault(); moveLiveSelection(-1); return; }
    if (e.key === 'c' || e.key === 'C' || e.key === 'Enter') {
      e.preventDefault();
      if (selectedLiveOrderId) confirmOrder(selectedLiveOrderId); else toast('No order selected', 'warn');
      return;
    }
    if (e.key === 's' || e.key === 'S') {
      e.preventDefault();
      if (selectedLiveOrderId) serveOrder(selectedLiveOrderId); else toast('No order selected', 'warn');
      return;
    }
    if (e.key === 'x' || e.key === 'X') {
      e.preventDefault();
      if (selectedLiveOrderId) rejectOrder(selectedLiveOrderId); else toast('No order selected', 'warn');
      return;
    }
  }

  if (e.key === '?' || (e.shiftKey && e.key === '/')) { e.preventDefault(); openHelp(); return; }
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= TAB_ORDER.length) { showTab(TAB_ORDER[n - 1]); return; }
  if (e.key === 'r' || e.key === 'R') { e.preventDefault(); refreshActiveTab(); }
});

// ---------- Boot ----------

function wireTabs() {
  document.querySelectorAll('.tab').forEach((tb) => {
    tb.onclick = () => showTab(tb.dataset.tab);
  });
  const initial = (window.location.hash || '#dashboard').slice(1);
  showTab(PAGE_TITLES[initial] ? initial : 'dashboard');
}

function wireButtons() {
  $('pin-submit').onclick = login;
  $('pin-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
  $('logout-btn').onclick = logout;

  const btnMenu = $('menu-toggle');
  if (btnMenu) btnMenu.onclick = () => $('sidebar')?.classList.toggle('open');

  const btnHelp = $('help-btn');
  if (btnHelp) btnHelp.onclick = openHelp;
  const btnHelpClose = $('help-close');
  if (btnHelpClose) btnHelpClose.onclick = closeHelp;
  $('help-modal')?.addEventListener('click', (e) => { if (e.target.id === 'help-modal') closeHelp(); });

  const btnAdminPin = $('change-admin-pin');
  if (btnAdminPin) btnAdminPin.onclick = () => changePin('admin');
  const btnKitchenPin = $('change-kitchen-pin');
  if (btnKitchenPin) btnKitchenPin.onclick = () => changePin('kitchen');
  const btnSaveSettings = $('save-settings');
  if (btnSaveSettings) btnSaveSettings.onclick = saveSettings;
  const dashBtn = $('dash-refresh');
  if (dashBtn) dashBtn.onclick = () => refreshDashboard();

  const btnPrintSel = $('print-selected');
  if (btnPrintSel) {
    btnPrintSel.onclick = () => {
      const ids = getSelectedTableIds();
      if (ids.length === 0) return;
      window.open(`/admin/print.html?ids=${ids.join(',')}`, '_blank');
    };
  }
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
    refreshLiveBadgeOnly();
  } catch (e) {
    if (e.message !== 'unauthorized') {
      console.error('loadApp error', e);
      toast('Failed to load: ' + e.message, 'error');
    }
  }
}

async function boot() {
  await initI18n();
  applyTranslations();

  const langSel = $('lang-select-admin');
  if (langSel) {
    langSel.value = getLang();
    langSel.addEventListener('change', async (e) => {
      await setLang(e.target.value);
      await Promise.allSettled([
        refresh(),
        refreshCategories(),
        refreshMenuItems(),
        refreshLive(),
      ]);
      const active = document.querySelector('.tab.active')?.dataset.tab || 'dashboard';
      const title = $('page-title');
      if (title) title.textContent = t(PAGE_TITLES[active]);
    });
  }

  wireTabs();
  wireButtons();

  const res = await fetch('/api/admin/tables');
  if (res.ok) {
    showApp();
    loadApp();
  } else {
    showLogin();
  }

  setInterval(refreshLiveBadgeOnly, 8000);
  setInterval(() => {
    const active = document.querySelector('.tab.active');
    if (!active) return;
    const tab = active.dataset.tab;
    if (tab === 'live') refreshLive();
    if (tab === 'dashboard') refreshDashboard();
  }, 4000);
}

boot();
