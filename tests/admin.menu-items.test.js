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

async function makeCategory(agent, name = 'Starters') {
  const res = await agent.post('/api/admin/categories').send({ name });
  return res.body.id;
}

test('POST creates a menu item in a category', async () => {
  const { app, agent, db } = await appWithDb();
  const catId = await makeCategory(agent);
  const res = await agent.post('/api/admin/menu-items').send({
    name: 'Spring Rolls', description: 'Crispy', price: 4.5, category_id: catId,
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'Spring Rolls');
  assert.equal(res.body.price, 4.5);
  assert.equal(res.body.category_id, catId);
  assert.equal(res.body.is_available, 1);
  assert.equal(res.body.is_active, 1);
  db.close();
});

test('POST without name returns 400', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.post('/api/admin/menu-items').send({ price: 5 });
  assert.equal(res.status, 400);
  db.close();
});

test('POST without price returns 400', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.post('/api/admin/menu-items').send({ name: 'X' });
  assert.equal(res.status, 400);
  db.close();
});

test('POST with negative price returns 400', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.post('/api/admin/menu-items').send({ name: 'X', price: -1 });
  assert.equal(res.status, 400);
  db.close();
});

test('POST with nonexistent category_id returns 400', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.post('/api/admin/menu-items')
    .send({ name: 'X', price: 1, category_id: 9999 });
  assert.equal(res.status, 400);
  db.close();
});

test('POST can create an uncategorized item', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.post('/api/admin/menu-items').send({ name: 'Water', price: 1 });
  assert.equal(res.status, 201);
  assert.equal(res.body.category_id, null);
  db.close();
});

test('GET returns all items ordered by sort_order, name', async () => {
  const { app, agent, db } = await appWithDb();
  await agent.post('/api/admin/menu-items').send({ name: 'Zeta', price: 1, sort_order: 1 });
  await agent.post('/api/admin/menu-items').send({ name: 'Alpha', price: 1, sort_order: 1 });
  await agent.post('/api/admin/menu-items').send({ name: 'Middle', price: 1, sort_order: 0 });
  const res = await agent.get('/api/admin/menu-items');
  assert.deepEqual(res.body.map((i) => i.name), ['Middle', 'Alpha', 'Zeta']);
  db.close();
});

test('GET ?category_id= filters', async () => {
  const { app, agent, db } = await appWithDb();
  const catA = await makeCategory(agent, 'A');
  const catB = await makeCategory(agent, 'B');
  await agent.post('/api/admin/menu-items').send({ name: 'X', price: 1, category_id: catA });
  await agent.post('/api/admin/menu-items').send({ name: 'Y', price: 1, category_id: catB });
  const res = await agent.get(`/api/admin/menu-items?category_id=${catA}`);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].name, 'X');
  db.close();
});

test('PUT updates price', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/menu-items').send({ name: 'X', price: 5 });
  const res = await agent.put(`/api/admin/menu-items/${created.body.id}`).send({ price: 6.5 });
  assert.equal(res.status, 200);
  assert.equal(res.body.price, 6.5);
  assert.equal(res.body.name, 'X');
  db.close();
});

test('PUT toggles is_available', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/menu-items').send({ name: 'X', price: 1 });
  const res = await agent.put(`/api/admin/menu-items/${created.body.id}`).send({ is_available: 0 });
  assert.equal(res.body.is_available, 0);
  db.close();
});

test('PUT clears category_id with null', async () => {
  const { app, agent, db } = await appWithDb();
  const catId = await makeCategory(agent);
  const created = await agent.post('/api/admin/menu-items')
    .send({ name: 'X', price: 1, category_id: catId });
  const res = await agent.put(`/api/admin/menu-items/${created.body.id}`).send({ category_id: null });
  assert.equal(res.body.category_id, null);
  db.close();
});

test('PUT with empty body returns 400', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/menu-items').send({ name: 'X', price: 1 });
  const res = await agent.put(`/api/admin/menu-items/${created.body.id}`).send({});
  assert.equal(res.status, 400);
  db.close();
});

test('PUT on unknown id returns 404', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.put('/api/admin/menu-items/9999').send({ price: 1 });
  assert.equal(res.status, 404);
  db.close();
});

test('DELETE removes the item', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/menu-items').send({ name: 'X', price: 1 });
  const res = await agent.delete(`/api/admin/menu-items/${created.body.id}`);
  assert.equal(res.status, 200);
  const gone = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(created.body.id);
  assert.equal(gone, undefined);
  db.close();
});

test('DELETE keeps order history intact', async () => {
  const { app, agent, db } = await appWithDb();
  const created = await agent.post('/api/admin/menu-items').send({ name: 'X', price: 4.5 });
  db.prepare('INSERT INTO tables (table_number, qr_token) VALUES (?, ?)').run('T1', 'tok1');
  const t = db.prepare('SELECT id FROM tables WHERE table_number = ?').get('T1');
  const o = db.prepare('INSERT INTO orders (table_id, total) VALUES (?, ?)').run(t.id, 4.5);
  db.prepare(
    `INSERT INTO order_items (order_id, menu_item_id, name_snapshot, price_snapshot, qty)
     VALUES (?, ?, ?, ?, ?)`
  ).run(o.lastInsertRowid, created.body.id, 'X', 4.5, 1);

  await agent.delete(`/api/admin/menu-items/${created.body.id}`);

  const item = db.prepare('SELECT * FROM order_items WHERE order_id = ?').get(o.lastInsertRowid);
  assert.ok(item);
  assert.equal(item.menu_item_id, null);
  assert.equal(item.price_snapshot, 4.5);
  db.close();
});

test('DELETE on unknown id returns 404', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.delete('/api/admin/menu-items/9999');
  assert.equal(res.status, 404);
  db.close();
});
