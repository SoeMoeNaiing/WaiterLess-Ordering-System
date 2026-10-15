import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';
import { loginAdmin } from './helpers/auth.js';

async function appWithDb() {
  const db = createDb(':memory:', { quiet: true });
  const app = createApp({ db });
  const agent = request.agent(app);
  await agent.post('/api/admin/auth/login').send({ pin: '1234' });
  return { app, agent, db };
}

test('POST /api/admin/tables creates a table with a token', async () => {
  const { app, agent, db } = await appWithDb();

  const res = await agent.post('/api/admin/tables')
    .send({ table_number: 'T1', label: 'Window seat' });

  assert.equal(res.status, 201);
  assert.equal(res.body.table_number, 'T1');
  assert.equal(res.body.label, 'Window seat');
  assert.equal(res.body.is_active, 1);
  assert.equal(typeof res.body.qr_token, 'string');
  assert.equal(res.body.qr_token.length, 12);
  assert.ok(res.body.id > 0);
  db.close();
});

test('POST with label omitted stores label as null', async () => {
  const { app, agent, db } = await appWithDb();

  const res = await agent.post('/api/admin/tables')
    .send({ table_number: 'T2' });

  assert.equal(res.status, 201);
  assert.equal(res.body.label, null);
  db.close();
});

test('POST without table_number returns 400', async () => {
  const { app, agent, db } = await appWithDb();

  const res = await agent.post('/api/admin/tables')
    .send({ label: 'No number' });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /table_number/);
  db.close();
});

test('POST with empty/whitespace table_number returns 400', async () => {
  const { app, agent, db } = await appWithDb();

  const res = await agent.post('/api/admin/tables')
    .send({ table_number: '   ' });

  assert.equal(res.status, 400);
  db.close();
});

test('POST with duplicate table_number returns 409', async () => {
  const { app, agent, db } = await appWithDb();

  const first = await agent.post('/api/admin/tables')
    .send({ table_number: 'T1' });
  assert.equal(first.status, 201);

  const second = await agent.post('/api/admin/tables')
    .send({ table_number: 'T1' });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /already exists/);
  db.close();
});

test('two tables get different tokens', async () => {
  const { app, agent, db } = await appWithDb();

  const a = await agent.post('/api/admin/tables').send({ table_number: 'A' });
  const b = await agent.post('/api/admin/tables').send({ table_number: 'B' });

  assert.notEqual(a.body.qr_token, b.body.qr_token);
  db.close();
});

test('table_number is trimmed before saving', async () => {
  const { app, agent, db } = await appWithDb();

  const res = await agent.post('/api/admin/tables')
    .send({ table_number: '  T9  ' });

  assert.equal(res.status, 201);
  assert.equal(res.body.table_number, 'T9');
  db.close();
});


// ---------- GET /api/admin/tables ----------

test('GET /api/admin/tables returns an empty array initially', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.get('/api/admin/tables');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
  db.close();
});

test('GET /api/admin/tables returns all tables ordered by table_number', async () => {
  const { app, agent, db } = await appWithDb();
  await agent.post('/api/admin/tables').send({ table_number: 'T3' });
  await agent.post('/api/admin/tables').send({ table_number: 'T1' });
  await agent.post('/api/admin/tables').send({ table_number: 'T2' });

  const res = await agent.get('/api/admin/tables');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 3);
  assert.deepEqual(res.body.map((t) => t.table_number), ['T1', 'T2', 'T3']);
  db.close();
});

test('GET /api/admin/tables?active=1 returns only active tables', async () => {
  const { app, agent, db } = await appWithDb();
  await agent.post('/api/admin/tables').send({ table_number: 'T1' });
  await agent.post('/api/admin/tables').send({ table_number: 'T2' });

  // Deactivate T2 directly via the DB (no HTTP endpoint for this yet)
  db.prepare('UPDATE tables SET is_active = 0 WHERE table_number = ?').run('T2');

  const res = await agent.get('/api/admin/tables?active=1');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].table_number, 'T1');
  db.close();
});

test('GET /api/admin/tables?active=0 returns only inactive tables', async () => {
  const { app, agent, db } = await appWithDb();
  await agent.post('/api/admin/tables').send({ table_number: 'T1' });
  await agent.post('/api/admin/tables').send({ table_number: 'T2' });
  db.prepare('UPDATE tables SET is_active = 0 WHERE table_number = ?').run('T2');

  const res = await agent.get('/api/admin/tables?active=0');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].table_number, 'T2');
  db.close();
});

