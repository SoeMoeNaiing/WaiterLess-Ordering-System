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

async function seedItem(app, cookie, { name = 'Noodles', price = 8 } = {}) {
  const cat = await request(app)
    .post('/api/admin/categories')
    .set('Cookie', cookie)
    .send({ name: `C-${Math.random()}` });
  const item = await request(app)
    .post('/api/admin/menu-items')
    .set('Cookie', cookie)
    .send({ name, price, category_id: cat.body.id });
  return item.body;
}

// ---------- GET ----------

test('GET options returns empty groups for a fresh item', async () => {
  const { app, db, cookie } = await appWithDb();
  const item = await seedItem(app, cookie);

  const res = await request(app)
    .get(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie);

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.groups, []);
  db.close();
});

test('GET options returns 404 for unknown item', async () => {
  const { app, db, cookie } = await appWithDb();
  const res = await request(app)
    .get('/api/admin/menu-items/9999/options')
    .set('Cookie', cookie);
  assert.equal(res.status, 404);
  db.close();
});

test('GET options requires auth', async () => {
  const { app, db } = await appWithDb();
  const res = await request(app).get('/api/admin/menu-items/1/options');
  assert.equal(res.status, 401);
  db.close();
});

// ---------- PUT: create ----------

test('PUT creates option groups and choices', async () => {
  const { app, db, cookie } = await appWithDb();
  const item = await seedItem(app, cookie);

  const payload = {
    groups: [
      {
        name: 'Spice Level',
        is_required: true,
        is_single_choice: true,
        sort_order: 0,
        choices: [
          { name: 'Mild', is_default: false, sort_order: 0 },
          { name: 'Medium', is_default: true, sort_order: 1 },
          { name: 'Hot', is_default: false, sort_order: 2 },
        ],
      },
      {
        name: 'Add-ons',
        is_required: false,
        is_single_choice: false,
        sort_order: 1,
        choices: [
          { name: 'Extra egg', is_default: false, sort_order: 0 },
          { name: 'Extra meat', is_default: false, sort_order: 1 },
        ],
      },
    ],
  };

  const res = await request(app)
    .put(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie)
    .send(payload);

  assert.equal(res.status, 200);
  assert.equal(res.body.groups.length, 2);
  assert.equal(res.body.groups[0].name, 'Spice Level');
  assert.equal(res.body.groups[0].choices.length, 3);
  assert.equal(res.body.groups[0].choices.find((c) => c.is_default === 1).name, 'Medium');
  assert.equal(res.body.groups[1].name, 'Add-ons');
  assert.equal(res.body.groups[1].choices.length, 2);
  db.close();
});

test('GET returns the created tree in order', async () => {
  const { app, db, cookie } = await appWithDb();
  const item = await seedItem(app, cookie);

  await request(app)
    .put(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie)
    .send({
      groups: [
        { name: 'Size', is_required: true, is_single_choice: true, choices: [
          { name: 'Regular', is_default: true },
          { name: 'Large', is_default: false },
        ]},
      ],
    });

  const res = await request(app)
    .get(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie);

  assert.equal(res.body.groups.length, 1);
  assert.equal(res.body.groups[0].name, 'Size');
  assert.deepEqual(res.body.groups[0].choices.map((c) => c.name), ['Regular', 'Large']);
  db.close();
});

// ---------- PUT: replace ----------

test('PUT replaces the entire tree (old groups + choices gone)', async () => {
  const { app, db, cookie } = await appWithDb();
  const item = await seedItem(app, cookie);

  await request(app)
    .put(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie)
    .send({
      groups: [{ name: 'Old', is_single_choice: true, choices: [{ name: 'X', is_default: true }] }],
    });

  const res = await request(app)
    .put(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie)
    .send({
      groups: [{ name: 'New', is_single_choice: true, choices: [{ name: 'Y', is_default: true }] }],
    });

  assert.equal(res.status, 200);
  assert.equal(res.body.groups.length, 1);
  assert.equal(res.body.groups[0].name, 'New');

  const oldGroups = db.prepare('SELECT * FROM menu_item_option_groups WHERE menu_item_id = ?').all(item.id);
  assert.equal(oldGroups.length, 1);
  assert.equal(oldGroups[0].name, 'New');
  db.close();
});

