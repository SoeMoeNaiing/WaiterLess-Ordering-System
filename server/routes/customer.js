import { Router } from 'express';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CUSTOMER_HTML = join(__dirname, '..', '..', 'public', 'customer', 'index.html');

export function customerRouter({ db }) {
  const router = Router();

  // GET /t/:token
  router.get('/t/:token', (req, res) => {
    const token = req.params.token;

    const table = db
      .prepare('SELECT * FROM tables WHERE qr_token = ?')
      .get(token);

    if (!table) {
      return res.status(404).send('Table not found');
    }

    if (!table.is_active) {
      return res.status(410).send('This table is no longer active');
    }

    res.type('html').send(readFileSync(CUSTOMER_HTML, 'utf8'));
  });

  return router;
}
