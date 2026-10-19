import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';
import { loginAdmin } from './helpers/auth.js';

async function appWithDb() {
  const db = createDb(':memory:', { quiet: true });
  const app = createApp({ db });
  const cookie = await loginAdmin(app);
  return { app, db, cookie };
}

async function seedTableAndItem(app, cookie) {
  const t = await request(app).post('/api/admin/tables').set('Cookie', cookie).send({ table_number: 'T1' });
  const cat = await request(app).post('/api/admin/categories').set('Cookie', cookie).send({ name: 'C' });
  const item = await request(app).post('/api/admin/menu-items').set('Cookie', cookie)
    .send({ name: 'Noodles', price: 8, category_id: cat.body.id });

  const opts = await request(app)
    .put(`/api/admin/menu-items/${item.body.id}/options`)
    .set('Cookie', cookie)
    .send({
      groups: [{
        name: 'Spice', is_required: true, is_single_choice: true,
        choices: [
          { name: 'Mild', is_default: false },
          { name: 'Hot', is_default: true },
        ],
      }],
    });

  return {
    table: t.body,
    item: item.body,
    hotChoice: opts.body.groups[0].choices.find((c) => c.name === 'Hot'),
    group: opts.body.groups[0],
  };
}

test('GET /api/admin/orders includes per-item options', async () => {
  const { app, cookie, db } = await appWithDb();
  const { table, item, group, hotChoice } = await seedTableAndItem(app, cookie);

  await request(app).post('/api/customer/orders').send({
    token: table.qr_token,
    items: [{
      itemId: item.id, qty: 1,
      selections: [{ group_id: group.id, choice_id: hotChoice.id }],
    }],
  });

  const res = await request(app).get('/api/admin/orders').set('Cookie', cookie);
  assert.equal(res.status, 200);
  assert.equal(res.body.orders.length, 1);
  const oi = res.body.orders[0].items[0];
  assert.equal(oi.name_snapshot, 'Noodles');
  assert.equal(oi.options.length, 1);
  assert.equal(oi.options[0].group_name_snapshot, 'Spice');
  assert.equal(oi.options[0].choice_name_snapshot, 'Hot');
  db.close();
});

test('GET /api/admin/orders includes per-item notes', async () => {
  const { app, cookie, db } = await appWithDb();
  const { table, item, group, hotChoice } = await seedTableAndItem(app, cookie);

  await request(app).post('/api/customer/orders').send({
    token: table.qr_token,
    items: [{
      itemId: item.id, qty: 1, notes: 'no MSG',
      selections: [{ group_id: group.id, choice_id: hotChoice.id }],
    }],
  });

  const res = await request(app).get('/api/admin/orders').set('Cookie', cookie);
  assert.equal(res.body.orders[0].items[0].notes, 'no MSG');
  db.close();
});

test('GET /api/customer/orders/:id includes per-item options', async () => {
  const { app, cookie, db } = await appWithDb();
  const { table, item, group, hotChoice } = await seedTableAndItem(app, cookie);

  const placed = await request(app).post('/api/customer/orders').send({
    token: table.qr_token,
    items: [{
      itemId: item.id, qty: 1,
      selections: [{ group_id: group.id, choice_id: hotChoice.id }],
    }],
  });

  const res = await request(app)
    .get(`/api/customer/orders/${placed.body.order.id}?token=${table.qr_token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.items[0].options.length, 1);
  assert.equal(res.body.items[0].options[0].choice_name_snapshot, 'Hot');
  db.close();
});
