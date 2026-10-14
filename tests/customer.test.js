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

test('GET /t/:token serves the customer menu script', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  // The script is served by static middleware from public/customer
  const res = await request(app).get('/customer/menu.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
  db.close();
});

// ---------- POST /api/customer/orders ----------

async function seedMenuItem(app, { name = 'X', price = 4.5, category = true } = {}) {
  let category_id = null;
  if (category) {
    const cat = await request(app).post('/api/admin/categories').send({ name: `C-${name}-${Math.random()}` });
    category_id = cat.body.id;
  }
  const item = await request(app).post('/api/admin/menu-items').send({ name, price, category_id });
  return item.body;
}

test('POST /api/customer/orders creates an order with items', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const item = await seedMenuItem(app, { name: 'Spring Rolls', price: 4.5 });

  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{ itemId: item.id, qty: 2 }],
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.order.table_id, t.id);
  assert.equal(res.body.order.status, 'placed');
  assert.equal(res.body.order.total, 9.0);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].name_snapshot, 'Spring Rolls');
  assert.equal(res.body.items[0].price_snapshot, 4.5);
  assert.equal(res.body.items[0].qty, 2);
  db.close();
});

test('POST uses current DB price, ignores client price', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const item = await seedMenuItem(app, { name: 'X', price: 10 });

  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{ itemId: item.id, qty: 1, price: 0.01 }],
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.order.total, 10);
  assert.equal(res.body.items[0].price_snapshot, 10);
  db.close();
});

test('POST with unknown token returns 404', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).post('/api/customer/orders').send({
    token: 'bogus',
    items: [{ itemId: 1, qty: 1 }],
  });
  assert.equal(res.status, 404);
  db.close();
});

test('POST with inactive table returns 410', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app, { table_number: 'T1', is_active: 0 });
  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{ itemId: 1, qty: 1 }],
  });
  assert.equal(res.status, 410);
  db.close();
});

test('POST with empty items returns 400', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [],
  });
  assert.equal(res.status, 400);
  db.close();
});

test('POST with unknown itemId returns 400', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{ itemId: 9999, qty: 1 }],
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /not found/);
  db.close();
});

test('POST with sold-out item returns 400', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const item = await seedMenuItem(app, { name: 'Sold', price: 1 });
  await request(app).put(`/api/admin/menu-items/${item.id}`).send({ is_available: 0 });

  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{ itemId: item.id, qty: 1 }],
  });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /sold out/);
  db.close();
});

test('POST with inactive category returns 400', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const cat = await request(app).post('/api/admin/categories').send({ name: 'Hidden' });
  const item = await request(app).post('/api/admin/menu-items').send({
    name: 'X', price: 1, category_id: cat.body.id,
  });
  await request(app).put(`/api/admin/categories/${cat.body.id}`).send({ is_active: 0 });

  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{ itemId: item.body.id, qty: 1 }],
  });
  assert.equal(res.status, 400);
  db.close();
});

test('POST with qty=0 returns 400', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const item = await seedMenuItem(app, { name: 'X', price: 1 });
  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{ itemId: item.id, qty: 0 }],
  });
  assert.equal(res.status, 400);
  db.close();
});

test('POST with qty>99 returns 400', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const item = await seedMenuItem(app, { name: 'X', price: 1 });
  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{ itemId: item.id, qty: 100 }],
  });
  assert.equal(res.status, 400);
  db.close();
});

test('POST with multiple items sums the total', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const a = await seedMenuItem(app, { name: 'A', price: 4.5 });
  const b = await seedMenuItem(app, { name: 'B', price: 6.0 });

  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [
      { itemId: a.id, qty: 2 },
      { itemId: b.id, qty: 1 },
    ],
  });

  assert.equal(res.status, 201);
  assert.equal(res.body.order.total, 15.0); // 4.5*2 + 6.0
  assert.equal(res.body.items.length, 2);
  db.close();
});

// ---------- GET /api/customer/orders/:id ----------

test('order status returns order + items for the matching token', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const item = await seedMenuItem(app, { name: 'X', price: 4.5 });
  const placed = await request(app).post('/api/customer/orders').send({
    token: t.qr_token, items: [{ itemId: item.id, qty: 2 }],
  });

  const res = await request(app)
    .get(`/api/customer/orders/${placed.body.order.id}?token=${t.qr_token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.order.id, placed.body.order.id);
  assert.equal(res.body.order.status, 'placed');
  assert.equal(res.body.order.total, 9.0);
  assert.equal(res.body.items.length, 1);
  assert.equal(res.body.items[0].name_snapshot, 'X');
  assert.equal(res.body.items[0].qty, 2);
  db.close();
});

test('order status reflects updates from the kitchen', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const item = await seedMenuItem(app, { name: 'X', price: 1 });
  const placed = await request(app).post('/api/customer/orders').send({
    token: t.qr_token, items: [{ itemId: item.id, qty: 1 }],
  });

  await request(app)
    .patch(`/api/kitchen/orders/${placed.body.order.id}`)
    .send({ status: 'preparing' });

  const res = await request(app)
    .get(`/api/customer/orders/${placed.body.order.id}?token=${t.qr_token}`);
  assert.equal(res.body.order.status, 'preparing');
  db.close();
});

test('order status 404 for mismatched token', async () => {
  const { app, db } = appWithDb();
  const t1 = await makeTable(app, { table_number: 'T1' });
  const t2 = await makeTable(app, { table_number: 'T2' });
  const item = await seedMenuItem(app, { name: 'X', price: 1 });
  const placed = await request(app).post('/api/customer/orders').send({
    token: t1.qr_token, items: [{ itemId: item.id, qty: 1 }],
  });

  const res = await request(app)
    .get(`/api/customer/orders/${placed.body.order.id}?token=${t2.qr_token}`);
  assert.equal(res.status, 404);
  db.close();
});

test('order status 404 for unknown order id', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  const res = await request(app)
    .get(`/api/customer/orders/9999?token=${t.qr_token}`);
  assert.equal(res.status, 404);
  db.close();
});

test('order status 400 without token', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).get('/api/customer/orders/1');
  assert.equal(res.status, 400);
  db.close();
});

test('order status 410 for inactive table', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app, { table_number: 'T1', is_active: 0 });
  const res = await request(app)
    .get(`/api/customer/orders/1?token=${t.qr_token}`);
  assert.equal(res.status, 410);
  db.close();
});
