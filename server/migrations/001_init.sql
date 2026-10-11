-- 001_init.sql
-- Bootstrap: a generic key/value settings table.
-- Domain tables (tables, menu_items, orders, ...) come in 002+.

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
