const $ = (id) => document.getElementById(id);

function parseUrl() {
  // /t/<token>/orders  OR  /t/<token>/order/<id>
  let m = window.location.pathname.match(/^\/t\/([^/?#]+)\/orders\/?$/);
  if (m) return { token: m[1], mode: 'list' };
  m = window.location.pathname.match(/^\/t\/([^/?#]+)\/order\/([^/?#]+)/);
  if (m) return { token: m[1], orderId: m[2], mode: 'single' };
  return null;
}

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

function formatPrice(n) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

function timeAgo(sqlTimestamp) {
  const iso = sqlTimestamp.replace(' ', 'T') + 'Z';
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins === 1) return '1 min ago';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? '1 hour ago' : `${hrs} hours ago`;
}

function statusInfo(status) {
  switch (status) {
    case 'placed':
    case 'preparing':
    case 'ready':
      return { label: 'Order confirmed', sub: 'Being prepared', cls: 'st-placed' };
    case 'served':
      return { label: 'Served', sub: 'Enjoy your meal', cls: 'st-served' };
    case 'cancelled':
      return { label: 'Order rejected', sub: 'Please speak to a staff member', cls: 'st-cancelled' };
    default:
      return { label: status, sub: '', cls: '' };
  }
}

function renderOrderCard(order) {
  const info = statusInfo(order.status);

  const head = el('div', { className: `order-card-head ${info.cls}` }, [
    el('div', { className: 'order-label', text: info.label }),
    el('div', { className: 'order-sub', text: info.sub }),
  ]);

  const meta = el('div', { className: 'order-meta' }, [
    el('span', { className: 'order-id', text: `Order #${order.id}` }),
    el('span', { className: 'order-time', text: timeAgo(order.created_at) }),
  ]);

  const list = el('ul', { className: 'items' });
  for (const it of order.items) {
    list.appendChild(el('li', {}, [
      el('span', { className: 'qty', text: `${it.qty}\u00d7` }),
      el('span', { className: 'name', text: it.name_snapshot }),
      el('span', { className: 'price', text: formatPrice(it.price_snapshot * it.qty) }),
    ]));
  }

  const total = el('div', { className: 'total-row' }, [
    el('span', { text: 'Total' }),
    el('span', { text: formatPrice(order.total) }),
  ]);

  return el('div', { className: 'card order-card' }, [head, meta, list, total]);
}

function render(orders, token) {
  const root = $('root');
  root.replaceChildren();

  if (orders.length === 0) {
    root.appendChild(el('div', {
      className: 'card',
      style: 'text-align:center; color:#888; padding: 2rem 1rem;',
      text: 'No orders yet. Go back to the menu to place one.',
    }));
  } else {
    const grid = el('div', { className: 'orders-grid' });
    for (const o of orders) grid.appendChild(renderOrderCard(o));
    root.appendChild(grid);
  }

  root.appendChild(el('button', {
    className: 'order-more',
    text: 'Order more',
    onclick: () => { window.location.href = `/t/${token}`; },
  }));
}

function renderSingle(order, token) {
  // Fallback for old /t/<token>/order/<id> bookmarks
  render([order], token);
}

let lastSnapshot = '';

async function refresh() {
  const parsed = parseUrl();
  if (!parsed) {
    $('root').innerHTML = '';
    $('root').appendChild(el('div', { className: 'error', text: 'Invalid URL.' }));
    return;
  }

  try {
    if (parsed.mode === 'list') {
      const res = await fetch(`/api/customer/orders?token=${encodeURIComponent(parsed.token)}`);
      if (!res.ok) {
        let msg = 'Could not load orders.';
        if (res.status === 404) msg = 'Table not found.';
        else if (res.status === 410) msg = 'This table is no longer active.';
        $('root').innerHTML = '';
        $('root').appendChild(el('div', { className: 'error', text: msg }));
        return;
      }
      const data = await res.json();
      $('table-label').textContent = `Table ${data.table.table_number}`;

      // Cheap change detection: hash the ids+statuses
      const sig = data.orders.map((o) => `${o.id}:${o.status}:${o.updated_at}`).join('|');
      if (sig !== lastSnapshot) {
        render(data.orders, parsed.token);
        lastSnapshot = sig;
      }
    } else {
      // single order mode
      const res = await fetch(
        `/api/customer/orders/${parsed.orderId}?token=${encodeURIComponent(parsed.token)}`
      );
      if (!res.ok) {
        let msg = 'Could not load order.';
        if (res.status === 404) msg = 'Order not found.';
        else if (res.status === 410) msg = 'This table is no longer active.';
        $('root').innerHTML = '';
        $('root').appendChild(el('div', { className: 'error', text: msg }));
        return;
      }
      const data = await res.json();
      $('table-label').textContent = `Order #${data.order.id}`;
      const sig = `${data.order.id}:${data.order.status}:${data.order.updated_at}`;
      if (sig !== lastSnapshot) {
        renderSingle(data.order, parsed.token);
        lastSnapshot = sig;
      }
    }
  } catch (e) {
    $('root').innerHTML = '';
    $('root').appendChild(el('div', { className: 'error', text: 'Network error: ' + e.message }));
  }
}

refresh();
setInterval(refresh, 3000);
