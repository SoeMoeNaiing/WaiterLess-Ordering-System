// Renders a receipt as a PNG using only Canvas 2D.
// No dependencies. Returns a Promise<Blob>.
//
// Usage:
//   const blob = await renderReceiptImage({ order, items, tableNumber, settings, t });

const WIDTH = 600;
const PAD = 40;
const LEFT = PAD;
const RIGHT = WIDTH - PAD;

// ---------- Formatters (kept local so this module has no imports) ----------

function formatPrice(n, currency) {
  const num = new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(n);
  return currency ? `${num} ${currency}` : num;
}

function formatDate(sqlTimestamp) {
  const iso = sqlTimestamp.replace(' ', 'T') + 'Z';
  const d = new Date(iso);
  const dateStr = d.toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
  const timeStr = d.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  return `${dateStr} · ${timeStr}`;
}

// Truncate text with ellipsis so it never overflows the column
function truncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let result = text;
  while (result.length > 1 && ctx.measureText(result + '…').width > maxWidth) {
    result = result.slice(0, -1);
  }
  return result + '…';
}

// ---------- Height estimator ----------

function estimateHeight(items) {
  let h = PAD;                 // top padding
  h += 40;                     // restaurant name
  h += 30;                     // RECEIPT label
  h += 26 * 3;                 // 3 meta rows
  h += 20;                     // dashed divider + spacing

  for (const it of items) {
    h += 32;                   // item main line
    if (Array.isArray(it.options) && it.options.length > 0) h += 24;
    if (it.notes) h += 24;
    h += 8;                    // per-item spacing
  }

  h += 20;                     // solid divider + spacing
  h += 60;                     // total row
  h += 40;                     // payment note
  h += 40;                     // thanks
  h += 40;                     // footer
  h += PAD;                    // bottom padding
  h += 40;                     // safety buffer
  return h;
}

// ---------- Main renderer ----------

export async function renderReceiptImage({ order, items, tableNumber, settings, t }) {
  if (typeof document === 'undefined') throw new Error('Canvas requires a browser');

  const height = estimateHeight(items);
  const dpr = Math.min(window.devicePixelRatio || 2, 3);

  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(WIDTH * dpr);
  canvas.height = Math.floor(height * dpr);

  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.textBaseline = 'top';

  // Background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, WIDTH, height);

  const centerX = WIDTH / 2;
  let y = PAD;

  // Restaurant name
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 24px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(settings.restaurant_name || t('receipt.title'), centerX, y);
  y += 40;

  // RECEIPT label
  ctx.fillStyle = '#9ca3af';
  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(t('receipt.label').toUpperCase(), centerX, y);
  y += 30;

  // Meta rows
  const metaRow = (label, value) => {
    ctx.textAlign = 'left';
    ctx.fillStyle = '#9ca3af';
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(label, LEFT, y);

    ctx.textAlign = 'right';
    ctx.fillStyle = '#111827';
    ctx.font = '500 13px system-ui, sans-serif';
    ctx.fillText(value, RIGHT, y);

    y += 26;
  };

  metaRow(t('receipt.order'), `#${order.id}`);
  metaRow(t('receipt.table'), tableNumber);
  metaRow(t('receipt.date'), formatDate(order.created_at));

  // Dashed divider
  ctx.strokeStyle = '#e5e7eb';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(LEFT, y + 8);
  ctx.lineTo(RIGHT, y + 8);
  ctx.stroke();
  ctx.setLineDash([]);
  y += 24;

  // Items
  const qtyColW = 32;
  const priceColW = 120;
  const nameMaxW = RIGHT - LEFT - qtyColW - priceColW - 12;

  for (const it of items) {
    // qty
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0a58ca';
    ctx.font = 'bold 14px system-ui, sans-serif';
    ctx.fillText(`${it.qty}×`, LEFT, y);

    // name
    ctx.fillStyle = '#111827';
    ctx.font = '500 14px system-ui, sans-serif';
    const nameText = truncateText(ctx, it.name_snapshot, nameMaxW);
    ctx.fillText(nameText, LEFT + qtyColW, y);

    // price
    ctx.textAlign = 'right';
    ctx.fillStyle = '#111827';
    ctx.font = '500 14px system-ui, sans-serif';
    ctx.fillText(formatPrice(it.price_snapshot * it.qty, settings.currency), RIGHT, y);
    y += 22;

    // options
    if (Array.isArray(it.options) && it.options.length > 0) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#6b7280';
      ctx.font = '12px system-ui, sans-serif';
      const optText = it.options.map((o) => o.choice_name_snapshot).join(' · ');
      ctx.fillText(truncateText(ctx, optText, nameMaxW), LEFT + qtyColW, y);
      y += 20;
    }

    // notes
    if (it.notes) {
      ctx.textAlign = 'left';
      ctx.fillStyle = '#b45309';
      ctx.font = 'italic 12px system-ui, sans-serif';
      ctx.fillText(truncateText(ctx, `"${it.notes}"`, nameMaxW), LEFT + qtyColW, y);
      y += 20;
    }

    y += 8;
  }

  // Solid divider
  ctx.strokeStyle = '#111827';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(LEFT, y);
  ctx.lineTo(RIGHT, y);
  ctx.stroke();
  y += 20;

  // Total row
  ctx.textAlign = 'left';
  ctx.fillStyle = '#6b7280';
  ctx.font = 'bold 12px system-ui, sans-serif';
  ctx.fillText(t('receipt.total').toUpperCase(), LEFT, y + 6);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#111827';
  ctx.font = 'bold 22px system-ui, sans-serif';
  ctx.fillText(formatPrice(order.total, settings.currency), RIGHT, y);
  y += 56;

  // Payment note
  ctx.textAlign = 'center';
  ctx.fillStyle = '#6b7280';
  ctx.font = 'italic 12px system-ui, sans-serif';
  ctx.fillText(t('receipt.payment_due'), centerX, y);
  y += 24;

  // Thanks
  ctx.fillStyle = '#111827';
  ctx.font = '500 13px system-ui, sans-serif';
  ctx.fillText(t('receipt.thanks'), centerX, y);
  y += 32;

  // Footer
  ctx.fillStyle = '#9ca3af';
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillText(`${t('receipt.order')} #${order.id} · ${t('receipt.table')} ${tableNumber}`, centerX, y);

  // To blob
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to generate image'));
    }, 'image/png');
  });
}
