import { Router } from 'express';
import { newTableToken } from '../utils/tokens.js';

export function adminTablesRouter({ db }) {
  const router = Router();

  // POST /api/admin/tables
  // body: { table_number: string, label?: string }
  router.post('/', (req, res) => {
    const { table_number, label } = req.body ?? {};

    if (typeof table_number !== 'string' || table_number.trim() === '') {
      return res.status(400).json({ error: 'table_number is required' });
    }

    const cleanNumber = table_number.trim();
    const cleanLabel = typeof label === 'string' && label.trim() !== '' ? label.trim() : null;
    const token = newTableToken();

    try {
      const result = db
        .prepare('INSERT INTO tables (table_number, label, qr_token) VALUES (?, ?, ?)')
        .run(cleanNumber, cleanLabel, token);

      const row = db
        .prepare('SELECT * FROM tables WHERE id = ?')
        .get(result.lastInsertRowid);

      return res.status(201).json(row);
    } catch (err) {
      if (String(err.message).includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'table_number already exists' });
      }
      console.error('[admin.tables] POST error:', err);
      return res.status(500).json({ error: 'internal error' });
    }
  });

  // GET /api/admin/tables[?active=1|0]
  router.get('/', (req, res) => {
    const { active } = req.query;

    let rows;
    if (active === '1' || active === '0') {
      rows = db
        .prepare('SELECT * FROM tables WHERE is_active = ? ORDER BY table_number')
        .all(Number(active));
    } else {
      rows = db
        .prepare('SELECT * FROM tables ORDER BY table_number')
        .all();
    }

    res.json(rows);
  });

  return router;
}
