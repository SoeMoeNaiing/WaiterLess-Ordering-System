import { Router } from 'express';

export function adminOrdersRouter({ db }) {
  const router = Router();

  // GET /api/admin/orders?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=N&offset=N
  router.get('/', (req, res) => {
    const { from, to } = req.query;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const where = [];
    const params = [];

    if (from) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) {
        return res.status(400).json({ error: 'from must be YYYY-MM-DD' });
      }
      where.push('o.created_at >= ?');
      params.push(from + ' 00:00:00');
    }
    if (to) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(to)) {
        return res.status(400).json({ error: 'to must be YYYY-MM-DD' });
      }
      where.push('o.created_at <= ?');
      params.push(to + ' 23:59:59');
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const totalRow = db.prepare(
      `SELECT COUNT(*) AS c, COALESCE(SUM(o.total), 0) AS sum
         FROM orders o ${whereSql}`
    ).get(...params);

    const orders = db.prepare(
      `SELECT o.id, o.status, o.total, o.notes, o.created_at,
              t.table_number
         FROM orders o
         JOIN tables t ON t.id = o.table_id
         ${whereSql}
        ORDER BY o.created_at DESC, o.id DESC
        LIMIT ? OFFSET ?`
    ).all(...params, limit, offset);

    const itemsStmt = db.prepare(
      `SELECT name_snapshot, price_snapshot, qty
         FROM order_items
        WHERE order_id = ?
        ORDER BY id`
    );

    res.json({
      total_count: totalRow.c,
      total_sum: totalRow.sum,
      limit,
      offset,
      orders: orders.map((o) => ({ ...o, items: itemsStmt.all(o.id) })),
    });
  });

  return router;
}