test('GET /api/admin/tables?active=bogus ignores the filter', async () => {
  const { app, agent, db } = await appWithDb();
  await agent.post('/api/admin/tables').send({ table_number: 'T1' });
  await agent.post('/api/admin/tables').send({ table_number: 'T2' });
  db.prepare('UPDATE tables SET is_active = 0 WHERE table_number = ?').run('T2');

  const res = await agent.get('/api/admin/tables?active=bogus');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  db.close();
});
// ---------- GET /api/admin/tables ----------

test('GET /api/admin/tables returns an empty array initially', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.get('/api/admin/tables');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
  db.close();
});

test('GET /api/admin/tables returns all tables ordered by table_number', async () => {
  const { app, agent, db } = await appWithDb();
  await agent.post('/api/admin/tables').send({ table_number: 'T3' });
  await agent.post('/api/admin/tables').send({ table_number: 'T1' });
  await agent.post('/api/admin/tables').send({ table_number: 'T2' });

  const res = await agent.get('/api/admin/tables');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 3);
  assert.deepEqual(res.body.map((t) => t.table_number), ['T1', 'T2', 'T3']);
  db.close();
});

test('GET /api/admin/tables?active=1 returns only active tables', async () => {
  const { app, agent, db } = await appWithDb();
  await agent.post('/api/admin/tables').send({ table_number: 'T1' });
  await agent.post('/api/admin/tables').send({ table_number: 'T2' });

  db.prepare('UPDATE tables SET is_active = 0 WHERE table_number = ?').run('T2');

  const res = await agent.get('/api/admin/tables?active=1');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].table_number, 'T1');
  db.close();
});

test('GET /api/admin/tables?active=0 returns only inactive tables', async () => {
  const { app, agent, db } = await appWithDb();
  await agent.post('/api/admin/tables').send({ table_number: 'T1' });
  await agent.post('/api/admin/tables').send({ table_number: 'T2' });
  db.prepare('UPDATE tables SET is_active = 0 WHERE table_number = ?').run('T2');

  const res = await agent.get('/api/admin/tables?active=0');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].table_number, 'T2');
  db.close();
});

test('GET /api/admin/tables?active=bogus ignores the filter', async () => {
  const { app, agent, db } = await appWithDb();
  await agent.post('/api/admin/tables').send({ table_number: 'T1' });
  await agent.post('/api/admin/tables').send({ table_number: 'T2' });
  db.prepare('UPDATE tables SET is_active = 0 WHERE table_number = ?').run('T2');

  const res = await agent.get('/api/admin/tables?active=bogus');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 2);
  db.close();
});

// ---------- PUT /api/admin/tables/:id ----------

test('PUT updates label only, leaves table_number unchanged', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent
    .post('/api/admin/tables')
    .send({ table_number: 'T1', label: 'Old' });

  const res = await agent.put(`/api/admin/tables/${created.body.id}`)
    .send({ label: 'New' });

  assert.equal(res.status, 200);
  assert.equal(res.body.label, 'New');
  assert.equal(res.body.table_number, 'T1');
  db.close();
});

test('PUT updates table_number only', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/tables')
    .send({ table_number: 'T1', label: 'Window' });

  const res = await agent.put(`/api/admin/tables/${created.body.id}`)
    .send({ table_number: 'T99' });

  assert.equal(res.status, 200);
  assert.equal(res.body.table_number, 'T99');
  assert.equal(res.body.label, 'Window');
  db.close();
});

test('PUT can set is_active to 0 and back to 1', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/tables').send({ table_number: 'T1' });

  const off = await agent.put(`/api/admin/tables/${created.body.id}`)
    .send({ is_active: 0 });
  assert.equal(off.status, 200);
  assert.equal(off.body.is_active, 0);

  const on = await agent.put(`/api/admin/tables/${created.body.id}`)
    .send({ is_active: true });
  assert.equal(on.status, 200);
  assert.equal(on.body.is_active, 1);
  db.close();
});

test('PUT with empty body returns 400', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/tables').send({ table_number: 'T1' });

  const res = await agent.put(`/api/admin/tables/${created.body.id}`)
    .send({});

  assert.equal(res.status, 400);
  db.close();
});

test('PUT with unknown id returns 404', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.put('/api/admin/tables/9999')
    .send({ label: 'Ghost' });
  assert.equal(res.status, 404);
  db.close();
});

test('PUT renaming to an existing table_number returns 409', async () => {
  const { app, agent, db } = await appWithDb();
  await agent.post('/api/admin/tables').send({ table_number: 'T1' });
  const second = await agent.post('/api/admin/tables').send({ table_number: 'T2' });

  const res = await agent.put(`/api/admin/tables/${second.body.id}`)
    .send({ table_number: 'T1' });

  assert.equal(res.status, 409);
  db.close();
});

