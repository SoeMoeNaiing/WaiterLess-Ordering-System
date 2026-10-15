import 'dotenv/config';
import express from 'express';
import { lanOnly } from './middleware/lanOnly.js';
import { requireAdmin, requireKitchen } from './middleware/auth.js';
import { createRateLimiter } from './middleware/loginRateLimit.js';
import { adminAuthRouter } from './routes/admin.auth.js';
import { kitchenAuthRouter } from './routes/kitchen.auth.js';
import { adminTablesRouter } from './routes/admin.tables.js';
import { adminCategoriesRouter } from './routes/admin.categories.js';
import { adminMenuItemsRouter } from './routes/admin.menu-items.js';
import { adminUploadRouter } from './routes/admin.upload.js';
import { adminSettingsRouter } from './routes/admin.settings.js';
import { publicSettingsRouter } from './routes/public.settings.js';
import { customerRouter } from './routes/customer.js';
import { kitchenRouter } from './routes/kitchen.js';

const LAN_PREFIX = process.env.LAN_PREFIX || '192.168.';

export function createApp({ db } = {}) {
  const app = express();
  const rateLimit = createRateLimiter();

  app.use(express.json());
  app.use(lanOnly(LAN_PREFIX));

  app.use('/uploads', express.static('uploads'));
  app.use('/admin', express.static('public/admin'));
  app.use('/customer', express.static('public/customer'));
  app.use('/kitchen', express.static('public/kitchen'));

  app.get('/', (req, res) => res.redirect('/admin/'));

  app.get('/health', (req, res) => {
    if (db) {
      try { db.prepare('SELECT 1').get(); }
      catch {
        return res.status(500).json({ ok: false, db: 'error', time: new Date().toISOString() });
      }
    }
    res.json({
      ok: true,
      db: db ? 'connected' : 'unavailable',
      time: new Date().toISOString(),
    });
  });

  // Auth (open)
  app.use('/api/admin/auth', adminAuthRouter({ db, rateLimit }));
  app.use('/api/kitchen/auth', kitchenAuthRouter({ db, rateLimit }));

  if (db) {
    // Public
    app.use('/api/public', publicSettingsRouter({ db }));

    // Kitchen (admin OR kitchen cookie)
    app.use('/api/kitchen', requireKitchen, kitchenRouter({ db }));

    // Admin (admin cookie)
    app.use('/api/admin/tables', requireAdmin, adminTablesRouter({ db }));
    app.use('/api/admin/categories', requireAdmin, adminCategoriesRouter({ db }));
    app.use('/api/admin/menu-items', requireAdmin, adminMenuItemsRouter({ db }));
    app.use('/api/admin/upload', requireAdmin, adminUploadRouter());
    app.use('/api/admin/settings', requireAdmin, adminSettingsRouter({ db }));

    // Customer
    app.use(customerRouter({ db }));
  }

  return app;
}
