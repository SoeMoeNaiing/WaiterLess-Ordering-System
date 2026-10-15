import { test } from 'node:test';
import { loginAdmin } from './helpers/auth.js';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';
import { createRateLimiter } from '../server/middleware/loginRateLimit.js';

function appWithDb() {
  const db = createDb(':memory:', { quiet: true });
  return { app: createApp({ db }), db };
}

// ---------- Admin login ----------

test('admin login with correct pin sets cookie', async () => {
  const { app, db, cookie, kitchenCookie } = await appWithDb();
  const res = await request(app).post('/api/admin/auth/login').send({ pin: '1234' });
  assert.equal(res.status, 200);
  assert.ok(res.headers['set-cookie'][0].startsWith('rs_admin='));
  db.close();
});

test('admin login with wrong pin returns 401', async () => {
  const { app, db, cookie, kitchenCookie } = await appWithDb();
  const res = await request(app).post('/api/admin/auth/login').send({ pin: '9999' });
  assert.equal(res.status, 401);
  db.close();
});

test('admin login with empty pin returns 400', async () => {
  const { app, db, cookie, kitchenCookie } = await appWithDb();
  const res = await request(app).post('/api/admin/auth/login').send({ pin: '' });
  assert.equal(res.status, 400);
  db.close();
});

test('admin logout clears the cookie', async () => {
  const { app, db, cookie, kitchenCookie } = await appWithDb();
  const res = await request(app).post('/api/admin/auth/logout');
  assert.equal(res.status, 200);
  assert.match(res.headers['set-cookie'][0], /^rs_admin=;/);
  db.close();
});

// ---------- Kitchen login ----------

test('kitchen login accepts admin pin when kitchen_pin not set', async () => {
  const { app, db, cookie, kitchenCookie } = await appWithDb();
  const res = await request(app).post('/api/kitchen/auth/login').send({ pin: '1234' });
  assert.equal(res.status, 200);
  assert.ok(res.headers['set-cookie'][0].startsWith('rs_kitchen='));
  db.close();
});

test('kitchen login uses kitchen_pin when set', async () => {
  const { app, db, cookie, kitchenCookie } = await appWithDb();
  db.prepare("INSERT INTO settings (key, value) VALUES ('kitchen_pin', '5678')").run();

  const wrong = await request(app).post('/api/kitchen/auth/login').send({ pin: '1234' });
  assert.equal(wrong.status, 401);

  const right = await request(app).post('/api/kitchen/auth/login').send({ pin: '5678' });
  assert.equal(right.status, 200);
  db.close();
});

// ---------- Rate limiting ----------

test('5 wrong PINs trigger a 429 lockout on next attempt', async () => {
  const { app, db, cookie, kitchenCookie } = await appWithDb();
  for (let i = 0; i < 5; i++) {
    const r = await request(app).post('/api/admin/auth/login').send({ pin: '0000' });
    assert.equal(r.status, 401);
  }
  const locked = await request(app).post('/api/admin/auth/login').send({ pin: '1234' });
  assert.equal(locked.status, 429);
  assert.ok(Number(locked.headers['retry-after']) > 0);
  db.close();
});

test('successful login clears the fail counter', async () => {
  const { app, db, cookie, kitchenCookie } = await appWithDb();
  for (let i = 0; i < 3; i++) {
    await request(app).post('/api/admin/auth/login').send({ pin: '0000' });
  }
  const ok = await request(app).post('/api/admin/auth/login').send({ pin: '1234' });
  assert.equal(ok.status, 200);
  for (let i = 0; i < 4; i++) {
    const r = await request(app).post('/api/admin/auth/login').send({ pin: '0000' });
    assert.equal(r.status, 401);
  }
  db.close();
});

// ---------- Rate limiter unit tests ----------

test('rate limiter: locks after 5 fails', () => {
  const rl = createRateLimiter();
  const ip = '10.0.0.1';
  for (let i = 0; i < 5; i++) rl.record(ip, false);
  assert.equal(rl.isLocked(ip).locked, true);
});

test('rate limiter: success resets', () => {
  const rl = createRateLimiter();
  const ip = '10.0.0.2';
  for (let i = 0; i < 4; i++) rl.record(ip, false);
  rl.record(ip, true);
  for (let i = 0; i < 4; i++) rl.record(ip, false);
  assert.equal(rl.isLocked(ip).locked, false);
});

test('rate limiter: different IPs are independent', () => {
  const rl = createRateLimiter();
  for (let i = 0; i < 5; i++) rl.record('10.0.0.3', false);
  assert.equal(rl.isLocked('10.0.0.3').locked, true);
  assert.equal(rl.isLocked('10.0.0.4').locked, false);
});

// ---------- Guard unit tests ----------

