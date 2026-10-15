import { Router } from 'express';

const ALLOWED_KEYS = new Set(['restaurant_name', 'currency', 'default_language']);

export function adminSettingsRouter({ db }) {
  const router = Router();

  // GET /api/admin/settings — returns all whitelisted keys as { key: value }
  router.get('/', (req, res) => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const out = {};
    for (const r of rows) {
      if (ALLOWED_KEYS.has(r.key)) out[r.key] = r.value;
    }
    // Provide defaults for keys not yet set
    if (!('restaurant_name' in out)) out.restaurant_name = 'My Restaurant';
    if (!('currency' in out)) out.currency = 'MMK';
    if (!('default_language' in out)) out.default_language = 'en';
    res.json(out);
  });

  // PUT /api/admin/settings — partial update of whitelisted keys
  router.put('/', (req, res) => {
    const body = req.body ?? {};
    const updates = [];

    for (const [key, value] of Object.entries(body)) {
      if (!ALLOWED_KEYS.has(key)) {
        return res.status(400).json({ error: `setting "${key}" is not editable` });
      }
      if (typeof value !== 'string' || value.trim() === '') {
        return res.status(400).json({ error: `${key} must be a non-empty string` });
      }
      updates.push([key, value.trim()]);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'no settings to update' });
    }

    const updateStmt = db.prepare('UPDATE settings SET value = ? WHERE key = ?');
    const insertStmt = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');

    db.transaction(() => {
      for (const [key, value] of updates) {
        const changed = updateStmt.run(value, key).changes;
        if (changed === 0) insertStmt.run(key, value);
      }
    })();

    const rows = db.prepare('SELECT key, value FROM settings').all();
    const out = {};
    for (const r of rows) {
      if (ALLOWED_KEYS.has(r.key)) out[r.key] = r.value;
    }
    res.json(out);
  });

  return router;
}
