import { initI18n, t, getLang, setLang, applyTranslations } from '/i18n/i18n.js';

const $ = (id) => document.getElementById(id);

function getToken() {
  const m = window.location.pathname.match(/^\/t\/([^/?#]+)/);
  return m ? m[1] : null;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'className') node.className = v;
    else if (k === 'onerror') node.onerror = v;
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
  const num = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
  return currencySymbol ? `${num} ${currencySymbol}` : num;
}

// ---------- State ----------

let currentMenu = null;
let lastMenuData = null;
let menuByItemId = new Map();
let cart = [];

// Settings cache (currency, restaurant name)
let currencySymbol = '';
let restaurantName = '';

async function loadPublicSettings() {
  try {
    const s = await fetch('/api/public/settings').then((r) => r.json());
    currencySymbol = s.currency || '';
    restaurantName = s.restaurant_name || '';
    if (restaurantName) {
      document.title = restaurantName;
      const h = $('restaurant');
      if (h) h.textContent = restaurantName;
    }
  } catch (e) {
    console.warn('[settings] load failed', e);
  }
}

// ---------- Cart ----------

function cartKey(token) { return `cart:${token}`; }

function loadCart(token) {
  try {
    const raw = localStorage.getItem(cartKey(token));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((e) => e && Number.isInteger(e.itemId) && e.qty > 0)
      : [];
  } catch {
    return [];
  }
}

function saveCart(token) {
  localStorage.setItem(cartKey(token), JSON.stringify(cart));
}

function addToCart(itemId) {
  const existing = cart.find((e) => e.itemId === itemId);
  if (existing) existing.qty += 1;
  else cart.push({ itemId, qty: 1 });
  saveCart(getToken());
  renderMenu();
  renderCartBar();
  renderCartPanel();
}

function setQty(itemId, qty) {
  if (qty <= 0) cart = cart.filter((e) => e.itemId !== itemId);
  else {
    const e = cart.find((x) => x.itemId === itemId);
    if (e) e.qty = qty;
  }
  saveCart(getToken());
  renderMenu();
  renderCartBar();
  renderCartPanel();
}

function cartCount() {
  return cart.reduce((s, e) => s + e.qty, 0);
}

function cartTotal() {
  let total = 0;
  for (const e of cart) {
    const item = menuByItemId.get(e.itemId);
    if (item) total += item.price * e.qty;
  }
  return total;
}

function renderCartBar() {
  const bar = $('cart-bar');
  const count = cartCount();
  if (count === 0) {
    bar.classList.remove('show');
    return;
  }
  $('cart-count').textContent = String(count);
  $('cart-total').textContent = formatPrice(cartTotal());
  bar.classList.add('show');
}

function renderCartPanel() {
  if ($('cart-inner').dataset.mode === 'confirmation') return;

  const root = $('cart-items');
  root.replaceChildren();

  if (cart.length === 0) {
    root.appendChild(el('div', {
      className: 'muted',
      text: t('customer.cart_empty'),
      style: 'padding: 1rem 0; color:#888;',
    }));
    $('place-order').disabled = true;
    return;
  }

  $('place-order').disabled = false;

  for (const entry of cart) {
    const item = menuByItemId.get(entry.itemId);
    if (!item) continue;

    const dec = el('button', { text: '\u2212', onclick: () => setQty(entry.itemId, entry.qty - 1) });
    const inc = el('button', { text: '+', onclick: () => setQty(entry.itemId, entry.qty + 1) });
    const qty = el('span', { text: String(entry.qty), style: 'min-width: 1.5rem; text-align:center;' });

    root.appendChild(el('div', { className: 'cart-row' }, [
      el('span', { className: 'name', text: `${item.name} \u2014 ${formatPrice(item.price)}` }),
      el('span', { className: 'qty-controls' }, [dec, qty, inc]),
    ]));
  }
}

// ---------- Menu rendering ----------

function renderMenu() {
  const root = $('root');
  root.replaceChildren();

  if (!currentMenu || currentMenu.length === 0) {
    root.appendChild(el('div', { className: 'empty', text: t('customer.empty_menu') }));
    return;
  }

  for (const cat of currentMenu) {
    const catName = cat.id === null ? t('customer.other') : cat.name;
    root.appendChild(el('h2', { text: catName }));
    for (const item of cat.items) {
      root.appendChild(renderItemWithCart(item));
    }
  }
}

function renderItemWithCart(item) {
  const soldOut = item.is_available === 0;

  const img = el('img', {
    src: item.image_path || '/admin/placeholder.svg',
    alt: item.name,
    onerror: (e) => { e.target.src = '/admin/placeholder.svg'; },
  });

  const price = el('span', { className: 'price', text: formatPrice(item.price) });
  if (soldOut) price.appendChild(el('span', { className: 'sold', text: t('customer.sold_out') }));

  const nameRow = el('div', { className: 'name' }, [item.name]);
  const inCart = cart.find((e) => e.itemId === item.id);
  if (inCart) nameRow.appendChild(el('span', { className: 'qty-badge', text: `\u00d7${inCart.qty}` }));

  const info = el('div', { className: 'info' }, [
    nameRow,
    item.description ? el('div', { className: 'desc', text: item.description }) : null,
    price,
  ]);

  const div = el('div', { className: `item${soldOut ? ' sold-out' : ''}` }, [img, info]);
  if (!soldOut) div.onclick = () => addToCart(item.id);
  return div;
}

// ---------- Submit order ----------

async function placeOrder() {
  const btn = $('place-order');
  const err = $('cart-error');
  err.style.display = 'none';
  err.textContent = '';

  if (cart.length === 0) return;

  const token = getToken();
  const payload = {
    token,
    items: cart.map((e) => ({ itemId: e.itemId, qty: e.qty })),
  };

  btn.disabled = true;
  btn.textContent = t('customer.placing');

  try {
    const res = await fetch('/api/customer/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

    cart = [];
    saveCart(token);
    // Redirect to the LIST page (not the legacy single-order page)
    window.location.href = `/t/${token}/orders`;
  } catch (e) {
    err.textContent = e.message || t('customer.error_generic');
    err.style.display = 'block';
    btn.disabled = false;
    btn.textContent = t('customer.place_order');
  }
}

// ---------- Boot ----------

async function boot() {
  const token = getToken();
  if (!token) {
    $('root').innerHTML = '';
    $('root').appendChild(el('div', { className: 'error', text: t('customer.error_url') }));
    return;
  }

  await initI18n();
  applyTranslations();
  await loadPublicSettings();

  // Reflect the current language and wire the switcher
  const langSelect = $('lang-select');
  if (langSelect) {
    langSelect.value = getLang();
    langSelect.addEventListener('change', async (e) => {
      await setLang(e.target.value);
      if (lastMenuData) {
        $('table-label').textContent = `${t('customer.table')} ${lastMenuData.table.table_number}`;
      }
      renderMenu();
      renderCartPanel();
    });
  }

  cart = loadCart(token);

  try {
    const res = await fetch(`/api/customer/menu?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      let msg = t('customer.error_generic');
      if (res.status === 404) msg = t('customer.error_404');
      else if (res.status === 410) msg = t('customer.error_410');
      $('root').innerHTML = '';
      $('root').appendChild(el('div', { className: 'error', text: msg }));
      return;
    }

    const data = await res.json();
    lastMenuData = data;
    $('table-label').textContent = `${t('customer.table')} ${data.table.table_number}`;

    menuByItemId = new Map();
    for (const cat of data.categories) {
      for (const it of cat.items) menuByItemId.set(it.id, it);
    }

    cart = cart.filter((e) => menuByItemId.has(e.itemId));
    saveCart(token);

    currentMenu = data.categories;
    renderMenu();
    renderCartBar();
    renderCartPanel();
  } catch (e) {
    $('root').innerHTML = '';
    $('root').appendChild(el('div', {
      className: 'error',
      text: `${t('customer.error_network')}: ${e.message}`,
    }));
  }
}

// ---------- Wiring ----------

$('cart-bar').onclick = () => $('cart-panel').classList.add('show');
$('cart-close').onclick = () => $('cart-panel').classList.remove('show');
$('cart-panel').onclick = (e) => {
  if (e.target === $('cart-panel')) $('cart-panel').classList.remove('show');
};
$('place-order').onclick = placeOrder;

boot();
