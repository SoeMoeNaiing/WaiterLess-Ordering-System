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
      // Unexpected — log and 500
      console.error('[admin.tables] POST error:', err);
      return res.status(500).json({ error: 'internal error' });
    }
  });

  return router;
}
