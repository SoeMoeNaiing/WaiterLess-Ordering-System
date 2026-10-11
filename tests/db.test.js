import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb } from '../server/db.js';

test('createDb creates the _migrations bookkeeping table', () => {
  const db = createDb(':memory:', { quiet: true });
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='_migrations'")
    .get();
  assert.ok(row, '_migrations table should exist');
  db.close();
});

test('001_init migration is recorded and creates settings', () => {
  const db = createDb(':memory:', { quiet: true });

  const recorded = db
    .prepare('SELECT name FROM _migrations WHERE name = ?')
    .get('001_init.sql');
  assert.ok(recorded, '001_init.sql should be recorded');

  const settings = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='settings'")
    .get();
  assert.ok(settings, 'settings table should exist');
  db.close();
});

test('settings table is usable (insert + read)', () => {
  const db = createDb(':memory:', { quiet: true });
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('k', 'v');
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('k');
  assert.equal(row.value, 'v');
  db.close();
});

test('foreign_keys pragma is ON', () => {
  const db = createDb(':memory:', { quiet: true });
  const row = db.pragma('foreign_keys', { simple: true });
  assert.equal(row, 1);
  db.close();
});

test('re-opening the same DB does not re-apply migrations (idempotent)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'restaurant-db-test-'));
  const path = join(dir, 'test.db');
  try {
    const db1 = createDb(path, { quiet: true });
    db1.close();

    const db2 = createDb(path, { quiet: true });
    const count = db2
      .prepare('SELECT COUNT(*) AS c FROM _migrations')
      .get().c;
    assert.equal(count, 1, 'should not re-apply 001_init.sql');
    db2.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
