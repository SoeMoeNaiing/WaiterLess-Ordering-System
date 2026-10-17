#!/usr/bin/env node
import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { resolve, join } from 'node:path';

const DB_PATH = resolve(process.env.DB_PATH || './data/restaurant.db');
const BACKUP_DIR = resolve(process.env.BACKUP_DIR || './data/backups');
const KEEP_DAYS = Number(process.env.KEEP_DAYS) || 7;

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

async function main() {
  mkdirSync(BACKUP_DIR, { recursive: true });

  const filename = `restaurant_${timestamp()}.db`;
  const target = join(BACKUP_DIR, filename);

  console.log(`[backup] source: ${DB_PATH}`);
  console.log(`[backup] target: ${target}`);

  const db = new Database(DB_PATH, { readonly: true });

  try {
    await db.backup(target);
    const size = statSync(target).size;
    console.log(`[backup] done. ${(size / 1024).toFixed(1)} KB written.`);
  } finally {
    db.close();
  }

  // Prune old backups
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  let pruned = 0;
  for (const file of readdirSync(BACKUP_DIR)) {
    if (!file.startsWith('restaurant_') || !file.endsWith('.db')) continue;
    const full = join(BACKUP_DIR, file);
    const mtime = statSync(full).mtimeMs;
    if (mtime < cutoff) {
      unlinkSync(full);
      pruned++;
    }
  }
  if (pruned > 0) console.log(`[backup] pruned ${pruned} old backup(s).`);
}

main().catch((err) => {
  console.error('[backup] FAILED:', err.message);
  process.exit(1);
});
