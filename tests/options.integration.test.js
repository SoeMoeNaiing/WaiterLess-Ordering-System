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

async function seedTable(app, cookie, num = 'T1') {
  const t = await request(app).post('/api/admin/tables').set('Cookie', cookie).send({ table_number: num });
  return t.body;
}

async function seedItemWithOptions(app, cookie) {
  const cat = await request(app).post('/api/admin/categories').set('Cookie', cookie).send({ name: 'C' });
  const item = await request(app).post('/api/admin/menu-items').set('Cookie', cookie)
    .send({ name: 'Noodles', price: 8, category_id: cat.body.id });

  const opts = await request(app)
    .put(`/api/admin/menu-items/${item.body.id}/options`)
    .set('Cookie', cookie)
    .send({
      groups: [
        {
          name: 'Spice Level', is_required: true, is_single_choice: true,
          choices: [
            { name: 'Mild', is_default: false },
            { name: 'Medium', is_default: true },
            { name: 'Hot', is_default: false },
          ],
        },
        {
          name: 'Add-ons', is_required: false, is_single_choice: false,
          choices: [
            { name: 'Extra egg', is_default: false },
            { name: 'Extra meat', is_default: false },
          ],
        },
      ],
    });

  const groups = opts.body.groups;
  return {
    item: item.body,
    spice: groups[0],
    addons: groups[1],
    mediumChoice: groups[0].choices.find((c) => c.name === 'Medium'),
    hotChoice: groups[0].choices.find((c) => c.name === 'Hot'),
    mildChoice: groups[0].choices.find((c) => c.name === 'Mild'),
    eggChoice: groups[1].choices.find((c) => c.name === 'Extra egg'),
    meatChoice: groups[1].choices.find((c) => c.name === 'Extra meat'),
  };
}

// ---------- Menu GET returns options ----------

test('menu GET includes option_groups per item', async () => {
  const { app, cookie, db } = await appWithDb();
  const t = await seedTable(app, cookie);
  const { item, spice } = await seedItemWithOptions(app, cookie);

  const res = await request(app).get(`/api/customer/menu?token=${t.qr_token}`);
  assert.equal(res.status, 200);
  const cat = res.body.categories[0];
  const found = cat.items.find((it) => it.id === item.id);
  assert.ok(found);
  assert.equal(found.option_groups.length, 2);
  assert.equal(found.option_groups[0].id, spice.id);
  assert.equal(found.option_groups[0].is_required, 1);
  assert.equal(found.option_groups[0].choices.length, 3);
  db.close();
});

test('menu GET returns empty option_groups for plain items', async () => {
  const { app, cookie, db } = await appWithDb();
  const t = await seedTable(app, cookie);
  const cat = await request(app).post('/api/admin/categories').set('Cookie', cookie).send({ name: 'C' });
  await request(app).post('/api/admin/menu-items').set('Cookie', cookie)
    .send({ name: 'Water', price: 1, category_id: cat.body.id });

  const res = await request(app).get(`/api/customer/menu?token=${t.qr_token}`);
  const it = res.body.categories[0].items.find((x) => x.name === 'Water');
  assert.deepEqual(it.option_groups, []);
  db.close();
});

// ---------- Order submit validates selections ----------

test('order submit accepts valid selections and snapshots them', async () => {
  const { app, cookie, db } = await appWithDb();
  const t = await seedTable(app, cookie);
  const { item, spice, mediumChoice, addons, eggChoice } = await seedItemWithOptions(app, cookie);

  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{
      itemId: item.id, qty: 1,
      selections: [
        { group_id: spice.id, choice_id: mediumChoice.id },
        { group_id: addons.id, choice_id: eggChoice.id },
      ],
    }],
  });

  assert.equal(res.status, 201);
  const rows = db.prepare('SELECT * FROM order_item_options WHERE order_item_id = ?').all(res.body.items[0].id);
  assert.equal(rows.length, 2);
  const names = rows.map((r) => `${r.group_name_snapshot}:${r.choice_name_snapshot}`).sort();
  assert.deepEqual(names, ['Add-ons:Extra egg', 'Spice Level:Medium']);
  db.close();
});

test('order submit rejects missing required group', async () => {
  const { app, cookie, db } = await appWithDb();
  const t = await seedTable(app, cookie);
  const { item } = await seedItemWithOptions(app, cookie);

  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{ itemId: item.id, qty: 1, selections: [] }],
  });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /required/);
  db.close();
});

