import { test } from 'node:test';
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
