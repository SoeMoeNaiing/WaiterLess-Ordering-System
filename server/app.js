import 'dotenv/config';
import express from 'express';
import { lanOnly } from './middleware/lanOnly.js';
import { adminTablesRouter } from './routes/admin.tables.js';
import { adminCategoriesRouter } from './routes/admin.categories.js';
import { adminMenuItemsRouter } from './routes/admin.menu-items.js';
import { adminUploadRouter } from './routes/admin.upload.js';
import { customerRouter } from './routes/customer.js';

const LAN_PREFIX = process.env.LAN_PREFIX || '192.168.';

export function createApp({ db } = {}) {
  const app = express();

  app.use(express.json());
  app.use(lanOnly(LAN_PREFIX));

  app.use('/uploads', express.static('uploads'));
  app.use('/admin', express.static('public/admin'));

  app.get('/', (req, res) => res.redirect('/admin/'));

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
    app.use('/api/admin/menu-items', adminMenuItemsRouter({ db }));
    app.use(customerRouter({ db }));
  }

  app.use('/api/admin/upload', adminUploadRouter());

  return app;
}
