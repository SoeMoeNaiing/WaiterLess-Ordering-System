import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const read = (...parts) => readFileSync(join(ROOT, ...parts), 'utf8');

test('customer cart toast has styling', () => {
  const css = read('customer', 'index.html');
  assert.match(css, /\.cart-toast\s*\{/);
  assert.match(css, /\.cart-toast\.show\s*\{/);
});

test('kitchen action buttons have styling', () => {
  const css = read('kitchen', 'index.html');
  assert.match(css, /\.btn-confirm\s*\{/);
  assert.match(css, /\.btn-serve\s*\{/);
});

test('status page has no dead language-switcher wiring', () => {
  const js = read('customer', 'status.js');
  assert.doesNotMatch(js, /lang-select/);
  assert.doesNotMatch(js, /\bsetLang\b/);
});

test('rate-limit message is localized and uses retry_after', () => {
  const js = read('customer', 'menu.js');
  assert.match(js, /customer\.too_many_orders/);
  assert.match(js, /retry_after/);

  const en = JSON.parse(read('i18n', 'en.json'));
  const my = JSON.parse(read('i18n', 'my.json'));
  assert.match(en['customer.too_many_orders'], /\{seconds\}/);
  assert.match(my['customer.too_many_orders'], /\{seconds\}/);
});

test('kitchen and admin refresh when a table session is cleared', () => {
  assert.match(read('kitchen', 'kitchen.js'), /on\('session:cleared'/);
  assert.match(read('admin', 'app.js'), /on\('session:cleared'/);
});
