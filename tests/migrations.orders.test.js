import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../server/db.js';

const fresh = () => createDb(':memory:', { quiet: true });

function seedTableAndItem(db, { itemPrice = 4.5, itemName = 'Spring Rolls' } = {}) {
  db.prepare('INSERT INTO tables (table_number, qr_token) VALUES (?, ?)').run('T1', 'tok-t1');
  const tableId = db.prepare('SELECT id FROM tables WHERE table_number = ?').get('T1').id;

  db.prepare('INSERT INTO categories (name) VALUES (?)').run('Starters');
  const catId = db.prepare('SELECT id FROM categories WHERE name = ?').get('Starters').id;

  db.prepare('INSERT INTO menu_items (category_id, name, price) VALUES (?, ?, ?)')
    .run(catId, itemName, itemPrice);
  const itemId = db.prepare('SELECT id FROM menu_items WHERE name = ?').get(itemName).id;

  return { tableId, itemId };
}

test('004_orders migration is recorded', () => {
  const db = fresh();
  const row = db.prepare('SELECT name FROM _migrations WHERE name = ?').get('004_orders.sql');
  assert.ok(row, '004_orders.sql should be recorded');
  db.close();
});

test('orders table has expected columns', () => {
  const db = fresh();
  const cols = db.prepare("PRAGMA table_info('orders')").all().map((c) => c.name);
  for (const name of ['id', 'table_id', 'status', 'total', 'notes', 'created_at', 'updated_at']) {
    assert.ok(cols.includes(name), `expected orders.${name}`);
  }
  db.close();
});

test('order_items table has expected columns', () => {
  const db = fresh();
  const cols = db.prepare("PRAGMA table_info('order_items')").all().map((c) => c.name);
  for (const name of [
    'id', 'order_id', 'menu_item_id', 'name_snapshot',
    'price_snapshot', 'qty', 'notes', 'created_at',
  ]) {
    assert.ok(cols.includes(name), `expected order_items.${name}`);
  }
  db.close();
});

test('can create an order with items and read it back', () => {
  const db = fresh();
  const { tableId, itemId } = seedTableAndItem(db);

  const r = db.prepare('INSERT INTO orders (table_id, total) VALUES (?, ?)').run(tableId, 9.0);
  const orderId = r.lastInsertRowid;

  db.prepare(
    `INSERT INTO order_items (order_id, menu_item_id, name_snapshot, price_snapshot, qty)
     VALUES (?, ?, ?, ?, ?)`
  ).run(orderId, itemId, 'Spring Rolls', 4.5, 2);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  assert.equal(order.status, 'placed');
  assert.equal(order.total, 9.0);

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  assert.equal(items.length, 1);
  assert.equal(items[0].name_snapshot, 'Spring Rolls');
  assert.equal(items[0].price_snapshot, 4.5);
  assert.equal(items[0].qty, 2);
  db.close();
});

test('order status must be one of the allowed values', () => {
  const db = fresh();
  const { tableId } = seedTableAndItem(db);
  assert.throws(() => {
    db.prepare('INSERT INTO orders (table_id, total, status) VALUES (?, ?, ?)')
      .run(tableId, 1.0, 'bogus');
  });
  db.close();
});

test('qty must be > 0', () => {
  const db = fresh();
  const { tableId, itemId } = seedTableAndItem(db);
  const orderId = db.prepare('INSERT INTO orders (table_id, total) VALUES (?, ?)')
    .run(tableId, 0).lastInsertRowid;
  assert.throws(() => {
    db.prepare(
      `INSERT INTO order_items (order_id, menu_item_id, name_snapshot, price_snapshot, qty)
       VALUES (?, ?, ?, ?, ?)`
    ).run(orderId, itemId, 'X', 1.0, 0);
  });
  db.close();
});

test('deleting an order cascades to its order_items', () => {
  const db = fresh();
  const { tableId, itemId } = seedTableAndItem(db);
  const orderId = db.prepare('INSERT INTO orders (table_id, total) VALUES (?, ?)')
    .run(tableId, 4.5).lastInsertRowid;
  db.prepare(
    `INSERT INTO order_items (order_id, menu_item_id, name_snapshot, price_snapshot, qty)
     VALUES (?, ?, ?, ?, ?)`
  ).run(orderId, itemId, 'Spring Rolls', 4.5, 1);

  db.prepare('DELETE FROM orders WHERE id = ?').run(orderId);

  const items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  assert.equal(items.length, 0);
  db.close();
});

test('deleting a menu_item keeps the order item (menu_item_id -> NULL)', () => {
  const db = fresh();
  const { tableId, itemId } = seedTableAndItem(db);
  const orderId = db.prepare('INSERT INTO orders (table_id, total) VALUES (?, ?)')
    .run(tableId, 4.5).lastInsertRowid;
  db.prepare(
    `INSERT INTO order_items (order_id, menu_item_id, name_snapshot, price_snapshot, qty)
     VALUES (?, ?, ?, ?, ?)`
  ).run(orderId, itemId, 'Spring Rolls', 4.5, 1);

  db.prepare('DELETE FROM menu_items WHERE id = ?').run(itemId);

  const item = db.prepare('SELECT * FROM order_items WHERE order_id = ?').get(orderId);
  assert.ok(item, 'order item should survive');
  assert.equal(item.menu_item_id, null);
  assert.equal(item.name_snapshot, 'Spring Rolls');
  assert.equal(item.price_snapshot, 4.5);
  db.close();
});

test('cannot delete a table that has orders (RESTRICT)', () => {
  const db = fresh();
  const { tableId } = seedTableAndItem(db);
  db.prepare('INSERT INTO orders (table_id, total) VALUES (?, ?)').run(tableId, 1.0);

  assert.throws(() => {
    db.prepare('DELETE FROM tables WHERE id = ?').run(tableId);
  });
  db.close();
});

test('order history keeps the original price after a menu price change', () => {
  const db = fresh();
  const { tableId, itemId } = seedTableAndItem(db, { itemPrice: 4.5 });
  const orderId = db.prepare('INSERT INTO orders (table_id, total) VALUES (?, ?)')
    .run(tableId, 4.5).lastInsertRowid;
  db.prepare(
    `INSERT INTO order_items (order_id, menu_item_id, name_snapshot, price_snapshot, qty)
     VALUES (?, ?, ?, ?, ?)`
  ).run(orderId, itemId, 'Spring Rolls', 4.5, 1);

  // Raise the price
  db.prepare('UPDATE menu_items SET price = ? WHERE id = ?').run(6.0, itemId);

  const item = db.prepare('SELECT * FROM order_items WHERE order_id = ?').get(orderId);
  assert.equal(item.price_snapshot, 4.5, 'snapshot must not follow menu price changes');
  db.close();
});
