import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../server/db.js';

const fresh = () => createDb(':memory:', { quiet: true });

test('003_menu migration is recorded', () => {
  const db = fresh();
  const row = db.prepare('SELECT name FROM _migrations WHERE name = ?').get('003_menu.sql');
  assert.ok(row, '003_menu.sql should be recorded');
  db.close();
});

test('categories table has expected columns', () => {
  const db = fresh();
  const cols = db.prepare("PRAGMA table_info('categories')").all().map((c) => c.name);
  for (const name of ['id', 'name', 'sort_order', 'is_active', 'created_at']) {
    assert.ok(cols.includes(name), `expected categories.${name}`);
  }
  db.close();
});

test('menu_items table has expected columns', () => {
  const db = fresh();
  const cols = db.prepare("PRAGMA table_info('menu_items')").all().map((c) => c.name);
  for (const name of [
    'id', 'category_id', 'name', 'description', 'price',
    'image_path', 'is_available', 'is_active', 'sort_order', 'created_at',
  ]) {
    assert.ok(cols.includes(name), `expected menu_items.${name}`);
  }
  db.close();
});

test('category name is unique', () => {
  const db = fresh();
  db.prepare('INSERT INTO categories (name) VALUES (?)').run('Starters');
  assert.throws(() => {
    db.prepare('INSERT INTO categories (name) VALUES (?)').run('Starters');
  });
  db.close();
});

test('menu_item can be created in a category and read back', () => {
  const db = fresh();
  db.prepare('INSERT INTO categories (name) VALUES (?)').run('Starters');
  const catId = db.prepare('SELECT id FROM categories WHERE name = ?').get('Starters').id;

  db.prepare(
    'INSERT INTO menu_items (category_id, name, description, price) VALUES (?, ?, ?, ?)'
  ).run(catId, 'Spring Rolls', 'Crispy veggie rolls', 4.5);

  const row = db.prepare('SELECT * FROM menu_items WHERE name = ?').get('Spring Rolls');
  assert.equal(row.category_id, catId);
  assert.equal(row.price, 4.5);
  assert.equal(row.is_available, 1);
  assert.equal(row.is_active, 1);
  db.close();
});

test('price must be >= 0', () => {
  const db = fresh();
  assert.throws(() => {
    db.prepare('INSERT INTO menu_items (name, price) VALUES (?, ?)').run('Free', -1);
  });
  db.close();
});

test('deleting a category sets its items category_id to NULL (no cascade)', () => {
  const db = fresh();
  db.prepare('INSERT INTO categories (name) VALUES (?)').run('Drinks');
  const catId = db.prepare('SELECT id FROM categories WHERE name = ?').get('Drinks').id;

  db.prepare('INSERT INTO menu_items (category_id, name, price) VALUES (?, ?, ?)')
    .run(catId, 'Cola', 2.0);

  db.prepare('DELETE FROM categories WHERE id = ?').run(catId);

  const row = db.prepare('SELECT * FROM menu_items WHERE name = ?').get('Cola');
  assert.ok(row, 'menu item should survive category deletion');
  assert.equal(row.category_id, null);
  db.close();
});
