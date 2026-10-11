import Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations');

/**
 * Open (or create) a SQLite database at `path` and run all pending
 * migrations from server/migrations/ in filename order.
 *
 * Options:
 *   quiet: if true, suppress migration log lines (useful in tests)
 *
 * Pass ':memory:' for tests.
 */
export function createDb(path = ':memory:', { quiet = false } = {}) {
  const db = new Database(path);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  ensureMigrationsTable(db);
  runMigrations(db, { quiet });
  return db;
}

function ensureMigrationsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      name       TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}

function runMigrations(db, { quiet }) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    db.prepare('SELECT name FROM _migrations').all().map((r) => r.name)
  );

  const record = db.prepare('INSERT INTO _migrations (name) VALUES (?)');

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');

    const apply = db.transaction(() => {
      db.exec(sql);
      record.run(file);
    });

    apply();
    if (!quiet) console.log(`[db] applied migration ${file}`);
  }
}