test('PUT with empty groups removes all options', async () => {
  const { app, db, cookie } = await appWithDb();
  const item = await seedItem(app, cookie);

  await request(app)
    .put(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie)
    .send({ groups: [{ name: 'X', is_single_choice: true, choices: [{ name: 'A', is_default: true }] }] });

  const res = await request(app)
    .put(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie)
    .send({ groups: [] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.groups, []);
  db.close();
});

// ---------- PUT: validation ----------

test('PUT rejects missing group name', async () => {
  const { app, db, cookie } = await appWithDb();
  const item = await seedItem(app, cookie);
  const res = await request(app)
    .put(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie)
    .send({ groups: [{ choices: [{ name: 'A', is_default: true }] }] });
  assert.equal(res.status, 400);
  db.close();
});

test('PUT rejects empty choices array', async () => {
  const { app, db, cookie } = await appWithDb();
  const item = await seedItem(app, cookie);
  const res = await request(app)
    .put(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie)
    .send({ groups: [{ name: 'Size', choices: [] }] });
  assert.equal(res.status, 400);
  db.close();
});

test('PUT rejects required single-choice group without a default', async () => {
  const { app, db, cookie } = await appWithDb();
  const item = await seedItem(app, cookie);
  const res = await request(app)
    .put(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie)
    .send({
      groups: [{
        name: 'Size',
        is_required: true,
        is_single_choice: true,
        choices: [{ name: 'Small', is_default: false }, { name: 'Large', is_default: false }],
      }],
    });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /exactly one default/);
  db.close();
});

test('PUT rejects multiple defaults in single-choice group', async () => {
  const { app, db, cookie } = await appWithDb();
  const item = await seedItem(app, cookie);
  const res = await request(app)
    .put(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie)
    .send({
      groups: [{
        name: 'Size',
        is_single_choice: true,
        choices: [{ name: 'Small', is_default: true }, { name: 'Large', is_default: true }],
      }],
    });
  assert.equal(res.status, 400);
  db.close();
});

test('PUT rejects unknown item', async () => {
  const { app, db, cookie } = await appWithDb();
  const res = await request(app)
    .put('/api/admin/menu-items/9999/options')
    .set('Cookie', cookie)
    .send({ groups: [] });
  assert.equal(res.status, 404);
  db.close();
});

// ---------- Cascades ----------

test('deleting a menu item cascades its option groups + choices', async () => {
  const { app, db, cookie } = await appWithDb();
  const item = await seedItem(app, cookie);

  await request(app)
    .put(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie)
    .send({
      groups: [{ name: 'Size', is_single_choice: true, choices: [{ name: 'S', is_default: true }] }],
    });

  await request(app)
    .delete(`/api/admin/menu-items/${item.id}`)
    .set('Cookie', cookie);

  const groups = db.prepare('SELECT * FROM menu_item_option_groups WHERE menu_item_id = ?').all(item.id);
  const choices = db.prepare('SELECT * FROM menu_item_option_choices').all();
  assert.equal(groups.length, 0);
  assert.equal(choices.length, 0);
  db.close();
});

test('replacing groups cascades old choices away', async () => {
  const { app, db, cookie } = await appWithDb();
  const item = await seedItem(app, cookie);

  await request(app)
    .put(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie)
    .send({
      groups: [{ name: 'G1', is_single_choice: true, choices: [{ name: 'A', is_default: true }] }],
    });

  await request(app)
    .put(`/api/admin/menu-items/${item.id}/options`)
    .set('Cookie', cookie)
    .send({
      groups: [{ name: 'G2', is_single_choice: true, choices: [{ name: 'B', is_default: true }] }],
    });

  const allChoices = db.prepare('SELECT * FROM menu_item_option_choices').all();
  assert.equal(allChoices.length, 1);
  assert.equal(allChoices[0].name, 'B');
  db.close();
});
