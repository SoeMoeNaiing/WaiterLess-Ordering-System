import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getIO } from '../sockets/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', '..', 'public', 'customer');
const CUSTOMER_HTML = join(PUBLIC_DIR, 'index.html');

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
    const { itemId, qty, notes, selections } = entry;
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return { ok: false, status: 400, error: 'itemId must be a positive integer' };
    }
    if (!Number.isInteger(qty) || qty <= 0 || qty > 99) {
      return { ok: false, status: 400, error: 'qty must be between 1 and 99' };
    }

    const row = db
      .prepare(
        `SELECT mi.id, mi.name, mi.price, mi.is_active, mi.is_available,
                mi.category_id, c.is_active AS cat_active
           FROM menu_items mi
           LEFT JOIN categories c ON c.id = mi.category_id
          WHERE mi.id = ?`
      )
      .get(itemId);

    if (!row) return { ok: false, status: 400, error: `item ${itemId} not found` };
    if (!row.is_active) return { ok: false, status: 400, error: `item ${itemId} is not available` };
    if (row.category_id != null && !row.cat_active) {
      return { ok: false, status: 400, error: `item ${itemId} is not available` };
    }
    if (!row.is_available) return { ok: false, status: 400, error: `item ${itemId} is sold out` };

    // Validate option selections against this item's groups
    const groups = db.prepare(
      'SELECT * FROM menu_item_option_groups WHERE menu_item_id = ? ORDER BY sort_order, id'
    ).all(itemId);
    const groupsById = new Map(groups.map((g) => [g.id, g]));

    const choicesByGroup = new Map();
    for (const g of groups) {
      choicesByGroup.set(g.id, db.prepare(
        'SELECT id, name FROM menu_item_option_choices WHERE group_id = ?'
      ).all(g.id));
    }

    const incoming = Array.isArray(selections) ? selections : [];
    const groupedSelections = new Map();
    for (const sel of incoming) {
      if (!sel || typeof sel !== 'object') {
        return { ok: false, status: 400, error: `item ${itemId}: selection must be an object` };
      }
      if (!Number.isInteger(sel.group_id) || !groupsById.has(sel.group_id)) {
        return { ok: false, status: 400, error: `item ${itemId}: invalid group_id` };
      }
      if (!Number.isInteger(sel.choice_id)) {
        return { ok: false, status: 400, error: `item ${itemId}: invalid choice_id` };
      }
      const validChoices = choicesByGroup.get(sel.group_id) || [];
      if (!validChoices.find((c) => c.id === sel.choice_id)) {
        return { ok: false, status: 400, error: `item ${itemId}: choice doesn't belong to group` };
      }
      if (!groupedSelections.has(sel.group_id)) groupedSelections.set(sel.group_id, []);
      const arr = groupedSelections.get(sel.group_id);
      if (arr.includes(sel.choice_id)) {
        return { ok: false, status: 400, error: `item ${itemId}: duplicate choice` };
      }
      arr.push(sel.choice_id);
    }

    for (const g of groups) {
      const picked = groupedSelections.get(g.id) || [];
      if (g.is_required && picked.length === 0) {
        return { ok: false, status: 400, error: `item ${itemId}: "${g.name}" is required` };
      }
      if (g.is_single_choice && picked.length > 1) {
        return { ok: false, status: 400, error: `item ${itemId}: "${g.name}" allows only one choice` };
      }
    }

    const snapshotSelections = [];
    for (const [groupId, choiceIds] of groupedSelections) {
      const g = groupsById.get(groupId);
      const validChoices = choicesByGroup.get(groupId) || [];
      for (const cid of choiceIds) {
        const c = validChoices.find((x) => x.id === cid);
        snapshotSelections.push({ group_name: g.name, choice_name: c.name });
      }
    }

    const cleanNotes = typeof notes === 'string' && notes.trim() !== ''
      ? notes.trim().slice(0, 200)
      : null;

    resolved.push({
      itemId: row.id,
      qty,
      name: row.name,
      price: row.price,
      notes: cleanNotes,
      selections: snapshotSelections,
    });
  }
  return { ok: true, resolved };
}

