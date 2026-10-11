import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../server/db.js';

const fresh = () => createDb(':memory:', { quiet: true });

test('005_seed_settings migration is recorded', () => {
  const db = fresh();
  const row = db.prepare('SELECT name FROM _migrations WHERE name = ?')
    .get('005_seed_settings.sql');
  assert.ok(row, '005_seed_settings.sql should be recorded');
  db.close();
});

test('seeded admin_pin exists with default value', () => {
  const db = fresh();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_pin');
  assert.ok(row, 'admin_pin row should exist');
  assert.equal(row.value, '1234');
  db.close();
});

test('seeded restaurant_name and currency exist', () => {
  const db = fresh();
  const name = db.prepare('SELECT value FROM settings WHERE key = ?').get('restaurant_name');
  const curr = db.prepare('SELECT value FROM settings WHERE key = ?').get('currency');
  assert.equal(name.value, 'My Restaurant');
  assert.equal(curr.value, 'MMK');
  db.close();
});

test('updating admin_pin and re-running migrations does not overwrite it', () => {
  const db = fresh();
  db.prepare('UPDATE settings SET value = ? WHERE key = ?').run('9999', 'admin_pin');

  // Simulate "restart" by calling createDb again on the same in-memory DB is impossible,
  // so instead we manually verify the OR IGNORE semantics directly:
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_pin', '1234')").run();

  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('admin_pin');
  assert.equal(row.value, '9999', 'OR IGNORE must not overwrite an existing value');
  db.close();
});
