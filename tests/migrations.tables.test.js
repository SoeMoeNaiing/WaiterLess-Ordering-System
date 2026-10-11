import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDb } from '../server/db.js';

const fresh = () => createDb(':memory:', { quiet: true });

test('002_tables migration is recorded', () => {
  const db = fresh();
  const row = db.prepare('SELECT name FROM _migrations WHERE name = ?').get('002_tables.sql');
  assert.ok(row, '002_tables.sql should be recorded');
  db.close();
});

test('tables table has expected columns', () => {
  const db = fresh();
  const cols = db.prepare("PRAGMA table_info('tables')").all().map((c) => c.name);
  for (const name of ['id', 'table_number', 'label', 'qr_token', 'is_active', 'created_at']) {
    assert.ok(cols.includes(name), `expected column ${name}`);
  }
  db.close();
});

test('can insert a table and read it back with defaults', () => {
  const db = fresh();
  db.prepare('INSERT INTO tables (table_number, label, qr_token) VALUES (?, ?, ?)')
    .run('T1', 'Window seat', 'abc123XYZ789');
  const row = db.prepare('SELECT * FROM tables WHERE table_number = ?').get('T1');
  assert.equal(row.table_number, 'T1');
  assert.equal(row.label, 'Window seat');
  assert.equal(row.qr_token, 'abc123XYZ789');
  assert.equal(row.is_active, 1);
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}/);
  db.close();
});

test('table_number is unique', () => {
  const db = fresh();
  db.prepare('INSERT INTO tables (table_number, qr_token) VALUES (?, ?)').run('T1', 'tok1');
  assert.throws(() =>
    db.prepare('INSERT INTO tables (table_number, qr_token) VALUES (?, ?)').run('T1', 'tok2')
  );
  db.close();
});

test('qr_token is unique', () => {
  const db = fresh();
  db.prepare('INSERT INTO tables (table_number, qr_token) VALUES (?, ?)').run('T1', 'same');
  assert.throws(() =>
    db.prepare('INSERT INTO tables (table_number, qr_token) VALUES (?, ?)').run('T2', 'same')
  );
  db.close();
});

test('qr_token cannot be null', () => {
  const db = fresh();
  assert.throws(() =>
    db.prepare('INSERT INTO tables (table_number, qr_token) VALUES (?, ?)').run('T1', null)
  );
  db.close();
});