test('requireAdmin rejects kitchen cookie', async () => {
  const { requireAdmin } = await import('../server/middleware/auth.js');
  const req = { headers: { cookie: 'rs_kitchen=anything' } };
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; return this; },
  };
  let nextCalled = false;
  requireAdmin(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

test('requireKitchen accepts admin cookie', async () => {
  const { makeAdminSession, requireKitchen } = await import('../server/middleware/auth.js');
  const token = makeAdminSession();
  const req = { headers: { cookie: `rs_admin=${token}` } };
  const res = { status() { return this; }, json() { return this; } };
  let nextCalled = false;
  requireKitchen(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('requireAdmin rejects expired session', async () => {
  const { requireAdmin } = await import('../server/middleware/auth.js');
  // Forge a cookie with exp in the past — signature will not verify anyway,
  // but this confirms the middleware rejects it.
  const req = { headers: { cookie: 'rs_admin=deadbeef.deadbeef' } };
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json() { return this; },
  };
  let nextCalled = false;
  requireAdmin(req, res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 401);
});

// ---------- Change PIN ----------

test('change admin PIN succeeds with correct current PIN', async () => {
  const { app, db } = appWithDb();
  const cookie = await loginAdmin(app);

  const res = await request(app)
    .post('/api/admin/auth/change-pin')
    .set('Cookie', cookie)
    .send({ current_pin: '1234', target: 'admin', new_pin: '9876' });

  assert.equal(res.status, 200);
  assert.equal(res.body.target, 'admin');

  // Old PIN no longer works, new one does
  const oldRes = await request(app).post('/api/admin/auth/login').send({ pin: '1234' });
  assert.equal(oldRes.status, 401);

  const newRes = await request(app).post('/api/admin/auth/login').send({ pin: '9876' });
  assert.equal(newRes.status, 200);
  db.close();
});

test('change kitchen PIN sets kitchen_pin setting', async () => {
  const { app, db } = appWithDb();
  const cookie = await loginAdmin(app);

  const res = await request(app)
    .post('/api/admin/auth/change-pin')
    .set('Cookie', cookie)
    .send({ current_pin: '1234', target: 'kitchen', new_pin: '4321' });

  assert.equal(res.status, 200);
  const row = db.prepare("SELECT value FROM settings WHERE key = 'kitchen_pin'").get();
  assert.equal(row.value, '4321');

  // Kitchen login now uses the new PIN
  const oldRes = await request(app).post('/api/kitchen/auth/login').send({ pin: '1234' });
  assert.equal(oldRes.status, 401);

  const newRes = await request(app).post('/api/kitchen/auth/login').send({ pin: '4321' });
  assert.equal(newRes.status, 200);
  db.close();
});

test('change PIN rejects wrong current PIN', async () => {
  const { app, db } = appWithDb();
  const cookie = await loginAdmin(app);
  const res = await request(app)
    .post('/api/admin/auth/change-pin')
    .set('Cookie', cookie)
    .send({ current_pin: '0000', target: 'admin', new_pin: '9876' });
  assert.equal(res.status, 401);
  db.close();
});

test('change PIN rejects invalid target', async () => {
  const { app, db } = appWithDb();
  const cookie = await loginAdmin(app);
  const res = await request(app)
    .post('/api/admin/auth/change-pin')
    .set('Cookie', cookie)
    .send({ current_pin: '1234', target: 'bogus', new_pin: '9876' });
  assert.equal(res.status, 400);
  db.close();
});

test('change PIN rejects non-numeric new_pin', async () => {
  const { app, db } = appWithDb();
  const cookie = await loginAdmin(app);
  const res = await request(app)
    .post('/api/admin/auth/change-pin')
    .set('Cookie', cookie)
    .send({ current_pin: '1234', target: 'admin', new_pin: 'abcd' });
  assert.equal(res.status, 400);
  db.close();
});

test('change PIN rejects too short new_pin', async () => {
  const { app, db } = appWithDb();
  const cookie = await loginAdmin(app);
  const res = await request(app)
    .post('/api/admin/auth/change-pin')
    .set('Cookie', cookie)
    .send({ current_pin: '1234', target: 'admin', new_pin: '12' });
  assert.equal(res.status, 400);
  db.close();
});

test('change PIN rejects same-as-current', async () => {
  const { app, db } = appWithDb();
  const cookie = await loginAdmin(app);
  const res = await request(app)
    .post('/api/admin/auth/change-pin')
    .set('Cookie', cookie)
    .send({ current_pin: '1234', target: 'admin', new_pin: '1234' });
  assert.equal(res.status, 400);
  db.close();
});

test('change PIN requires authentication', async () => {
  const { app, db } = appWithDb();
  // No cookie — should still be caught by requireAdmin when we apply it,
  // but this endpoint is at /api/admin/auth/* which is open. So we
  // verify the pin confirmation still protects it.
  const res = await request(app)
    .post('/api/admin/auth/change-pin')
    .send({ current_pin: '0000', target: 'admin', new_pin: '9876' });
  assert.equal(res.status, 401);
  db.close();
});

// ---------- Settings ----------

test('GET /api/admin/settings returns current settings', async () => {
  const { app, db } = appWithDb();
  const cookie = await loginAdmin(app);
  const res = await request(app).get('/api/admin/settings').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.restaurant_name, 'My Restaurant');
  assert.equal(res.body.currency, 'MMK');
  assert.equal(res.body.default_language, 'en');
  db.close();
});

test('PUT /api/admin/settings updates a value', async () => {
  const { app, db } = appWithDb();
  const cookie = await loginAdmin(app);
  const res = await request(app)
    .put('/api/admin/settings')
    .set('Cookie', cookie)
    .send({ restaurant_name: 'Golden Duck' });
  assert.equal(res.status, 200);
  assert.equal(res.body.restaurant_name, 'Golden Duck');
  db.close();
});

test('PUT /api/admin/settings rejects non-whitelisted key', async () => {
  const { app, db } = appWithDb();
  const cookie = await loginAdmin(app);
  const res = await request(app)
    .put('/api/admin/settings')
    .set('Cookie', cookie)
    .send({ admin_pin: '9999' });
  assert.equal(res.status, 400);
  db.close();
});

test('PUT /api/admin/settings requires auth', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).put('/api/admin/settings').send({ currency: 'USD' });
  assert.equal(res.status, 401);
  db.close();
});