// ---------- DELETE /api/admin/tables/:id ----------

test('DELETE soft-deletes (is_active = 0), does not remove the row', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/tables').send({ table_number: 'T1' });

  const res = await agent.delete(`/api/admin/tables/${created.body.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.is_active, 0);

  const stillThere = db.prepare('SELECT * FROM tables WHERE id = ?').get(created.body.id);
  assert.ok(stillThere, 'row must still exist');
  db.close();
});

test('DELETE on unknown id returns 404', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.delete('/api/admin/tables/9999');
  assert.equal(res.status, 404);
  db.close();
});

test('DELETE twice is idempotent (second call still 200, is_active = 0)', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/tables').send({ table_number: 'T1' });

  const first = await agent.delete(`/api/admin/tables/${created.body.id}`);
  const second = await agent.delete(`/api/admin/tables/${created.body.id}`);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.is_active, 0);
  db.close();
});

// ---------- POST /api/admin/tables/:id/regenerate-token ----------

test('regenerate-token returns a new token and invalidates the old one', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/tables').send({ table_number: 'T1' });
  const oldToken = created.body.qr_token;

  const res = await agent.post(`/api/admin/tables/${created.body.id}/regenerate-token`)
    .send();

  assert.equal(res.status, 200);
  assert.notEqual(res.body.qr_token, oldToken);
  assert.equal(res.body.qr_token.length, 12);

  // Old token is nowhere in the DB
  const stale = db.prepare('SELECT id FROM tables WHERE qr_token = ?').get(oldToken);
  assert.equal(stale, undefined, 'old token should no longer exist');
  db.close();
});

test('regenerate-token preserves other fields', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/tables')
    .send({ table_number: 'T1', label: 'Window' });

  const res = await agent.post(`/api/admin/tables/${created.body.id}/regenerate-token`)
    .send();

  assert.equal(res.body.table_number, 'T1');
  assert.equal(res.body.label, 'Window');
  assert.equal(res.body.is_active, 1);
  assert.equal(res.body.id, created.body.id);
  db.close();
});

test('regenerate-token twice gives two distinct tokens', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/tables').send({ table_number: 'T1' });

  const first = await agent.post(`/api/admin/tables/${created.body.id}/regenerate-token`)
    .send();
  const second = await agent.post(`/api/admin/tables/${created.body.id}/regenerate-token`)
    .send();

  assert.notEqual(first.body.qr_token, second.body.qr_token);
  assert.notEqual(first.body.qr_token, created.body.qr_token);
  db.close();
});

test('regenerate-token on unknown id returns 404', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.post('/api/admin/tables/9999/regenerate-token')
    .send();
  assert.equal(res.status, 404);
  db.close();
});

test('regenerate-token on invalid id returns 400', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.post('/api/admin/tables/abc/regenerate-token')
    .send();
  assert.equal(res.status, 400);
  db.close();
});

// ---------- GET /api/admin/tables/:id/qr.png ----------

function getBuffer(res) {
  if (Buffer.isBuffer(res.body) && res.body.length > 0) return res.body;
  if (typeof res.text === 'string' && res.text.length > 0) return Buffer.from(res.text, 'binary');
  return Buffer.alloc(0);
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

test('QR endpoint returns a PNG', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/tables').send({ table_number: 'T1' });

  const res = await agent.get(`/api/admin/tables/${created.body.id}/qr.png`);

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^image\/png/);

  const buf = getBuffer(res);
  assert.ok(buf.length > 0, 'response should have bytes');
  assert.deepEqual(buf.subarray(0, 4), PNG_MAGIC, 'should start with PNG magic bytes');
  db.close();
});

test('QR endpoint returns 404 for unknown id', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.get('/api/admin/tables/9999/qr.png');
  assert.equal(res.status, 404);
  db.close();
});

test('QR endpoint returns 400 for invalid id', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.get('/api/admin/tables/abc/qr.png');
  assert.equal(res.status, 400);
  db.close();
});

test('QR endpoints for two different tables return different bytes', async () => {
  const { app, agent, db } = await appWithDb();
  const a = await agent.post('/api/admin/tables').send({ table_number: 'A' });
  const b = await agent.post('/api/admin/tables').send({ table_number: 'B' });

  const ra = await agent.get(`/api/admin/tables/${a.body.id}/qr.png`);
  const rb = await agent.get(`/api/admin/tables/${b.body.id}/qr.png`);

  assert.notDeepEqual(getBuffer(ra), getBuffer(rb));
  db.close();
});

test('regenerating the token changes the QR bytes', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/tables').send({ table_number: 'T1' });

  const before = await agent.get(`/api/admin/tables/${created.body.id}/qr.png`);
  await agent.post(`/api/admin/tables/${created.body.id}/regenerate-token`).send();
  const after = await agent.get(`/api/admin/tables/${created.body.id}/qr.png`);

  assert.notDeepEqual(getBuffer(before), getBuffer(after));
  db.close();
});

test('QR endpoint accepts a size query param without erroring', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/tables').send({ table_number: 'T1' });

  const res = await agent.get(`/api/admin/tables/${created.body.id}/qr.png?size=256`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^image\/png/);
  db.close();
});

// ---------- POST /api/admin/tables/:id/clear-session ----------

test('clear-session returns 0 when table has no orders', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/tables').send({ table_number: 'T1' });

  const res = await agent.post(`/api/admin/tables/${created.body.id}/clear-session`).send();
  assert.equal(res.status, 200);
  assert.equal(res.body.cleared, 0);
  db.close();
});

test('clear-session marks open orders as ended', async () => {
  const { app, agent, db } = await appWithDb();
  const t = await agent.post('/api/admin/tables').send({ table_number: 'T1' });

  // Create two orders directly
  const o1 = db.prepare('INSERT INTO orders (table_id, total) VALUES (?, ?)').run(t.body.id, 1.0);
  const o2 = db.prepare('INSERT INTO orders (table_id, total) VALUES (?, ?)').run(t.body.id, 2.0);

  const res = await agent.post(`/api/admin/tables/${t.body.id}/clear-session`).send();
  assert.equal(res.status, 200);
  assert.equal(res.body.cleared, 2);

  const a = db.prepare('SELECT session_ended_at FROM orders WHERE id = ?').get(o1.lastInsertRowid);
  const b = db.prepare('SELECT session_ended_at FROM orders WHERE id = ?').get(o2.lastInsertRowid);
  assert.ok(a.session_ended_at, 'o1 should be ended');
  assert.ok(b.session_ended_at, 'o2 should be ended');
  db.close();
});

test('clear-session does not affect other tables', async () => {
  const { app, agent, db } = await appWithDb();
  const t1 = await agent.post('/api/admin/tables').send({ table_number: 'T1' });
  const t2 = await agent.post('/api/admin/tables').send({ table_number: 'T2' });

  db.prepare('INSERT INTO orders (table_id, total) VALUES (?, ?)').run(t1.body.id, 1.0);
  const o2 = db.prepare('INSERT INTO orders (table_id, total) VALUES (?, ?)').run(t2.body.id, 2.0);

  await agent.post(`/api/admin/tables/${t1.body.id}/clear-session`).send();

  const check = db.prepare('SELECT session_ended_at FROM orders WHERE id = ?').get(o2.lastInsertRowid);
  assert.equal(check.session_ended_at, null);
  db.close();
});

test('clear-session on unknown id returns 404', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.post('/api/admin/tables/9999/clear-session').send();
  assert.equal(res.status, 404);
  db.close();
});

test('clear-session requires auth', async () => {
  const { app, db } = await appWithDb();
  const res = await request(app).post('/api/admin/tables/1/clear-session').send();
  assert.equal(res.status, 401);
  db.close();
});

test('GET /api/admin/tables includes active_orders_count', async () => {
  const { app, agent, db } = await appWithDb();
  const t = await agent.post('/api/admin/tables').send({ table_number: 'T1' });

  // No orders yet → 0
  const empty = await agent.get('/api/admin/tables');
  assert.equal(empty.body[0].active_orders_count, 0);

  // Insert 2 active + 1 served + 1 ended
  db.prepare("INSERT INTO orders (table_id, total, status) VALUES (?, ?, 'placed')").run(t.body.id, 5);
  db.prepare("INSERT INTO orders (table_id, total, status) VALUES (?, ?, 'preparing')").run(t.body.id, 5);
  db.prepare("INSERT INTO orders (table_id, total, status) VALUES (?, ?, 'served')").run(t.body.id, 5);
  db.prepare("INSERT INTO orders (table_id, total, status, session_ended_at) VALUES (?, ?, 'placed', CURRENT_TIMESTAMP)").run(t.body.id, 5);

  const withOrders = await agent.get('/api/admin/tables');
  assert.equal(withOrders.body[0].active_orders_count, 2);
  db.close();
});
