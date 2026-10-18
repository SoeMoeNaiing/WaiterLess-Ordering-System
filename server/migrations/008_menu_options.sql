-- 008_menu_options.sql
-- Per-item customization: "Spice Level", "Size", "Add-ons" etc.
-- All choices are free (no price modifiers) — base price is the only price.

CREATE TABLE menu_item_option_groups (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  menu_item_id      INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
  name              TEXT    NOT NULL,
  is_required       INTEGER NOT NULL DEFAULT 0,
  is_single_choice  INTEGER NOT NULL DEFAULT 1,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_option_groups_item ON menu_item_option_groups(menu_item_id);

CREATE TABLE menu_item_option_choices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id    INTEGER NOT NULL REFERENCES menu_item_option_groups(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  is_default  INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_option_choices_group ON menu_item_option_choices(group_id);

-- Snapshot of what the customer picked — survives menu edits and deletes.
CREATE TABLE order_item_options (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  order_item_id          INTEGER NOT NULL REFERENCES order_items(id) ON DELETE CASCADE,
  group_name_snapshot    TEXT    NOT NULL,
  choice_name_snapshot   TEXT    NOT NULL,
  created_at             TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_item_options ON order_item_options(order_item_id);
