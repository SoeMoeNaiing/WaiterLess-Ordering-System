import { Router } from 'express';
import QRCode from 'qrcode';
import { newTableToken } from '../utils/tokens.js';

export function adminTablesRouter({ db }) {
  const router = Router();

  // POST /api/admin/tables
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

  // PUT /api/admin/tables/:id
  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const existing = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'table not found' });
    }

    const body = req.body ?? {};
    const updates = {};

    if ('table_number' in body) {
      if (typeof body.table_number !== 'string' || body.table_number.trim() === '') {
        return res.status(400).json({ error: 'table_number must be a non-empty string' });
      }
      updates.table_number = body.table_number.trim();
    }

    if ('label' in body) {
      if (body.label === null || body.label === '') {
        updates.label = null;
      } else if (typeof body.label === 'string') {
        updates.label = body.label.trim() || null;
      } else {
        return res.status(400).json({ error: 'label must be a string or null' });
      }
    }

    if ('is_active' in body) {
      const v = body.is_active;
      if (v === true || v === 1 || v === '1') updates.is_active = 1;
      else if (v === false || v === 0 || v === '0') updates.is_active = 0;
      else return res.status(400).json({ error: 'is_active must be boolean' });
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no updatable fields provided' });
    }

    const fields = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    const values = Object.values(updates);

    try {
      db.prepare(`UPDATE tables SET ${fields} WHERE id = ?`).run(...values, id);
    } catch (err) {
      if (String(err.message).includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'table_number already exists' });
      }
      console.error('[admin.tables] PUT error:', err);
      return res.status(500).json({ error: 'internal error' });
    }

    const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
    res.json(updated);
  });

  // DELETE /api/admin/tables/:id — SOFT delete (is_active = 0)
  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const existing = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'table not found' });
    }

    db.prepare('UPDATE tables SET is_active = 0 WHERE id = ?').run(id);
    const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
    res.json(updated);
  });

  // POST /api/admin/tables/:id/regenerate-token
  router.post('/:id/regenerate-token', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const existing = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'table not found' });
    }

    const newToken = newTableToken();
    db.prepare('UPDATE tables SET qr_token = ? WHERE id = ?').run(newToken, id);

    const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
    res.json(updated);
  });

  // GET /api/admin/tables/:id/qr.png[?size=N]
  router.get('/:id/qr.png', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const row = db.prepare('SELECT * FROM tables WHERE id = ?').get(id);
    if (!row) {
      return res.status(404).json({ error: 'table not found' });
    }

    const size = Math.min(Math.max(Number(req.query.size) || 400, 128), 1024);

    const base = process.env.PUBLIC_BASE_URL
      || `${req.protocol}://${req.get('host')}`;
    const target = `${base}/t/${row.qr_token}`;

    try {
      const buf = await QRCode.toBuffer(target, {
        type: 'png',
        width: size,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      res.type('png').send(buf);
    } catch (err) {
      console.error('[admin.tables] QR error:', err);
      res.status(500).json({ error: 'failed to generate QR' });
    }
  });

  return router;   // ← MUST be the last statement in the function
}
