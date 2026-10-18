import { initI18n, t, getLang, setLang, applyTranslations } from '/i18n/i18n.js';

const $ = (id) => document.getElementById(id);

let currencySymbol = '';
let restaurantName = '';

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

// ---------- State ----------

let currentMenu = null;
let lastMenuData = null;
let menuByItemId = new Map();
let cart = [];

// Cart entry: { itemId, qty, selections: [{group_id, choice_id}], notes, signature }
// signature is a stable string so identical configurations merge

function makeSignature(itemId, selections, notes) {
  const sels = [...(selections || [])].sort((a, b) =>
    a.group_id - b.group_id || a.choice_id - b.choice_id
  );
  const selSig = sels.map((s) => `${s.group_id}:${s.choice_id}`).join(',');
  const notesSig = (notes || '').trim();
  return `${itemId}|${selSig}|${notesSig}`;
}

// ---------- Cart ----------

function cartKey(token) { return `cart:${token}`; }

function loadCart(token) {
  try {
    const raw = localStorage.getItem(cartKey(token));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((e) => e && Number.isInteger(e.itemId) && e.qty > 0).map((e) => ({
      itemId: e.itemId,
      qty: e.qty,
      selections: Array.isArray(e.selections) ? e.selections : [],
      notes: typeof e.notes === 'string' ? e.notes : '',
      signature: e.signature || makeSignature(e.itemId, e.selections, e.notes),
    }));
  } catch {
    return [];
  }
}

function saveCart(token) {
  localStorage.setItem(cartKey(token), JSON.stringify(cart));
}

function addToCart(itemId, selections, notes) {
  const signature = makeSignature(itemId, selections, notes);
  const existing = cart.find((e) => e.signature === signature);
  if (existing) existing.qty += 1;
  else cart.push({ itemId, qty: 1, selections: selections || [], notes: notes || '', signature });
  saveCart(getToken());
  renderMenu();
  renderCartBar();
  renderCartPanel();
  showCartToast();
}

