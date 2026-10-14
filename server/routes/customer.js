import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', '..', 'public', 'customer');

function findTableByToken(db, token) {
  if (typeof token !== 'string' || token === '') return { error: 'missing' };
  const table = db.prepare('SELECT * FROM tables WHERE qr_token = ?').get(token);
  if (!table) return { error: 'notfound' };
  if (!table.is_active) return { error: 'inactive' };
  return { table };
}

function validateItems(db, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, status: 400, error: 'items must be a non-empty array' };
  }
  const resolved = [];
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, status: 400, error: 'each item must be an object' };
    }
    const { itemId, qty } = entry;
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return { ok: false, status: 400, error: 'itemId must be a positive integer' };
    }
    if (!Number.isInteger(qty) || qty <= 0 || qty > 99) {
      return { ok: false, status: 400, error: 'qty must be between 1 and 99' };
    }
    const row = db.prepare(
      `SELECT mi.id, mi.name, mi.price, mi.is_active, mi.is_available,
              mi.category_id, c.is_active AS cat_active
         FROM menu_items mi
         LEFT JOIN categories c ON c.id = mi.category_id
        WHERE mi.id = ?`
    ).get(itemId);
    if (!row) return { ok: false, status: 400, error: `item ${itemId} not found` };
    if (!row.is_active) return { ok: false, status: 400, error: `item ${itemId} is not available` };
    if (row.category_id != null && !row.cat_active) {
      return { ok: false, status: 400, error: `item ${itemId} is not available` };
    }
    if (!row.is_available) return { ok: false, status: 400, error: `item ${itemId} is sold out` };
    resolved.push({ itemId: row.id, qty, name: row.name, price: row.price });
  }
  return { ok: true, resolved };
}

export function customerRouter({ db }) {
  const router = Router();

  // GET /t/:token/order/:id — status page
  router.get('/t/:token/order/:id', (req, res) => {
    const { error } = findTableByToken(db, req.params.token);
    if (error === 'notfound') return res.status(404).send('Table not found');
    if (error === 'inactive') return res.status(410).send('This table is no longer active');
    if (error) return res.status(400).send('Missing token');
    res.type('html').send(readFileSync(join(PUBLIC_DIR, 'status.html'), 'utf8'));
  });

  // GET /t/:token — menu page
  router.get('/t/:token', (req, res) => {
    const { error } = findTableByToken(db, req.params.token);
    if (error === 'notfound') return res.status(404).send('Table not found');
    if (error === 'inactive') return res.status(410).send('This table is no longer active');
    if (error) return res.status(400).send('Missing token');
    res.type('html').send(readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8'));
  });

  // GET /api/customer/menu?token=...
  router.get('/api/customer/menu', (req, res) => {
    const { table, error } = findTableByToken(db, req.query.token);
    if (error === 'notfound') return res.status(404).json({ error: 'table not found' });
    if (error === 'inactive') return res.status(410).json({ error: 'table inactive' });
    if (error) return res.status(400).json({ error: 'token is required' });

    const categories = db.prepare(
      'SELECT id, name FROM categories WHERE is_active = 1 ORDER BY sort_order, name'
    ).all();

    const items = db.prepare(
      `SELECT id, category_id, name, description, price, image_path, is_available
         FROM menu_items
        WHERE is_active = 1
          AND (category_id IS NULL
               OR category_id IN (SELECT id FROM categories WHERE is_active = 1))
        ORDER BY sort_order, name`
    ).all();

    const byCategory = new Map(categories.map((c) => [c.id, []]));
    const uncategorized = [];
    for (const it of items) {
      if (it.category_id != null && byCategory.has(it.category_id)) {
        byCategory.get(it.category_id).push(it);
      } else {
        uncategorized.push(it);
      }
    }

    const result = categories
      .map((c) => ({ id: c.id, name: c.name, items: byCategory.get(c.id) }))
      .filter((c) => c.items.length > 0);

    if (uncategorized.length > 0) {
      result.push({ id: null, name: 'Other', items: uncategorized });
    }

    res.json({
      table: { id: table.id, table_number: table.table_number, label: table.label },
      categories: result,
    });
  });

  // POST /api/customer/orders
  router.post('/api/customer/orders', (req, res) => {
    const { token, items, notes } = req.body ?? {};

    const { table, error } = findTableByToken(db, token);
    if (error === 'notfound') return res.status(404).json({ error: 'table not found' });
    if (error === 'inactive') return res.status(410).json({ error: 'table inactive' });
    if (error) return res.status(400).json({ error: 'token is required' });

    const checked = validateItems(db, items);
    if (!checked.ok) return res.status(checked.status).json({ error: checked.error });

    const { resolved } = checked;
    const total = resolved.reduce((sum, r) => sum + r.price * r.qty, 0);
    const cleanNotes = typeof notes === 'string' && notes.trim() !== ''
      ? notes.trim().slice(0, 500)
      : null;

    let orderId;
    try {
      const insert = db.transaction(() => {
        const orderResult = db.prepare(
          'INSERT INTO orders (table_id, total, notes) VALUES (?, ?, ?)'
        ).run(table.id, total, cleanNotes);
        const oid = orderResult.lastInsertRowid;

        const insertItem = db.prepare(
          `INSERT INTO order_items
             (order_id, menu_item_id, name_snapshot, price_snapshot, qty)
           VALUES (?, ?, ?, ?, ?)`
        );
        for (const r of resolved) {
          insertItem.run(oid, r.itemId, r.name, r.price, r.qty);
        }
        return oid;
      });
      orderId = insert();
    } catch (err) {
      console.error('[customer.orders] insert error:', err);
      return res.status(500).json({ error: 'could not create order' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const orderItems = db
      .prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id')
      .all(orderId);

    res.status(201).json({ order, items: orderItems });
  });

  // GET /api/customer/orders/:id?token=...
  router.get('/api/customer/orders/:id', (req, res) => {
    const orderId = Number(req.params.id);
    if (!Number.isInteger(orderId) || orderId <= 0) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const { table, error } = findTableByToken(db, req.query.token);
    if (error === 'notfound') return res.status(404).json({ error: 'not found' });
    if (error === 'inactive') return res.status(410).json({ error: 'table inactive' });
    if (error) return res.status(400).json({ error: 'token is required' });

    const order = db
      .prepare('SELECT * FROM orders WHERE id = ? AND table_id = ?')
      .get(orderId, table.id);

    if (!order) return res.status(404).json({ error: 'not found' });

    const items = db
      .prepare('SELECT id, name_snapshot, price_snapshot, qty, notes FROM order_items WHERE order_id = ? ORDER BY id')
      .all(order.id);

    res.json({
      order: {
        id: order.id,
        status: order.status,
        total: order.total,
        notes: order.notes,
        created_at: order.created_at,
        updated_at: order.updated_at,
      },
      items,
    });
  });

  return router;
}
