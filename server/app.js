import 'dotenv/config';
import express from 'express';
import { lanOnly } from './middleware/lanOnly.js';
import { requireAdmin, requireKitchen } from './middleware/auth.js';
import { createRateLimiter } from './middleware/loginRateLimit.js';
import { createOrderRateLimiter } from './middleware/orderRateLimit.js';
import { adminAuthRouter } from './routes/admin.auth.js';
import { kitchenAuthRouter } from './routes/kitchen.auth.js';
import { adminTablesRouter } from './routes/admin.tables.js';
import { adminCategoriesRouter } from './routes/admin.categories.js';
import { adminMenuItemsRouter } from './routes/admin.menu-items.js';
import { adminMenuOptionsRouter } from './routes/admin.menu-options.js';
import { adminUploadRouter } from './routes/admin.upload.js';
import { adminSettingsRouter } from './routes/admin.settings.js';
import { adminOrdersRouter } from './routes/admin.orders.js';
import { adminDashboardRouter } from './routes/admin.dashboard.js';
import { publicSettingsRouter } from './routes/public.settings.js';
import { customerRouter } from './routes/customer.js';
import { kitchenRouter } from './routes/kitchen.js';
import { requestLog } from './middleware/requestLog.js';
import { getIO } from './sockets/registry.js';

const LAN_PREFIX = process.env.LAN_PREFIX || '192.168.';

export function createApp({ db } = {}) {
  const app = express();
  const rateLimit = createRateLimiter();
  const orderRateLimit = createOrderRateLimiter();

  app.use(express.json({ limit: '100kb' }));
  app.use(lanOnly(LAN_PREFIX));
  app.use(requestLog);

  // Static assets
  app.use('/uploads', express.static('uploads'));
  app.use('/admin', express.static('public/admin'));
  app.use('/customer', express.static('public/customer'));
  app.use('/kitchen', express.static('public/kitchen'));
  app.use('/i18n', express.static('public/i18n'));

  app.get('/', (req, res) => res.redirect('/admin/'));

  app.get('/health', (req, res) => {
    let dbStatus = 'unavailable';
    let tables = null;
    let activeOrders = null;

    if (db) {
      try {
        db.prepare('SELECT 1').get();
        dbStatus = 'connected';
        tables = db.prepare('SELECT COUNT(*) AS c FROM tables WHERE is_active = 1').get().c;
        activeOrders = db.prepare(
          "SELECT COUNT(*) AS c FROM orders WHERE status IN ('placed','preparing','ready')"
        ).get().c;
      } catch {
        return res.status(500).json({
          ok: false, db: 'error', time: new Date().toISOString(),
        });
      }
    }

    let sockets = 0;
    try {
      const io = getIO();
      if (io) sockets = io.sockets.sockets.size;
    } catch {}

    res.json({
      ok: true,
      db: dbStatus,
      uptime_sec: Math.floor(process.uptime()),
      memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      sockets,
      tables,
      active_orders: activeOrders,
      time: new Date().toISOString(),
    });
  });

  // Auth endpoints (open)
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
    app.use('/api/admin/menu-items/:itemId/options', requireAdmin, adminMenuOptionsRouter({ db }));
    app.use('/api/admin/menu-items', requireAdmin, adminMenuItemsRouter({ db }));
    app.use('/api/admin/upload', requireAdmin, adminUploadRouter());
    app.use('/api/admin/settings', requireAdmin, adminSettingsRouter({ db }));
    app.use('/api/admin/orders', requireAdmin, adminOrdersRouter({ db }));
    app.use('/api/admin/dashboard', requireAdmin, adminDashboardRouter({ db }));

    // Customer (no auth — token in URL is the credential)
    app.use(customerRouter({ db, orderRateLimit }));
  }

  // ---------- 404 catch-all ----------
  app.use((req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'endpoint not found', path: req.path });
    }
    return res.status(404).type('text').send('Not found');
  });

  // ---------- Global error handler ----------
  app.use((err, req, res, next) => {
    console.error('[error]', req.method, req.path, '—', err.message);
    if (err.stack) console.error(err.stack);
    if (res.headersSent) return next(err);

    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'request body too large' });
    }
    if (err instanceof SyntaxError && 'body' in err) {
      return res.status(400).json({ error: 'invalid JSON body' });
    }

    if (req.path.startsWith('/api/')) {
      return res.status(500).json({ error: 'internal server error' });
    }
    return res.status(500).type('text').send('Internal server error');
  });

  return app;
}
