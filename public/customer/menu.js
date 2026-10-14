const $ = (id) => document.getElementById(id);

function getToken() {
  // URL is /t/<token>
  const m = window.location.pathname.match(/^\/t\/([^/?#]+)/);
  return m ? m[1] : null;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'className') node.className = v;
    else if (k === 'onerror') node.onerror = v;
    else node[k] = v;
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function renderItem(item) {
  const soldOut = item.is_available === 0;

  const img = el('img', {
    src: item.image_path || '/admin/placeholder.svg',
    alt: item.name,
    onerror: (e) => { e.target.src = '/admin/placeholder.svg'; },
  });

  const price = el('span', { className: 'price', text: formatPrice(item.price) });
  if (soldOut) {
    price.appendChild(el('span', { className: 'sold', text: 'sold out' }));
  }

  const info = el('div', { className: 'info' }, [
    el('div', { className: 'name', text: item.name }),
    item.description ? el('div', { className: 'desc', text: item.description }) : null,
    price,
  ]);

  return el('div', { className: `item${soldOut ? ' sold-out' : ''}` }, [img, info]);
}

function formatPrice(n) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
}

function render(categories) {
  const root = $('root');
  root.replaceChildren();

  if (categories.length === 0) {
    root.appendChild(el('div', {
      className: 'empty',
      text: 'This menu is empty. Please ask a staff member.',
    }));
    return;
  }

  for (const cat of categories) {
    root.appendChild(el('h2', { text: cat.name }));
    for (const item of cat.items) {
      root.appendChild(renderItem(item));
    }
  }
}

async function boot() {
  const token = getToken();
  if (!token) {
    $('root').innerHTML = '';
    $('root').appendChild(el('div', { className: 'error', text: 'Invalid URL.' }));
    return;
  }

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
    render(data.categories);
  } catch (e) {
    $('root').innerHTML = '';
    $('root').appendChild(el('div', { className: 'error', text: 'Network error: ' + e.message }));
  }
}

boot();