test('order submit rejects choice from wrong group', async () => {
  const { app, cookie, db } = await appWithDb();
  const t = await seedTable(app, cookie);
  const { item, spice, eggChoice } = await seedItemWithOptions(app, cookie);

  // eggChoice is in Add-ons, not Spice Level
  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{
      itemId: item.id, qty: 1,
      selections: [{ group_id: spice.id, choice_id: eggChoice.id }],
    }],
  });

  assert.equal(res.status, 400);
  db.close();
});

test('order submit rejects multiple picks in single-choice group', async () => {
  const { app, cookie, db } = await appWithDb();
  const t = await seedTable(app, cookie);
  const { item, spice, mediumChoice, hotChoice } = await seedItemWithOptions(app, cookie);

  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{
      itemId: item.id, qty: 1,
      selections: [
        { group_id: spice.id, choice_id: mediumChoice.id },
        { group_id: spice.id, choice_id: hotChoice.id },
      ],
    }],
  });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /only one choice/);
  db.close();
});

test('order submit rejects duplicate (group, choice)', async () => {
  const { app, cookie, db } = await appWithDb();
  const t = await seedTable(app, cookie);
  const { item, addons, eggChoice } = await seedItemWithOptions(app, cookie);
  const { spice, mediumChoice } = await seedItemWithOptions(app, cookie);

  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{
      itemId: item.id, qty: 1,
      selections: [
        { group_id: spice.id, choice_id: mediumChoice.id },
        { group_id: addons.id, choice_id: eggChoice.id },
        { group_id: addons.id, choice_id: eggChoice.id },
      ],
    }],
  });

  assert.equal(res.status, 400);
  db.close();
});

test('order submit rejects unknown group_id', async () => {
  const { app, cookie, db } = await appWithDb();
  const t = await seedTable(app, cookie);
  const { item, mediumChoice } = await seedItemWithOptions(app, cookie);

  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{
      itemId: item.id, qty: 1,
      selections: [{ group_id: 9999, choice_id: mediumChoice.id }],
    }],
  });

  assert.equal(res.status, 400);
  db.close();
});

test('order submit allows multiple picks in multi-choice group', async () => {
  const { app, cookie, db } = await appWithDb();
  const t = await seedTable(app, cookie);
  const { item, spice, mediumChoice, addons, eggChoice, meatChoice } = await seedItemWithOptions(app, cookie);

  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{
      itemId: item.id, qty: 1,
      selections: [
        { group_id: spice.id, choice_id: mediumChoice.id },
        { group_id: addons.id, choice_id: eggChoice.id },
        { group_id: addons.id, choice_id: meatChoice.id },
      ],
    }],
  });

  assert.equal(res.status, 201);
  const rows = db.prepare('SELECT * FROM order_item_options WHERE order_item_id = ?').all(res.body.items[0].id);
  assert.equal(rows.length, 3);
  db.close();
});

test('order submit allows optional groups to be skipped', async () => {
  const { app, cookie, db } = await appWithDb();
  const t = await seedTable(app, cookie);
  const { item, spice, mediumChoice } = await seedItemWithOptions(app, cookie);

  const res = await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{
      itemId: item.id, qty: 1,
      selections: [{ group_id: spice.id, choice_id: mediumChoice.id }],
    }],
  });

  assert.equal(res.status, 201);
  const rows = db.prepare('SELECT * FROM order_item_options WHERE order_item_id = ?').all(res.body.items[0].id);
  assert.equal(rows.length, 1);
  db.close();
});

// ---------- Kitchen API returns options ----------

test('kitchen GET returns per-item options', async () => {
  const { app, cookie, db } = await appWithDb();
  const t = await seedTable(app, cookie);
  const { item, spice, mediumChoice, addons, eggChoice } = await seedItemWithOptions(app, cookie);

  await request(app).post('/api/customer/orders').send({
    token: t.qr_token,
    items: [{
      itemId: item.id, qty: 1,
      selections: [
        { group_id: spice.id, choice_id: mediumChoice.id },
        { group_id: addons.id, choice_id: eggChoice.id },
      ],
    }],
  });

  const res = await request(app).get('/api/kitchen/orders').set('Cookie', cookie);
  assert.equal(res.status, 200);
  const order = res.body[0];
  assert.equal(order.items[0].options.length, 2);
  const names = order.items[0].options.map((o) => `${o.group_name_snapshot}:${o.choice_name_snapshot}`).sort();
  assert.deepEqual(names, ['Add-ons:Extra egg', 'Spice Level:Medium']);
  db.close();
});
