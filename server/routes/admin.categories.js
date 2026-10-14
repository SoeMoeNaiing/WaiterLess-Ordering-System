import { Router } from 'express';

export function adminCategoriesRouter({ db }) {
  const router = Router();

  // POST /api/admin/categories
  // body: { name: string, sort_order?: number }
  router.post('/', (req, res) => {
    const { name, sort_order } = req.body ?? {};

    if (typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'name is required' });
    }

    const cleanName = name.trim();
    const cleanOrder = Number.isInteger(sort_order) ? sort_order : 0;

    try {
      const result = db
        .prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)')
        .run(cleanName, cleanOrder);

      const row = db
        .prepare('SELECT * FROM categories WHERE id = ?')
        .get(result.lastInsertRowid);

      return res.status(201).json(row);
    } catch (err) {
      if (String(err.message).includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'category name already exists' });
      }
      console.error('[admin.categories] POST error:', err);
      return res.status(500).json({ error: 'internal error' });
    }
  });

  // GET /api/admin/categories
  router.get('/', (req, res) => {
    const rows = db
      .prepare('SELECT * FROM categories ORDER BY sort_order, name')
      .all();
    res.json(rows);
  });

  // PUT /api/admin/categories/:id
  // Partial update. Accepts any subset of { name, sort_order, is_active }.
  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'category not found' });
    }

    const body = req.body ?? {};
    const updates = {};

    if ('name' in body) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        return res.status(400).json({ error: 'name must be a non-empty string' });
      }
      updates.name = body.name.trim();
    }

    if ('sort_order' in body) {
      if (!Number.isInteger(body.sort_order)) {
        return res.status(400).json({ error: 'sort_order must be an integer' });
      }
      updates.sort_order = body.sort_order;
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
      db.prepare(`UPDATE categories SET ${fields} WHERE id = ?`).run(...values, id);
    } catch (err) {
      if (String(err.message).includes('UNIQUE constraint failed')) {
        return res.status(409).json({ error: 'category name already exists' });
      }
      console.error('[admin.categories] PUT error:', err);
      return res.status(500).json({ error: 'internal error' });
    }

    const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    res.json(updated);
  });

  // DELETE /api/admin/categories/:id
  // HARD delete. menu_items.category_id becomes NULL (ON DELETE SET NULL),
  // so items survive and become uncategorized.
  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const existing = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    if (!existing) {
      return res.status(404).json({ error: 'category not found' });
    }

    db.prepare('DELETE FROM categories WHERE id = ?').run(id);
    res.json({ deleted: true, id });
  });

  return router;
}
