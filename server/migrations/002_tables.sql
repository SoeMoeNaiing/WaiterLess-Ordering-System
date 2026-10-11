-- 002_tables.sql
-- Physical tables in the restaurant. Each has a unique QR token
-- that appears in the customer URL: /t/:token

CREATE TABLE tables (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  table_number  TEXT NOT NULL UNIQUE,
  label         TEXT,
  qr_token      TEXT NOT NULL UNIQUE,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
