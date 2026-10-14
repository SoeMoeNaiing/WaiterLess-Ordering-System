import 'dotenv/config';
import express from 'express';
import { lanOnly } from './middleware/lanOnly.js';
import { adminTablesRouter } from './routes/admin.tables.js';
import { adminCategoriesRouter } from './routes/admin.categories.js';

const LAN_PREFIX = process.env.LAN_PREFIX || '192.168.';

export function createApp({ db } = {}) {
  const app = express();

  app.use(express.json());
  app.use(lanOnly(LAN_PREFIX));

  app.get('/health', (req, res) => {
    if (db) {
      try {
        db.prepare('SELECT 1').get();
      } catch {
        return res.status(500).json({
          ok: false, db: 'error', time: new Date().toISOString(),
        });
      }
    }

    res.json({
      ok: true,
      db: db ? 'connected' : 'unavailable',
      time: new Date().toISOString(),
    });
  });

  if (db) {
    app.use('/api/admin/tables', adminTablesRouter({ db }));
    app.use('/api/admin/categories', adminCategoriesRouter({ db }));
  }

  return app;
}