function setQty(signature, qty) {
  if (qty <= 0) cart = cart.filter((e) => e.signature !== signature);
  else {
    const e = cart.find((x) => x.signature === signature);
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

function selectionsToNames(item, selections) {
  // Convert [{group_id, choice_id}] to [{group, choice}] using item.option_groups
  const groups = item.option_groups || [];
  const out = [];
  for (const sel of selections || []) {
    const g = groups.find((x) => x.id === sel.group_id);
    if (!g) continue;
    const c = g.choices.find((x) => x.id === sel.choice_id);
    if (!c) continue;
    out.push({ group: g.name, choice: c.name });
  }
  return out;
}

// ---------- Cart bar ----------

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

    const dec = el('button', { text: '\u2212', onclick: () => setQty(entry.signature, entry.qty - 1) });
    const inc = el('button', { text: '+', onclick: () => setQty(entry.signature, entry.qty + 1) });
    const qty = el('span', { text: String(entry.qty), style: 'min-width: 1.5rem; text-align:center;' });

    const options = selectionsToNames(item, entry.selections);
    const optionsRow = options.length > 0
      ? el('div', { className: 'cart-line-options' },
          options.map((o) => el('span', { className: 'cart-line-option', text: o.choice }))
        )
      : null;

    const notesRow = entry.notes
      ? el('div', { style: 'font-size:0.75rem;color:#b02a37;margin-top:0.2rem;', text: `“${entry.notes}”` })
      : null;

    const nameBlock = el('div', { className: 'name' }, [
      el('span', { text: `${item.name} — ${formatPrice(item.price)}` }),
      optionsRow,
      notesRow,
    ]);

    root.appendChild(el('div', { className: 'cart-row' }, [
      nameBlock,
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
      root.appendChild(renderMenuItem(item));
    }
  }
}

function renderMenuItem(item) {
  const soldOut = item.is_available === 0;
  const hasOptions = Array.isArray(item.option_groups) && item.option_groups.length > 0;

  const img = el('img', {
    src: item.image_path || '/admin/placeholder.svg',
    alt: item.name,
    onerror: (e) => { e.target.src = '/admin/placeholder.svg'; },
  });

  const price = el('span', { className: 'price', text: formatPrice(item.price) });
  if (soldOut) price.appendChild(el('span', { className: 'sold', text: t('customer.sold_out') }));

  const nameRow = el('div', { className: 'name' }, [
    item.name,
    hasOptions ? el('span', { className: 'customize-badge', text: '\u2699 Customize' }) : null,
  ]);

  // How many of this item (any signature) are in cart?
  const inCartQty = cart.filter((e) => e.itemId === item.id).reduce((s, e) => s + e.qty, 0);
  if (inCartQty > 0) {
    nameRow.appendChild(el('span', { className: 'qty-badge', text: `\u00d7${inCartQty}` }));
  }

  const info = el('div', { className: 'info' }, [
    nameRow,
    item.description ? el('div', { className: 'desc', text: item.description }) : null,
    price,
  ]);

  const div = el('div', { className: `item${soldOut ? ' sold-out' : ''}` }, [img, info]);
  if (!soldOut) {
    div.onclick = () => {
      if (hasOptions) openPicker(item);
      else addToCart(item.id, [], '');
    };
  }
  return div;
}

// ---------- Picker sheet ----------

let currentPickerItem = null;
let currentPickerState = {};

function openPicker(item) {
  currentPickerItem = item;
  currentPickerState = { selections: {}, notes: '' };

  for (const g of item.option_groups) {
    // Pre-select default choice if there is one
    const def = g.choices.find((c) => c.is_default === 1);
    if (def) {
      currentPickerState.selections[g.id] = g.is_single_choice ? [def.id] : [def.id];
    } else {
      currentPickerState.selections[g.id] = [];
    }
  }

  renderPickerSheet();
  $('picker-overlay').classList.add('show');
}

function closePicker() {
  $('picker-overlay').classList.remove('show');
  currentPickerItem = null;
  currentPickerState = {};
}

function pickerIsValid() {
  if (!currentPickerItem) return false;
  for (const g of currentPickerItem.option_groups) {
    if (g.is_required) {
      const picked = currentPickerState.selections[g.id] || [];
      if (picked.length === 0) return false;
    }
  }
  return true;
}

function renderPickerSheet() {
  const item = currentPickerItem;
  if (!item) return;

  const sheet = $('picker-sheet');
  sheet.replaceChildren();

  const head = el('div', { className: 'picker-head' }, [
    el('h3', { text: item.name }),
    el('button', { className: 'picker-close', text: '\u00d7', onclick: closePicker }),
  ]);

  const body = el('div', { className: 'picker-body' });

  for (const g of item.option_groups) {
    const picked = currentPickerState.selections[g.id] || [];
    const hintText = g.is_required
      ? (g.is_single_choice ? 'Required — pick one' : 'Required')
      : (g.is_single_choice ? 'Optional — pick one' : 'Optional');

    const groupEl = el('div', { className: 'picker-group' }, [
      el('div', { className: 'picker-group-head' }, [
        el('span', { className: 'picker-group-name', text: g.name }),
        el('span', {
          className: `picker-group-hint${g.is_required ? ' required' : ''}`,
          text: hintText,
        }),
      ]),
    ]);

    for (const c of g.choices) {
      const isSelected = picked.includes(c.id);
      const input = el('input', {
        type: g.is_single_choice ? 'radio' : 'checkbox',
        name: g.is_single_choice ? `group-${g.id}` : undefined,
        checked: isSelected,
      });

      input.addEventListener('change', () => {
        if (g.is_single_choice) {
          currentPickerState.selections[g.id] = [c.id];
        } else {
          const list = currentPickerState.selections[g.id] || [];
          const idx = list.indexOf(c.id);
          if (idx >= 0) list.splice(idx, 1);
          else list.push(c.id);
          currentPickerState.selections[g.id] = list;
        }
        renderPickerSheet();
      });

      const row = el('label', {
        className: `picker-choice${isSelected ? ' selected' : ''}`,
      }, [
        input,
        el('span', { text: c.name }),
      ]);
      groupEl.appendChild(row);
    }

    body.appendChild(groupEl);
  }

  // Notes field
  const notesGroup = el('div', { className: 'picker-group' }, [
    el('label', { className: 'picker-notes-label', text: 'Special request (optional)' }),
    (() => {
      const ta = el('textarea', {
        className: 'picker-notes',
        maxLength: 200,
        placeholder: 'e.g. no onions, extra sauce',
      });
      ta.value = currentPickerState.notes || '';
      ta.addEventListener('input', (e) => {
        currentPickerState.notes = e.target.value;
      });
      return ta;
    })(),
  ]);
  body.appendChild(notesGroup);

  const valid = pickerIsValid();
  const foot = el('div', { className: 'picker-foot' }, [
    el('button', {
      className: 'picker-add',
      disabled: !valid,
      text: valid
        ? `Add to cart — ${formatPrice(item.price)}`
        : 'Fill required options',
      onclick: () => {
        if (!pickerIsValid()) return;
        const selections = [];
        for (const g of item.option_groups) {
          for (const cid of currentPickerState.selections[g.id] || []) {
            selections.push({ group_id: g.id, choice_id: cid });
          }
        }
        addToCart(item.id, selections, currentPickerState.notes.trim());
        closePicker();
      },
    }),
    el('div', { className: 'picker-hint' }),
  ]);

  sheet.appendChild(head);
  sheet.appendChild(body);
  sheet.appendChild(foot);
}

// ---------- Toast ----------

let cartToastTimer = null;
function showCartToast() {
  let tEl = $('cart-toast');
  if (!tEl) {
    tEl = document.createElement('div');
    tEl.id = 'cart-toast';
    tEl.className = 'cart-toast';
    document.body.appendChild(tEl);
  }
  tEl.textContent = `\u2713 ${t('customer.view_cart')} (${cartCount()})`;
  tEl.classList.add('show');
  clearTimeout(cartToastTimer);
  cartToastTimer = setTimeout(() => tEl.classList.remove('show'), 1400);
}

// ---------- Order submit ----------

async function placeOrder() {
  const btn = $('place-order');
  const err = $('cart-error');
  err.style.display = 'none';
  err.textContent = '';

  if (cart.length === 0) return;

  const token = getToken();
  const payload = {
    token,
    items: cart.map((e) => ({
      itemId: e.itemId,
      qty: e.qty,
      selections: e.selections,
      notes: e.notes || null,
    })),
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
$('picker-overlay').onclick = (e) => {
  if (e.target.id === 'picker-overlay') closePicker();
};

boot();
