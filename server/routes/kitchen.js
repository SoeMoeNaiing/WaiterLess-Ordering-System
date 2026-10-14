import { Router } from 'express';

const ACTIVE_STATUSES = ['placed', 'preparing', 'ready'];

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

    const result = orders.map((o) => ({
      ...o,
      items: itemsStmt.all(o.id),
    }));

    res.json(result);
  });

  return router;
}
