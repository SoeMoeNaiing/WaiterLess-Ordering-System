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
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

// ---------- State ----------

let currentMenu = null;
let menuByItemId = new Map();
let cart = [];

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
  // If we already showed a confirmation, don't overwrite it
  if ($('cart-inner').dataset.mode === 'confirmation') return;

  const root = $('cart-items');
  root.replaceChildren();

  if (cart.length === 0) {
    root.appendChild(el('div', {
      className: 'muted',
      text: 'Cart is empty.',
      style: 'padding: 1rem 0; color:#888;',
    }));
    $('place-order').disabled = true;
    return;
  }

  $('place-order').disabled = false;

  for (const entry of cart) {
    const item = menuByItemId.get(entry.itemId);
    if (!item) continue;

    const dec = el('button', { text: '−', onclick: () => setQty(entry.itemId, entry.qty - 1) });
    const inc = el('button', { text: '+', onclick: () => setQty(entry.itemId, entry.qty + 1) });
    const qty = el('span', { text: String(entry.qty), style: 'min-width: 1.5rem; text-align:center;' });

    root.appendChild(el('div', { className: 'cart-row' }, [
      el('span', { className: 'name', text: `${item.name} — ${formatPrice(item.price)}` }),
      el('span', { className: 'qty-controls' }, [dec, qty, inc]),
    ]));
  }
}

// ---------- Menu rendering ----------

function renderMenu() {
  const root = $('root');
  root.replaceChildren();

  if (!currentMenu || currentMenu.length === 0) {
    root.appendChild(el('div', {
      className: 'empty',
      text: 'This menu is empty. Please ask a staff member.',
    }));
    return;
  }

  for (const cat of currentMenu) {
    root.appendChild(el('h2', { text: cat.name }));
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
  if (soldOut) price.appendChild(el('span', { className: 'sold', text: 'sold out' }));

  const nameRow = el('div', { className: 'name' }, [item.name]);
  const inCart = cart.find((e) => e.itemId === item.id);
  if (inCart) nameRow.appendChild(el('span', { className: 'qty-badge', text: `×${inCart.qty}` }));

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
  btn.textContent = 'Placing order…';

  try {
    const res = await fetch('/api/customer/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

    showConfirmation(body);
    cart = [];
    saveCart(token);
    renderCartBar();
    renderMenu();
  } catch (e) {
    err.textContent = e.message || 'Could not place order.';
    err.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Place order';
  }
}

function showConfirmation({ order }) {
  const token = getToken();
  window.location.href = `/t/${token}/order/${order.id}`;
}

// ---------- Boot ----------

async function boot() {
  const token = getToken();
  if (!token) {
    $('root').innerHTML = '';
    $('root').appendChild(el('div', { className: 'error', text: 'Invalid URL.' }));
    return;
  }

  cart = loadCart(token);

  try {
    const res = await fetch(`/api/customer/menu?token=${encodeURIComponent(token)}`);
    if (!res.ok) {
      let msg = 'Could not load menu.';
      if (res.status === 404) msg = 'This QR code is not recognized.';
      else if (res.status === 410) msg = 'This table is no longer active. Please ask a staff member.';
      $('root').innerHTML = '';
      $('root').appendChild(el('div', { className: 'error', text: msg }));
      return;
    }

    const data = await res.json();
    $('table-label').textContent = `Table ${data.table.table_number}`;

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
    $('root').appendChild(el('div', { className: 'error', text: 'Network error: ' + e.message }));
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
