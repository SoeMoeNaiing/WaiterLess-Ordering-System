-- 005_seed_settings.sql
-- Seed default values into settings.
-- INSERT OR IGNORE keeps this idempotent: if the key already exists,
-- we don't overwrite the operator's chosen value.

INSERT OR IGNORE INTO settings (key, value) VALUES
  ('admin_pin', '1234'),
  ('restaurant_name', 'My Restaurant'),
  ('currency', 'MMK');
