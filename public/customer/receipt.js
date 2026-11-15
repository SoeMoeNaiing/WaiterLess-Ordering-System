import { initI18n, t, getLang, applyTranslations } from '/i18n/i18n.js';
import { renderReceiptImage } from '/customer/receipt-image.js';

const $ = (id) => document.getElementById(id);

function parseUrl() {
  const m = window.location.pathname.match(/^\/t\/([^/?#]+)\/receipt\/([^/?#]+)/);
  return m ? { token: m[1], orderId: m[2] } : null;
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') node.textContent = v;
    else if (k === 'className') node.className = v;
    else node[k] = v;
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

function formatPrice(n, currency) {
  const num = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
  return currency ? `${num} ${currency}` : num;
}

function formatDate(sqlTimestamp) {
  // SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC
  const iso = sqlTimestamp.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  const lang = getLang();

  // Date + time in the chosen language, digits consistent with the app.
  // Burmese locale gives Myanmar month names but numbers stay readable.
  const dateStr = d.toLocaleDateString(lang, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const timeStr = d.toLocaleTimeString(lang, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${dateStr} · ${timeStr}`;
}

function showError(message) {
  const receipt = $('receipt');
  receipt.replaceChildren(
    el('div', { className: 'state error' }, [
      el('div', { className: 'icon', text: '⚠' }),
      el('div', { text: message }),
    ])
  );
}

function renderReceipt({ order, items, tableNumber, settings }) {
  lastReceiptData = { order, items, tableNumber, settings };
  const receipt = $('receipt');
  receipt.replaceChildren();

  receipt.appendChild(el('h1', {
    className: 'restaurant-name',
    text: settings.restaurant_name || t('receipt.title'),
  }));
  receipt.appendChild(el('div', {
    className: 'receipt-label',
    text: t('receipt.label'),
  }));

  const meta = (label, value) =>
    el('div', { className: 'meta' }, [
      el('span', { className: 'label', text: label }),
      el('span', { className: 'value', text: value }),
    ]);

  receipt.appendChild(meta(t('receipt.order'), `#${order.id}`));
  receipt.appendChild(meta(t('receipt.table'), tableNumber));
  receipt.appendChild(meta(t('receipt.date'), formatDate(order.created_at)));

  receipt.appendChild(el('hr', { className: 'divider' }));

  const list = el('ul', { className: 'items' });
  for (const it of items) {
    const line = el('div', { className: 'item-line' }, [
      el('span', { className: 'item-qty', text: `${it.qty}×` }),
      el('span', { className: 'item-name', text: it.name_snapshot }),
      el('span', {
        className: 'item-price',
        text: formatPrice(it.price_snapshot * it.qty, settings.currency),
      }),
    ]);

    const extras = [];
    if (Array.isArray(it.options) && it.options.length > 0) {
      extras.push(el('div', {
        className: 'item-options',
        text: it.options.map((o) => o.choice_name_snapshot).join(' · '),
      }));
    }
    if (it.notes) {
      extras.push(el('div', {
        className: 'item-notes',
        text: `“${it.notes}”`,
      }));
    }

    list.appendChild(el('li', { className: 'item' }, [line, ...extras]));
  }
  receipt.appendChild(list);

  receipt.appendChild(el('hr', { className: 'divider solid' }));
  receipt.appendChild(el('div', { className: 'total-block' }, [
    el('span', { className: 'total-label', text: t('receipt.total') }),
    el('span', {
      className: 'total-amount',
      text: formatPrice(order.total, settings.currency),
    }),
  ]));

  receipt.appendChild(el('div', {
    className: 'payment-note',
    text: t('receipt.payment_due'),
  }));
  receipt.appendChild(el('div', {
    className: 'thanks',
    text: t('receipt.thanks'),
  }));

  receipt.appendChild(el('div', {
    className: 'order-id-footer',
    text: `${t('receipt.order')} #${order.id} · ${t('receipt.table')} ${tableNumber}`,
  }));
}

let lastReceiptData = null;

async function boot() {
  const parsed = parseUrl();
  if (!parsed) {
    await initI18n();
    applyTranslations();
    showError(t('receipt.error_invalid_url'));
    return;
  }

  const backLink = $('back-link');
  if (backLink) backLink.href = `/t/${parsed.token}/orders`;
  $('toolbar').style.display = 'flex';

  try {
    await initI18n();
    applyTranslations();

    const settings = await fetch('/api/public/settings').then((r) => r.json()).catch(() => ({}));
    const res = await fetch(`/api/customer/orders?token=${encodeURIComponent(parsed.token)}`);

    if (!res.ok) {
      if (res.status === 404) showError(t('receipt.error_not_available'));
      else if (res.status === 410) showError(t('customer.error_410'));
      else showError(t('receipt.error_generic'));
      return;
    }

    const data = await res.json();
    const order = data.orders.find((o) => String(o.id) === String(parsed.orderId));

    if (!order) {
      showError(t('receipt.error_not_found'));
      return;
    }

    if (order.status !== 'served') {
      showError(t('receipt.error_not_served'));
      return;
    }

    renderReceipt({
      order,
      items: order.items || [],
      tableNumber: data.table.table_number,
      settings,
    });
  } catch (e) {
    showError(`${t('customer.error_network')}: ${e.message}`);
  }
}

// ---------- Save as image ----------

async function saveAsImage() {
  if (!lastReceiptData) return;

  const btn = $('save-image');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = t('receipt.saving_image');

  try {
    const blob = await renderReceiptImage({ ...lastReceiptData, t });
    const filename = `receipt-${lastReceiptData.order.id}.png`;
    const file = new File([blob], filename, { type: 'image/png' });

    // Mobile: try the native share sheet (WhatsApp, Photos, etc.)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: t('receipt.title') });
        btn.textContent = t('receipt.image_saved');
        setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
        return;
      } catch (shareErr) {
        // User cancelled share → fall through to download
        if (shareErr.name !== 'AbortError') {
          console.warn('[receipt] share failed, falling back to download:', shareErr);
        }
      }
    }

    // Desktop / fallback: trigger a download
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    btn.textContent = t('receipt.image_saved');
    setTimeout(() => { btn.textContent = original; btn.disabled = false; }, 1500);
  } catch (e) {
    console.error('[receipt] image render failed:', e);
    btn.textContent = original;
    btn.disabled = false;
    alert('Could not save image: ' + e.message);
  }
}

// Wire the button if it exists
const saveBtn = $('save-image');
if (saveBtn) saveBtn.addEventListener('click', saveAsImage);

boot();
