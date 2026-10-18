import { Router } from 'express';

const ACTIVE_STATUSES = ['placed', 'preparing', 'ready'];
const ALL_STATUSES = ['placed', 'preparing', 'ready', 'served', 'cancelled'];

function orderWithItems(db, orderId) {
  const order = db.prepare(
    `SELECT o.id, o.table_id, o.status, o.total, o.notes,
            o.created_at, o.updated_at,
            t.table_number, t.label AS table_label
       FROM orders o
       JOIN tables t ON t.id = o.table_id
      WHERE o.id = ?`
  ).get(orderId);
  if (!order) return null;

  const items = db.prepare(
    `SELECT id, order_id, menu_item_id, name_snapshot, price_snapshot, qty, notes
       FROM order_items
      WHERE order_id = ?
      ORDER BY id`
  ).all(orderId);

  return { ...order, items };
}

export function kitchenRouter({ db }) {
  const router = Router();

  // GET /api/kitchen/orders?status=active|all
  router.get('/orders', (req, res) => {
    const { status } = req.query;

    const whereClause =
      status === 'all'
        ? ''
        : `WHERE o.status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`;

    const params = status === 'all' ? [] : ACTIVE_STATUSES;

    const orders = db.prepare(
      `SELECT o.id, o.table_id, o.status, o.total, o.notes,
              o.created_at, o.updated_at,
              t.table_number, t.label AS table_label
         FROM orders o
         JOIN tables t ON t.id = o.table_id
         ${whereClause}
        ORDER BY o.created_at ASC, o.id ASC`
    ).all(...params);

    const itemsStmt = db.prepare(
      `SELECT id, order_id, menu_item_id, name_snapshot, price_snapshot, qty, notes
         FROM order_items
        WHERE order_id = ?
        ORDER BY id`
    );

    // Attach options (snapshot data) to each item
    const optionsStmt = db.prepare(
      'SELECT group_name_snapshot, choice_name_snapshot FROM order_item_options WHERE order_item_id = ?'
    );

    const enrichOrder = (o) => {
      const items = itemsStmt.all(o.id).map((it) => ({
        ...it,
        options: optionsStmt.all(it.id),
      }));
      return { ...o, items };
    };

    res.json(orders.map(enrichOrder));
  });

  // PATCH /api/kitchen/orders/:id — update status and/or notes
  router.patch('/orders/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const existing = db.prepare('SELECT id FROM orders WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'order not found' });

    const body = req.body ?? {};
    const updates = {};

    if ('status' in body) {
      if (!ALL_STATUSES.includes(body.status)) {
        return res.status(400).json({
          error: `status must be one of: ${ALL_STATUSES.join(', ')}`,
        });
      }
      updates.status = body.status;
    }

    if ('notes' in body) {
      if (body.notes === null || body.notes === '') {
        updates.notes = null;
      } else if (typeof body.notes === 'string') {
        updates.notes = body.notes.trim().slice(0, 500) || null;
      } else {
        return res.status(400).json({ error: 'notes must be a string or null' });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no updatable fields provided' });
    }

    const fields = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    const values = Object.values(updates);

    db.prepare(
      `UPDATE orders SET ${fields}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
    ).run(...values, id);

    const updated = orderWithItems(db, id);
    res.json(updated);
  });

  return router;
}
