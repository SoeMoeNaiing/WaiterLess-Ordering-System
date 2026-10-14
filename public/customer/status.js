const $ = (id) => document.getElementById(id);

function parseUrl() {
  const m = window.location.pathname.match(/^\/t\/([^/?#]+)\/order\/([^/?#]+)/);
  return m ? { token: m[1], orderId: m[2] } : null;
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

function statusInfo(status) {
  switch (status) {
    case 'placed':
      return { label: 'Order confirmed', sub: 'Being prepared', cls: 'st-placed' };
    case 'preparing':
      return { label: 'Order confirmed', sub: 'Being prepared', cls: 'st-placed' };
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

function render(data) {
  const { order, items } = data;
  const root = $('root');
  root.replaceChildren();

  const info = statusInfo(order.status);

  const statusCard = el('div', { className: `card status-card ${info.cls}` }, [
    el('div', { className: 'status-label', text: info.label }),
    el('div', { className: 'status-sub', text: info.sub }),
    el('div', { className: 'status-meta', text: `Order #${order.id}` }),
  ]);
  root.appendChild(statusCard);

  const itemsCard = el('div', { className: 'card' });
  const list = el('ul', { className: 'items' });
  for (const it of items) {
    list.appendChild(el('li', {}, [
      el('span', { className: 'qty', text: `${it.qty}\u00d7` }),
      el('span', { className: 'name', text: it.name_snapshot }),
      el('span', { className: 'price', text: formatPrice(it.price_snapshot * it.qty) }),
    ]));
  }
  itemsCard.appendChild(list);
  itemsCard.appendChild(el('div', { className: 'total-row' }, [
    el('span', { text: 'Total' }),
    el('span', { text: formatPrice(order.total) }),
  ]));
  root.appendChild(itemsCard);

  const parsed = parseUrl();
  if (parsed && order.status !== 'cancelled') {
    root.appendChild(el('button', {
      className: 'order-more',
      text: 'Order more',
      onclick: () => { window.location.href = `/t/${parsed.token}`; },
    }));
  }
}

let lastStatus = null;

async function refresh() {
  const parsed = parseUrl();
  if (!parsed) {
    $('root').innerHTML = '';
    $('root').appendChild(el('div', { className: 'error', text: 'Invalid URL.' }));
    return;
  }

  try {
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

    if (data.order.status !== lastStatus) {
      render(data);
      lastStatus = data.order.status;
    }
  } catch (e) {
    $('root').innerHTML = '';
    $('root').appendChild(el('div', { className: 'error', text: 'Network error: ' + e.message }));
  }
}

refresh();
setInterval(refresh, 3000);
