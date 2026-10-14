import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';

function appWithDb() {
  const db = createDb(':memory:', { quiet: true });
  return { app: createApp({ db }), db };
}

// ---------- POST ----------

test('POST creates a category with default sort_order', async () => {
  const { app, db } = appWithDb();
  const res = await request(app)
    .post('/api/admin/categories')
    .send({ name: 'Starters' });

  assert.equal(res.status, 201);
  assert.equal(res.body.name, 'Starters');
  assert.equal(res.body.sort_order, 0);
  assert.equal(res.body.is_active, 1);
  assert.ok(res.body.id > 0);
  db.close();
});

test('POST with sort_order stores it', async () => {
  const { app, db } = appWithDb();
  const res = await request(app)
    .post('/api/admin/categories')
    .send({ name: 'Mains', sort_order: 5 });

  assert.equal(res.status, 201);
  assert.equal(res.body.sort_order, 5);
  db.close();
});

test('POST without name returns 400', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).post('/api/admin/categories').send({});
  assert.equal(res.status, 400);
  db.close();
});

test('POST duplicate name returns 409', async () => {
  const { app, db } = appWithDb();
  await request(app).post('/api/admin/categories').send({ name: 'Drinks' });
  const res = await request(app).post('/api/admin/categories').send({ name: 'Drinks' });
  assert.equal(res.status, 409);
  db.close();
});

// ---------- GET ----------

test('GET returns categories ordered by sort_order, name', async () => {
  const { app, db } = appWithDb();
  await request(app).post('/api/admin/categories').send({ name: 'Zeta', sort_order: 1 });
  await request(app).post('/api/admin/categories').send({ name: 'Alpha', sort_order: 1 });
  await request(app).post('/api/admin/categories').send({ name: 'Middles', sort_order: 0 });

  const res = await request(app).get('/api/admin/categories');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.map((c) => c.name), ['Middles', 'Alpha', 'Zeta']);
  db.close();
});

// ---------- PUT ----------

test('PUT updates name only', async () => {
  const { app, db } = appWithDb();
  const created = await request(app).post('/api/admin/categories').send({ name: 'Old' });

  const res = await request(app)
    .put(`/api/admin/categories/${created.body.id}`)
    .send({ name: 'New' });

  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'New');
  assert.equal(res.body.sort_order, 0);
  db.close();
});

test('PUT to a name that already exists returns 409', async () => {
  const { app, db } = appWithDb();
  await request(app).post('/api/admin/categories').send({ name: 'A' });
  const b = await request(app).post('/api/admin/categories').send({ name: 'B' });

  const res = await request(app)
    .put(`/api/admin/categories/${b.body.id}`)
    .send({ name: 'A' });

  assert.equal(res.status, 409);
  db.close();
});

test('PUT with empty body returns 400', async () => {
  const { app, db } = appWithDb();
  const created = await request(app).post('/api/admin/categories').send({ name: 'X' });
  const res = await request(app)
    .put(`/api/admin/categories/${created.body.id}`)
    .send({});
  assert.equal(res.status, 400);
  db.close();
});

test('PUT on unknown id returns 404', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).put('/api/admin/categories/9999').send({ name: 'X' });
  assert.equal(res.status, 404);
  db.close();
});

// ---------- DELETE ----------

test('DELETE removes the category row entirely (hard delete)', async () => {
  const { app, db } = appWithDb();
  const created = await request(app).post('/api/admin/categories').send({ name: 'Temp' });

  const res = await request(app).delete(`/api/admin/categories/${created.body.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.deleted, true);

  const gone = db.prepare('SELECT * FROM categories WHERE id = ?').get(created.body.id);
  assert.equal(gone, undefined);
  db.close();
});

test('DELETE leaves menu_items alive with category_id = NULL', async () => {
  const { app, db } = appWithDb();
  const cat = await request(app).post('/api/admin/categories').send({ name: 'Drinks' });

  db.prepare('INSERT INTO menu_items (category_id, name, price) VALUES (?, ?, ?)')
    .run(cat.body.id, 'Cola', 2.0);

  await request(app).delete(`/api/admin/categories/${cat.body.id}`);

  const item = db.prepare('SELECT * FROM menu_items WHERE name = ?').get('Cola');
  assert.ok(item, 'item should survive');
  assert.equal(item.category_id, null);
  db.close();
});

test('DELETE on unknown id returns 404', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).delete('/api/admin/categories/9999');
  assert.equal(res.status, 404);
  db.close();
});
