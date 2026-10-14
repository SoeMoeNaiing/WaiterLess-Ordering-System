import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';

function appWithDb() {
  const db = createDb(':memory:', { quiet: true });
  return { app: createApp({ db }), db };
}

async function makeTableAndItem(app) {
  const t = await request(app).post('/api/admin/tables').send({ table_number: 'T1' });
  const cat = await request(app).post('/api/admin/categories').send({ name: 'C' });
  const item = await request(app).post('/api/admin/menu-items')
    .send({ name: 'X', price: 4.5, category_id: cat.body.id });
  return { table: t.body, item: item.body };
}

async function placeOrder(app, token, items) {
  const res = await request(app).post('/api/customer/orders').send({ token, items });
  return res.body;
}

test('kitchen orders returns empty array when no orders', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).get('/api/kitchen/orders');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
  db.close();
});

test('kitchen orders returns active orders with items and table info', async () => {
  const { app, db } = appWithDb();
  const { table, item } = await makeTableAndItem(app);
  await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 2 }]);

  const res = await request(app).get('/api/kitchen/orders');
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  const o = res.body[0];
  assert.equal(o.status, 'placed');
  assert.equal(o.table_number, 'T1');
  assert.equal(o.total, 9.0);
  assert.equal(o.items.length, 1);
  assert.equal(o.items[0].name_snapshot, 'X');
  assert.equal(o.items[0].qty, 2);
  db.close();
});

test('kitchen orders hides served and cancelled by default', async () => {
  const { app, db } = appWithDb();
  const { table, item } = await makeTableAndItem(app);
  const o1 = await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 1 }]);
  const o2 = await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 1 }]);
  const o3 = await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 1 }]);

  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('served', o1.order.id);
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('cancelled', o2.order.id);

  const res = await request(app).get('/api/kitchen/orders');
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, o3.order.id);
  db.close();
});

test('kitchen orders?status=all returns served and cancelled too', async () => {
  const { app, db } = appWithDb();
  const { table, item } = await makeTableAndItem(app);
  const o1 = await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 1 }]);
  const o2 = await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 1 }]);
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('served', o1.order.id);
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('cancelled', o2.order.id);

  const res = await request(app).get('/api/kitchen/orders?status=all');
  assert.equal(res.body.length, 2);
  db.close();
});

test('kitchen orders are sorted oldest first', async () => {
  const { app, db } = appWithDb();
  const { table, item } = await makeTableAndItem(app);
  const o1 = await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 1 }]);
  const o2 = await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 1 }]);
  // Force different created_at values
  db.prepare('UPDATE orders SET created_at = ? WHERE id = ?').run('2026-01-02 10:00:00', o2.order.id);
  db.prepare('UPDATE orders SET created_at = ? WHERE id = ?').run('2026-01-01 10:00:00', o1.order.id);

  const res = await request(app).get('/api/kitchen/orders');
  assert.equal(res.body[0].id, o1.order.id);
  assert.equal(res.body[1].id, o2.order.id);
  db.close();
});

test('kitchen orders includes preparing and ready', async () => {
  const { app, db } = appWithDb();
  const { table, item } = await makeTableAndItem(app);
  const o = await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 1 }]);
  db.prepare('UPDATE orders SET status = ? WHERE id = ?').run('preparing', o.order.id);

  const res = await request(app).get('/api/kitchen/orders');
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].status, 'preparing');
  db.close();
});

// ---------- PATCH /api/kitchen/orders/:id ----------

test('PATCH updates status from placed to preparing', async () => {
  const { app, db } = appWithDb();
  const { table, item } = await makeTableAndItem(app);
  const o = await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 1 }]);

  const res = await request(app)
    .patch(`/api/kitchen/orders/${o.order.id}`)
    .send({ status: 'preparing' });

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'preparing');
  assert.equal(res.body.items.length, 1);
  db.close();
});

test('PATCH can walk through preparing -> ready -> served', async () => {
  const { app, db } = appWithDb();
  const { table, item } = await makeTableAndItem(app);
  const o = await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 1 }]);

  for (const s of ['preparing', 'ready', 'served']) {
    const res = await request(app)
      .patch(`/api/kitchen/orders/${o.order.id}`)
      .send({ status: s });
    assert.equal(res.body.status, s);
  }
  db.close();
});

test('PATCH accepts cancelled', async () => {
  const { app, db } = appWithDb();
  const { table, item } = await makeTableAndItem(app);
  const o = await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 1 }]);

  const res = await request(app)
    .patch(`/api/kitchen/orders/${o.order.id}`)
    .send({ status: 'cancelled' });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'cancelled');
  db.close();
});

test('PATCH rejects unknown status with 400', async () => {
  const { app, db } = appWithDb();
  const { table, item } = await makeTableAndItem(app);
  const o = await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 1 }]);

  const res = await request(app)
    .patch(`/api/kitchen/orders/${o.order.id}`)
    .send({ status: 'bogus' });
  assert.equal(res.status, 400);
  db.close();
});

test('PATCH with empty body returns 400', async () => {
  const { app, db } = appWithDb();
  const { table, item } = await makeTableAndItem(app);
  const o = await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 1 }]);

  const res = await request(app).patch(`/api/kitchen/orders/${o.order.id}`).send({});
  assert.equal(res.status, 400);
  db.close();
});

test('PATCH updates notes without touching status', async () => {
  const { app, db } = appWithDb();
  const { table, item } = await makeTableAndItem(app);
  const o = await placeOrder(app, table.qr_token, [{ itemId: item.id, qty: 1 }]);

  const res = await request(app)
    .patch(`/api/kitchen/orders/${o.order.id}`)
    .send({ notes: 'No onions' });

  assert.equal(res.status, 200);
  assert.equal(res.body.notes, 'No onions');
  assert.equal(res.body.status, 'placed');
  db.close();
});

test('PATCH on unknown id returns 404', async () => {
  const { app, db } = appWithDb();
  const res = await request(app)
    .patch('/api/kitchen/orders/9999')
    .send({ status: 'preparing' });
  assert.equal(res.status, 404);
  db.close();
});
