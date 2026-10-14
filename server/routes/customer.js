import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CUSTOMER_HTML = join(__dirname, '..', '..', 'public', 'customer', 'index.html');

function findTableByToken(db, token) {
  if (typeof token !== 'string' || token === '') return { error: 'missing' };
  const table = db.prepare('SELECT * FROM tables WHERE qr_token = ?').get(token);
  if (!table) return { error: 'notfound' };
  if (!table.is_active) return { error: 'inactive' };
  return { table };
}

export function customerRouter({ db }) {
  const router = Router();

  // GET /t/:token — customer HTML page
  router.get('/t/:token', (req, res) => {
    const { table, error } = findTableByToken(db, req.params.token);
    if (error === 'notfound') return res.status(404).send('Table not found');
    if (error === 'inactive') return res.status(410).send('This table is no longer active');
    if (error) return res.status(400).send('Missing token');
    res.type('html').send(readFileSync(CUSTOMER_HTML, 'utf8'));
  });

  // GET /api/customer/menu?token=... — menu data for the table
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

  return router;
}
