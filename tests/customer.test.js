import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';

function appWithDb() {
  const db = createDb(':memory:', { quiet: true });
  return { app: createApp({ db }), db };
}

async function makeTable(app, { table_number = 'T1', is_active = 1 } = {}) {
  const created = await request(app)
    .post('/api/admin/tables')
    .send({ table_number });
  if (!is_active) {
    await request(app).put(`/api/admin/tables/${created.body.id}`).send({ is_active: 0 });
  }
  return created.body;
}

test('GET /t/:token serves HTML for a valid active table', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);

  const res = await request(app).get(`/t/${t.qr_token}`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.match(res.text, /Menu/);
  db.close();
});

test('GET /t/:token returns 404 for unknown token', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).get('/t/doesNotExist123');
  assert.equal(res.status, 404);
  db.close();
});

test('GET /t/:token returns 410 for inactive table', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app, { table_number: 'T1', is_active: 0 });
  const res = await request(app).get(`/t/${t.qr_token}`);
  assert.equal(res.status, 410);
  db.close();
});

test('regenerated token invalidates the old URL', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  await request(app).post(`/api/admin/tables/${t.id}/regenerate-token`).send();
  const res = await request(app).get(`/t/${t.qr_token}`);
  assert.equal(res.status, 404);
  db.close();
});

// ---------- GET /api/customer/menu ----------

test('menu returns 400 without token', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).get('/api/customer/menu');
  assert.equal(res.status, 400);
  db.close();
});

test('menu returns 404 for unknown token', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).get('/api/customer/menu?token=doesNotExist123');
  assert.equal(res.status, 404);
  db.close();
});

test('menu returns 410 for inactive table', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app, { table_number: 'T1', is_active: 0 });
  const res = await request(app).get(`/api/customer/menu?token=${t.qr_token}`);
  assert.equal(res.status, 410);
  db.close();
});

test('menu returns empty categories for a fresh table', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const res = await request(app).get(`/api/customer/menu?token=${t.qr_token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.table.table_number, 'T1');
  assert.deepEqual(res.body.categories, []);
  db.close();
});

test('menu includes active categories with their items', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);

  const cat = await request(app).post('/api/admin/categories').send({ name: 'Starters' });
  await request(app).post('/api/admin/menu-items').send({
    name: 'Spring Rolls', price: 4.5, category_id: cat.body.id,
  });
  await request(app).post('/api/admin/menu-items').send({
    name: 'Soup', price: 3.0, category_id: cat.body.id,
  });

  const res = await request(app).get(`/api/customer/menu?token=${t.qr_token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.categories.length, 1);
  assert.equal(res.body.categories[0].name, 'Starters');
  assert.equal(res.body.categories[0].items.length, 2);
  assert.equal(res.body.categories[0].items[0].name, 'Soup'); // alphabetical within
  assert.equal(res.body.categories[0].items[0].price, 3.0);
  db.close();
});

test('menu excludes inactive categories', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const cat = await request(app).post('/api/admin/categories').send({ name: 'Hidden' });
  await request(app).put(`/api/admin/categories/${cat.body.id}`).send({ is_active: 0 });
  await request(app).post('/api/admin/menu-items').send({
    name: 'X', price: 1, category_id: cat.body.id,
  });

  const res = await request(app).get(`/api/customer/menu?token=${t.qr_token}`);
  assert.equal(res.body.categories.length, 0);
  db.close();
});

test('menu excludes inactive items', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const cat = await request(app).post('/api/admin/categories').send({ name: 'C' });
  const item = await request(app).post('/api/admin/menu-items').send({
    name: 'Visible', price: 1, category_id: cat.body.id,
  });
  await request(app).put(`/api/admin/menu-items/${item.body.id}`).send({ is_active: 0 });

  const res = await request(app).get(`/api/customer/menu?token=${t.qr_token}`);
  assert.equal(res.body.categories.length, 0);
  db.close();
});

test('menu shows unavailable items with is_available: 0', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const cat = await request(app).post('/api/admin/categories').send({ name: 'C' });
  const item = await request(app).post('/api/admin/menu-items').send({
    name: 'Sold out', price: 1, category_id: cat.body.id,
  });
  await request(app).put(`/api/admin/menu-items/${item.body.id}`).send({ is_available: 0 });

  const res = await request(app).get(`/api/customer/menu?token=${t.qr_token}`);
  assert.equal(res.body.categories.length, 1);
  assert.equal(res.body.categories[0].items[0].is_available, 0);
  db.close();
});

test('uncategorized items appear under "Other"', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  await request(app).post('/api/admin/menu-items').send({ name: 'Water', price: 1 });
  await request(app).post('/api/admin/menu-items').send({ name: 'Bread', price: 2 });

  const res = await request(app).get(`/api/customer/menu?token=${t.qr_token}`);
  assert.equal(res.body.categories.length, 1);
  assert.equal(res.body.categories[0].name, 'Other');
  assert.equal(res.body.categories[0].items.length, 2);
  db.close();
});

test('categories are ordered by sort_order then name', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);

  const zeta = await request(app).post('/api/admin/categories').send({ name: 'Zeta', sort_order: 1 });
  const alpha = await request(app).post('/api/admin/categories').send({ name: 'Alpha', sort_order: 0 });
  await request(app).post('/api/admin/menu-items').send({ name: 'X', price: 1, category_id: zeta.body.id });
  await request(app).post('/api/admin/menu-items').send({ name: 'Y', price: 1, category_id: alpha.body.id });

  const res = await request(app).get(`/api/customer/menu?token=${t.qr_token}`);
  assert.deepEqual(res.body.categories.map((c) => c.name), ['Alpha', 'Zeta']);
  db.close();
});
