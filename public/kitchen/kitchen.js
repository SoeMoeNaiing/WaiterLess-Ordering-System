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
  // SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC
  const iso = created_at.replace(' ', 'T') + 'Z';
  const ms = Date.now() - new Date(iso).getTime();
  return Math.floor(ms / 60000);
}

function ageClass(mins) {
  if (mins >= 10) return 'age-late';
  if (mins >= 5) return 'age-warn';
  return '';
}

async function patchOrder(id, payload) {
  const res = await fetch(`/api/kitchen/orders/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    alert(`Failed: ${body.error || res.status}`);
    return null;
  }
  return res.json();
}

function renderOrder(o) {
  const mins = ageMinutes(o.created_at);

  const head = el('div', { className: 'card-head' }, [
    el('span', { className: 'table', text: `Table ${o.table_number}` }),
    el('span', { className: 'order-id', text: `#${o.id}` }),
    el('span', { className: 'age', text: `${mins}m ago` }),
  ]);

  const items = el('ul', { className: 'items' },
    o.items.map((it) =>
      el('li', {}, [
        el('span', { className: 'qty', text: `${it.qty}×` }),
        el('span', { text: it.name_snapshot }),
      ])
    )
  );

  const nodes = [head, items];

  if (o.notes) {
    nodes.push(el('div', { className: 'notes', text: `Note: ${o.notes}` }));
  }

  const actions = el('div', { className: 'actions' });

  if (o.status === 'placed') {
    actions.appendChild(el('button', {
      className: 'btn-prep', text: 'Start preparing',
      onclick: async () => {
        await patchOrder(o.id, { status: 'preparing' });
        refresh();
      },
    }));
  }
  if (o.status === 'preparing') {
    actions.appendChild(el('button', {
      className: 'btn-ready', text: 'Mark ready',
      onclick: async () => {
        await patchOrder(o.id, { status: 'ready' });
        refresh();
      },
    }));
  }
  if (o.status === 'ready') {
    actions.appendChild(el('button', {
      className: 'btn-serve', text: 'Mark served',
      onclick: async () => {
        await patchOrder(o.id, { status: 'served' });
        refresh();
      },
    }));
  }

  actions.appendChild(el('button', {
    className: 'btn-cancel', text: 'Cancel',
    onclick: async () => {
      if (!confirm(`Cancel order #${o.id}?`)) return;
      await patchOrder(o.id, { status: 'cancelled' });
      refresh();
    },
  }));

  nodes.push(actions);

  const cls = ['card', ageClass(mins)];
  if (o.status === 'preparing') cls.push('preparing');
  if (o.status === 'ready') cls.push('ready');

  return el('div', { className: cls.filter(Boolean).join(' ') }, nodes);
}

async function refresh() {
  try {
    const res = await fetch('/api/kitchen/orders');
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
    $('status').textContent = `${orders.length} active · updated ${now}`;
  } catch (e) {
    $('status').textContent = 'error: ' + e.message;
  }
}

// Initial + auto-refresh every 5 seconds
refresh();
setInterval(refresh, 5000);
