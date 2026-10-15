-- 006_order_session.sql
-- Nullable "session_ended_at" on orders. When set, the order is hidden
-- from the customer's "your orders" view but kept in DB for reports.

ALTER TABLE orders ADD COLUMN session_ended_at TEXT;
