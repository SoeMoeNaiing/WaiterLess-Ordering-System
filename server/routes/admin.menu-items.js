import { Router } from 'express';

export function adminMenuItemsRouter({ db }) {
  const router = Router();

  // POST /api/admin/menu-items
  router.post('/', (req, res) => {
    const body = req.body ?? {};
    const { name, description, price, category_id, image_path, sort_order } = body;

    if (typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      return res.status(400).json({ error: 'price must be a non-negative number' });
    }
    if (category_id != null) {
      const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(category_id);
      if (!cat) return res.status(400).json({ error: 'category_id does not exist' });
    }

    const cleanOrder = Number.isInteger(sort_order) ? sort_order : 0;

    try {
      const result = db.prepare(
        `INSERT INTO menu_items
           (category_id, name, description, price, image_path, sort_order)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        category_id ?? null,
        name.trim(),
        typeof description === 'string' ? description.trim() || null : null,
        price,
        typeof image_path === 'string' ? image_path.trim() || null : null,
        cleanOrder
      );

      const row = db.prepare('SELECT * FROM menu_items WHERE id = ?')
        .get(result.lastInsertRowid);
      return res.status(201).json(row);
    } catch (err) {
      console.error('[admin.menu-items] POST error:', err);
      return res.status(500).json({ error: 'internal error' });
    }
  });

  // GET /api/admin/menu-items[?category_id=N]
  router.get('/', (req, res) => {
    const { category_id } = req.query;
    let rows;
    if (category_id != null && category_id !== '') {
      rows = db.prepare(
        'SELECT * FROM menu_items WHERE category_id = ? ORDER BY sort_order, name'
      ).all(Number(category_id));
    } else {
      rows = db.prepare(
        'SELECT * FROM menu_items ORDER BY sort_order, name'
      ).all();
    }
    res.json(rows);
  });

  // PUT /api/admin/menu-items/:id
  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });

    const existing = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'menu item not found' });

    const body = req.body ?? {};
    const updates = {};

    if ('name' in body) {
      if (typeof body.name !== 'string' || body.name.trim() === '') {
        return res.status(400).json({ error: 'name must be a non-empty string' });
      }
      updates.name = body.name.trim();
    }
    if ('description' in body) {
      if (body.description !== null && typeof body.description !== 'string') {
        return res.status(400).json({ error: 'description must be string or null' });
      }
      updates.description = body.description === null ? null : (body.description.trim() || null);
    }
    if ('price' in body) {
      if (typeof body.price !== 'number' || !Number.isFinite(body.price) || body.price < 0) {
        return res.status(400).json({ error: 'price must be a non-negative number' });
      }
      updates.price = body.price;
    }
    if ('category_id' in body) {
      if (body.category_id === null) {
        updates.category_id = null;
      } else {
        const cat = db.prepare('SELECT id FROM categories WHERE id = ?').get(body.category_id);
        if (!cat) return res.status(400).json({ error: 'category_id does not exist' });
        updates.category_id = body.category_id;
      }
    }
    if ('image_path' in body) {
      if (body.image_path !== null && typeof body.image_path !== 'string') {
        return res.status(400).json({ error: 'image_path must be string or null' });
      }
      updates.image_path = body.image_path === null ? null : (body.image_path.trim() || null);
    }
    if ('sort_order' in body) {
      if (!Number.isInteger(body.sort_order)) {
        return res.status(400).json({ error: 'sort_order must be an integer' });
      }
      updates.sort_order = body.sort_order;
    }
    for (const flag of ['is_available', 'is_active']) {
      if (flag in body) {
        const v = body[flag];
        if (v === true || v === 1 || v === '1') updates[flag] = 1;
        else if (v === false || v === 0 || v === '0') updates[flag] = 0;
        else return res.status(400).json({ error: `${flag} must be boolean` });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'no updatable fields provided' });
    }

    const fields = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    const values = Object.values(updates);

    try {
      db.prepare(`UPDATE menu_items SET ${fields} WHERE id = ?`).run(...values, id);
    } catch (err) {
      console.error('[admin.menu-items] PUT error:', err);
      return res.status(500).json({ error: 'internal error' });
    }

    const updated = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
    res.json(updated);
  });

  // DELETE /api/admin/menu-items/:id
  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: 'invalid id' });

    const existing = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(id);
    if (!existing) return res.status(404).json({ error: 'menu item not found' });

    db.prepare('DELETE FROM menu_items WHERE id = ?').run(id);
    res.json({ deleted: true, id });
  });

  return router;
}
