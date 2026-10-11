-- 004_orders.sql
-- Orders and their line items.
-- Items store name/price SNAPSHOTS so history is immutable.

CREATE TABLE orders (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  table_id    INTEGER NOT NULL REFERENCES tables(id) ON DELETE RESTRICT,
  status      TEXT NOT NULL DEFAULT 'placed'
                CHECK (status IN ('placed','preparing','ready','served','cancelled')),
  total       REAL NOT NULL CHECK (total >= 0),
  notes       TEXT,
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE order_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id    INTEGER REFERENCES menu_items(id) ON DELETE SET NULL,
  name_snapshot   TEXT NOT NULL,
  price_snapshot  REAL NOT NULL CHECK (price_snapshot >= 0),
  qty             INTEGER NOT NULL CHECK (qty > 0),
  notes           TEXT,
  created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_orders_table    ON orders(table_id);
CREATE INDEX idx_orders_status   ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);