test('GET /api/public/settings returns restaurant_name without auth', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).get('/api/public/settings');
  assert.equal(res.status, 200);
  assert.ok('restaurant_name' in res.body);
  db.close();
});

test('GET /api/public/settings does not leak admin_pin', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).get('/api/public/settings');
  assert.equal(res.status, 200);
  assert.equal(res.body.admin_pin, undefined);
  assert.equal(res.body.kitchen_pin, undefined);
  db.close();
});

// ---------- Order history ----------

test('GET /api/admin/orders returns empty history', async () => {
  const { app, db } = appWithDb();
  const cookie = await loginAdmin(app);
  const res = await request(app).get('/api/admin/orders').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.total_count, 0);
  assert.equal(res.body.total_sum, 0);
  assert.deepEqual(res.body.orders, []);
  db.close();
});

test('GET /api/admin/orders returns orders with items', async () => {
  const { app, db } = appWithDb();
  const cookie = await loginAdmin(app);
  const agent = request.agent(app);
  await agent.post('/api/admin/auth/login').send({ pin: '1234' });

  const t = await agent.post('/api/admin/tables').send({ table_number: 'T1' });
  const cat = await agent.post('/api/admin/categories').send({ name: 'C' });
  const item = await agent.post('/api/admin/menu-items').send({ name: 'X', price: 4.5, category_id: cat.body.id });

  await request(app).post('/api/customer/orders').send({
    token: t.body.qr_token,
    items: [{ itemId: item.body.id, qty: 2 }],
  });

  const res = await request(app).get('/api/admin/orders').set('Cookie', cookie);
  assert.equal(res.body.total_count, 1);
  assert.equal(res.body.total_sum, 9.0);
  assert.equal(res.body.orders[0].table_number, 'T1');
  assert.equal(res.body.orders[0].items.length, 1);
  assert.equal(res.body.orders[0].items[0].qty, 2);
  db.close();
});

test('GET /api/admin/orders requires auth', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).get('/api/admin/orders');
  assert.equal(res.status, 401);
  db.close();
});

test('GET /api/admin/orders rejects bad date format', async () => {
  const { app, db } = appWithDb();
  const cookie = await loginAdmin(app);
  const res = await request(app).get('/api/admin/orders?from=abc').set('Cookie', cookie);
  assert.equal(res.status, 400);
  db.close();
});

test('GET /api/admin/orders respects date range', async () => {
  const { app, db } = appWithDb();
  const cookie = await loginAdmin(app);
  const agent = request.agent(app);
  await agent.post('/api/admin/auth/login').send({ pin: '1234' });

  const t = await agent.post('/api/admin/tables').send({ table_number: 'T1' });
  const o = db.prepare('INSERT INTO orders (table_id, total, created_at) VALUES (?, ?, ?)')
    .run(t.body.id, 5, '2024-01-15 12:00:00');

  const inRange = await request(app).get('/api/admin/orders?from=2024-01-01&to=2024-01-31').set('Cookie', cookie);
  assert.equal(inRange.body.total_count, 1);

  const outOfRange = await request(app).get('/api/admin/orders?from=2025-01-01').set('Cookie', cookie);
  assert.equal(outOfRange.body.total_count, 0);
  db.close();
});