export function customerRouter({ db, orderRateLimit }) {
  const router = Router();

  router.get('/t/:token', (req, res) => {
    const { error } = findTableByToken(db, req.params.token);
    if (error === 'notfound') return res.status(404).send('Table not found');
    if (error === 'inactive') return res.status(410).send('This table is no longer active');
    if (error) return res.status(400).send('Missing token');
    res.type('html').send(readFileSync(CUSTOMER_HTML, 'utf8'));
  });

  router.get('/t/:token/orders', (req, res) => {
    const { error } = findTableByToken(db, req.params.token);
    if (error === 'notfound') return res.status(404).send('Table not found');
    if (error === 'inactive') return res.status(410).send('This table is no longer active');
    if (error) return res.status(400).send('Missing token');
    res.type('html').send(readFileSync(join(PUBLIC_DIR, 'status.html'), 'utf8'));
  });

  router.get('/t/:token/order/:id', (req, res) => {
    const { error } = findTableByToken(db, req.params.token);
    if (error === 'notfound') return res.status(404).send('Table not found');
    if (error === 'inactive') return res.status(410).send('This table is no longer active');
    if (error) return res.status(400).send('Missing token');
    res.type('html').send(readFileSync(join(PUBLIC_DIR, 'status.html'), 'utf8'));
  });

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

    // Enrich each item with its option groups
    const enrichItem = (it) => {
      const groups = db.prepare(
        'SELECT * FROM menu_item_option_groups WHERE menu_item_id = ? ORDER BY sort_order, id'
      ).all(it.id);

      if (groups.length === 0) return { ...it, option_groups: [] };

      const choicesStmt = db.prepare(
        'SELECT id, name, is_default FROM menu_item_option_choices WHERE group_id = ? ORDER BY sort_order, id'
      );

      return {
        ...it,
        option_groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          is_required: g.is_required,
          is_single_choice: g.is_single_choice,
          choices: choicesStmt.all(g.id),
        })),
      };
    };

    for (const arr of byCategory.values()) {
      for (let i = 0; i < arr.length; i++) arr[i] = enrichItem(arr[i]);
    }
    for (let i = 0; i < uncategorized.length; i++) uncategorized[i] = enrichItem(uncategorized[i]);

    const result = categories
      .map((c) => ({ id: c.id, name: c.name, items: byCategory.get(c.id) }))
      .filter((c) => c.items.length > 0);

    if (uncategorized.length > 0) {
      result.push({ id: null, name: 'Other', items: uncategorized });
    }

    res.json({
      table: {
        id: table.id,
        table_number: table.table_number,
        label: table.label,
        last_activity_at: table.last_activity_at || null,
      },
      categories: result,
    });
  });

  router.post('/api/customer/orders', (req, res) => {
    const { token, items, notes } = req.body ?? {};

    const { table, error } = findTableByToken(db, token);
    if (error === 'notfound') return res.status(404).json({ error: 'table not found' });
    if (error === 'inactive') return res.status(410).json({ error: 'table inactive' });
    if (error) return res.status(400).json({ error: 'token is required' });

    // Rate limit: max 10 orders per table per 5 minutes
    if (orderRateLimit) {
      const check = orderRateLimit.check(table.id);
      if (!check.allowed) {
        res.setHeader('Retry-After', String(check.retryAfterSec));
        return res.status(429).json({
          error: 'too many orders from this table — please wait a moment',
          retry_after: check.retryAfterSec,
        });
      }
    }

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
             (order_id, menu_item_id, name_snapshot, price_snapshot, qty, notes)
           VALUES (?, ?, ?, ?, ?, ?)`
        );
        const insertOption = db.prepare(
          `INSERT INTO order_item_options
             (order_item_id, group_name_snapshot, choice_name_snapshot)
           VALUES (?, ?, ?)`
        );

        for (const r of resolved) {
          const result = insertItem.run(oid, r.itemId, r.name, r.price, r.qty, r.notes);
          const orderItemId = result.lastInsertRowid;
          for (const sel of r.selections || []) {
            insertOption.run(orderItemId, sel.group_name, sel.choice_name);
          }
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

    db.prepare('UPDATE tables SET last_activity_at = CURRENT_TIMESTAMP WHERE id = ?').run(table.id);

    if (orderRateLimit) orderRateLimit.record(table.id);

    const io = getIO();
    if (io) {
      io.to('kitchen').emit('order:new', { order, items: orderItems });
      io.to(`order-${orderId}`).emit('order:updated', { orderId });
    }

    res.status(201).json({ order, items: orderItems });
  });

  router.get('/api/customer/orders', (req, res) => {
    const { table, error } = findTableByToken(db, req.query.token);
    if (error === 'notfound') return res.status(404).json({ error: 'table not found' });
    if (error === 'inactive') return res.status(410).json({ error: 'table inactive' });
    if (error) return res.status(400).json({ error: 'token is required' });

    const orders = db.prepare(
      `SELECT id, status, total, notes, created_at, updated_at
         FROM orders
        WHERE table_id = ?
          AND session_ended_at IS NULL
          AND created_at > datetime('now', '-12 hours')
        ORDER BY created_at DESC, id DESC`
    ).all(table.id);

    const itemsStmt = db.prepare(
      'SELECT id, name_snapshot, price_snapshot, qty, notes FROM order_items WHERE order_id = ? ORDER BY id'
    );
    const optionsStmt = db.prepare(
      'SELECT group_name_snapshot, choice_name_snapshot FROM order_item_options WHERE order_item_id = ?'
    );

    res.json({
      table: { id: table.id, table_number: table.table_number, label: table.label },
      orders: orders.map((o) => ({
        ...o,
        items: itemsStmt.all(o.id).map((it) => ({
          ...it,
          options: optionsStmt.all(it.id),
        })),
      })),
    });
  });

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
    const optionsStmt = db.prepare(
      'SELECT group_name_snapshot, choice_name_snapshot FROM order_item_options WHERE order_item_id = ?'
    );

    res.json({
      order: {
        id: order.id,
        status: order.status,
        total: order.total,
        notes: order.notes,
        created_at: order.created_at,
        updated_at: order.updated_at,
      },
      items: items.map((it) => ({ ...it, options: optionsStmt.all(it.id) })),
    });
  });

  return router;
}
