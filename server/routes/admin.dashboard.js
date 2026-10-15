import { Router } from 'express';

export function adminDashboardRouter({ db }) {
  const router = Router();

  // GET /api/admin/dashboard?date=YYYY-MM-DD (default: today in UTC)
  router.get('/', (req, res) => {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }
    const from = date + ' 00:00:00';
    const to = date + ' 23:59:59';

    const row = db.prepare(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'served')                  AS orders_completed,
         COUNT(*) FILTER (WHERE status IN ('placed','preparing','ready')) AS orders_in_progress,
         COUNT(*) FILTER (WHERE status = 'cancelled')                AS orders_cancelled,
         COALESCE(SUM(total) FILTER (WHERE status = 'served'), 0)    AS sales_completed,
         COALESCE(SUM(total) FILTER (WHERE status IN ('placed','preparing','ready')), 0) AS sales_active
       FROM orders
       WHERE created_at BETWEEN ? AND ?`
    ).get(from, to);

    const avg = row.orders_completed > 0
      ? row.sales_completed / row.orders_completed
      : 0;

    const topItems = db.prepare(
      `SELECT oi.name_snapshot AS name,
              SUM(oi.qty) AS qty,
              SUM(oi.qty * oi.price_snapshot) AS revenue
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE o.created_at BETWEEN ? AND ?
          AND o.status != 'cancelled'
        GROUP BY oi.name_snapshot
        ORDER BY qty DESC
        LIMIT 5`
    ).all(from, to);

    res.json({
      date,
      orders_completed: row.orders_completed,
      orders_in_progress: row.orders_in_progress,
      orders_cancelled: row.orders_cancelled,
      sales_completed: row.sales_completed,
      sales_all_active: row.sales_completed + row.sales_active,
      avg_order_value: Math.round(avg * 100) / 100,
      top_items: topItems,
    });
  });

  return router;
}
