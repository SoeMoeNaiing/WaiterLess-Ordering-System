const $ = (id) => document.getElementById(id);

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
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
    else if (k === 'onclick') node.onclick = v;
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else node[k] = v;
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
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

  for (const t of tables) {
    root.appendChild(renderTable(t));
  }
}

function renderTable(t) {
  const img = el('img', { src: `/api/admin/tables/${t.id}/qr.png?size=192`, alt: `QR for ${t.table_number}` });

  const info = el('div', { className: 'info' }, [
    el('div', { className: 'num' }, [
      t.table_number,
      el('span', {
        className: `badge ${t.is_active ? 'on' : 'off'}`,
        text: t.is_active ? 'active' : 'inactive',
      }),
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

  return el('div', { className: 'row' }, [img, info, el('div', { className: 'actions' }, [regen, toggle])]);
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
    $('add-error').textContent = e.message;
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

  for (const c of cats) {
    root.appendChild(renderCategory(c));
  }
}

function renderCategory(c) {
  const name = el('input', {
    type: 'text',
    value: c.name,
    style: 'flex:1; max-width: 16rem;',
  });

  const order = el('input', {
    type: 'number',
    value: c.sort_order,
    style: 'max-width: 6rem;',
  });

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
    el('div', { className: 'info', style: 'display:flex; gap:0.5rem; align-items:center;' }, [
      name, order,
    ]),
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
    $('add-category-error').textContent = e.message;
  }
};

// ---------- Boot ----------

Promise.all([refresh(), refreshCategories()]).catch(e => {
  $('status').textContent = 'error loading: ' + e.message;
});
