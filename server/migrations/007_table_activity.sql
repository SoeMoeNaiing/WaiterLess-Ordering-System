-- 007_table_activity.sql
-- Tracks the last time a customer placed an order at a table.
-- Used by the customer-side "table busy" soft gate (iteration 11.2).

ALTER TABLE tables ADD COLUMN last_activity_at TEXT;
