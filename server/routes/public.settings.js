import { Router } from 'express';

const PUBLIC_KEYS = ['restaurant_name', 'currency', 'default_language'];

export function publicSettingsRouter({ db }) {
  const router = Router();

  router.get('/settings', (req, res) => {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const out = {};
    for (const r of rows) {
      if (PUBLIC_KEYS.includes(r.key)) out[r.key] = r.value;
    }
    if (!('restaurant_name' in out)) out.restaurant_name = 'My Restaurant';
    if (!('currency' in out)) out.currency = 'MMK';
    if (!('default_language' in out)) out.default_language = 'en';
    res.json(out);
  });

  return router;
}
