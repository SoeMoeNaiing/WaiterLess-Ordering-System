import { initI18n, t, getLang, setLang, applyTranslations } from '/i18n/i18n.js';

const $ = (id) => document.getElementById(id);

function parseUrl() {
  const list = window.location.pathname.match(/^\/t\/([^/?#]+)\/orders\/?$/);
  if (list) return { token: list[1] };
  const single = window.location.pathname.match(/^\/t\/([^/?#]+)\/order\/([^/?#]+)/);
  if (single) return { token: single[1], redirectFromSingle: true };
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
  if (mins < 1) return t('status.just_now');
  if (mins === 1) return `1 ${t('status.min_ago')}`;
  if (mins < 60) return `${mins} ${t('status.min_ago')}`;
  const hrs = Math.floor(mins / 60);
  return hrs === 1 ? `1 ${t('status.hour_ago')}` : `${hrs} ${t('status.hours_ago')}`;
}

function statusInfo(status) {
  switch (status) {
    case 'placed':
    case 'preparing':
    case 'ready':
      return { label: t('status.confirmed'), sub: t('status.preparing'), cls: 'st-placed' };
    case 'served':
      return { label: t('status.served'), sub: t('status.enjoy'), cls: 'st-served' };
    case 'cancelled':
      return { label: t('status.rejected'), sub: t('status.rejected_hint'), cls: 'st-cancelled' };
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
    el('span', { className: 'order-id', text: `${t('status.order')} #${order.id}` }),
    el('span', { className: 'order-time', text: timeAgo(order.created_at) }),
  ]);

  const items = order.items || [];
  const list = el('ul', { className: 'items' });
  for (const it of items) {
    list.appendChild(el('li', {}, [
      el('span', { className: 'qty', text: `${it.qty}\u00d7` }),
      el('span', { className: 'name', text: it.name_snapshot }),
      el('span', { className: 'price', text: formatPrice(it.price_snapshot * it.qty) }),
    ]));
  }

  const total = el('div', { className: 'total-row' }, [
    el('span', { text: t('status.total') }),
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
      text: t('status.no_orders'),
    }));
  } else {
    const grid = el('div', { className: 'orders-grid' });
    for (const o of orders) grid.appendChild(renderOrderCard(o));
    root.appendChild(grid);
  }

  root.appendChild(el('button', {
    className: 'order-more',
    text: t('customer.order_more'),
    onclick: () => { window.location.href = `/t/${token}`; },
  }));
}

let lastSnapshot = '';

async function refresh() {
  const parsed = parseUrl();
  if (!parsed) {
    $('root').innerHTML = '';
    $('root').appendChild(el('div', { className: 'error', text: t('customer.error_url') }));
    return;
  }

  if (parsed.redirectFromSingle) {
    window.location.replace(`/t/${parsed.token}/orders`);
    return;
  }

  try {
    const res = await fetch(`/api/customer/orders?token=${encodeURIComponent(parsed.token)}`);
    if (!res.ok) {
      let msg = t('status.error_generic');
      if (res.status === 404) msg = t('customer.error_404');
      else if (res.status === 410) msg = t('customer.error_410');
      $('root').innerHTML = '';
      $('root').appendChild(el('div', { className: 'error', text: msg }));
      return;
    }
    const data = await res.json();
    $('table-label').textContent = `${t('customer.table')} ${data.table.table_number}`;

    const sig = data.orders.map((o) => `${o.id}:${o.status}:${o.updated_at}`).join('|');
    if (sig !== lastSnapshot) {
      render(data.orders, parsed.token);
      lastSnapshot = sig;
    }
  } catch (e) {
    $('root').innerHTML = '';
    $('root').appendChild(el('div', { className: 'error', text: `${t('customer.error_network')}: ${e.message}` }));
  }
}

async function boot() {
  await initI18n();
  applyTranslations();

  const langSelect = $('lang-select');
  if (langSelect) {
    langSelect.value = getLang();
    langSelect.addEventListener('change', async (e) => {
      await setLang(e.target.value);
      lastSnapshot = ''; // force re-render with new language
      refresh();
    });
  }

  refresh();
  setInterval(refresh, 3000);
}

boot();
