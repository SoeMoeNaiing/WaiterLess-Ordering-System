import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';

test('GET /admin/ returns the admin HTML page', async () => {
  const app = createApp();
  const res = await request(app).get('/admin/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.match(res.text, /Admin/);
});

test('GET /admin redirects to /admin/ (express.static default)', async () => {
  const app = createApp();
  const res = await request(app).get('/admin');
  assert.equal(res.status, 301);
  assert.equal(res.headers.location, '/admin/');
});

test('GET /admin/app.js returns JavaScript', async () => {
  const app = createApp();
  const res = await request(app).get('/admin/app.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
});

test('GET /admin/app.js references categories endpoint', async () => {
  const app = createApp();
  const res = await request(app).get('/admin/app.js');
  assert.equal(res.status, 200);
  assert.match(res.text, /\/api\/admin\/categories/);
});

test('GET /admin/app.js references menu-items endpoint', async () => {
  const app = createApp();
  const res = await request(app).get('/admin/app.js');
  assert.equal(res.status, 200);
  assert.match(res.text, /\/api\/admin\/menu-items/);
});

test('GET /admin/placeholder.svg returns SVG', async () => {
  const app = createApp();
  const res = await request(app).get('/admin/placeholder.svg');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /svg/);
});

test('GET /kitchen/ returns the kitchen HTML page', async () => {
  const app = createApp();
  const res = await request(app).get('/kitchen/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.match(res.text, /Kitchen/);
});

test('GET /kitchen/kitchen.js returns JavaScript', async () => {
  const app = createApp();
  const res = await request(app).get('/kitchen/kitchen.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
});

test('GET /admin/print.html serves the print page', async () => {
  const app = createApp();
  const res = await request(app).get('/admin/print.html');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.match(res.text, /Print QR/);
});

test('GET /i18n/en.json serves the English dictionary', async () => {
  const app = createApp();
  const res = await request(app).get('/i18n/en.json');
  assert.equal(res.status, 200);
  const dict = JSON.parse(res.text);
  assert.equal(dict['customer.place_order'], 'Place order');
});

test('GET /i18n/my.json serves the Burmese dictionary', async () => {
  const app = createApp();
  const res = await request(app).get('/i18n/my.json');
  assert.equal(res.status, 200);
  const dict = JSON.parse(res.text);
  assert.ok(dict['customer.place_order']);
  assert.notEqual(dict['customer.place_order'], 'Place order');
});

test('GET /i18n/i18n.js serves the helper', async () => {
  const app = createApp();
  const res = await request(app).get('/i18n/i18n.js');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /javascript/);
});

test('GET /api/nope returns JSON 404', async () => {
  const app = createApp();
  const res = await request(app).get('/api/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'endpoint not found');
  assert.equal(res.body.path, '/api/nope');
});

test('GET /nope returns text 404', async () => {
  const app = createApp();
  const res = await request(app).get('/nope');
  assert.equal(res.status, 404);
  assert.match(res.text, /Not found/);
});

test('invalid JSON body returns 400', async () => {
  const app = createApp();
  const res = await request(app)
    .post('/health')
    .set('Content-Type', 'application/json')
    .send('{not json');
  // /health is GET only, but the JSON parse error should trigger before 405
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid JSON body');
});

// ---------- 404 + error handler (from B1) ----------

test('GET /api/nope returns JSON 404', async () => {
  const app = createApp();
  const res = await request(app).get('/api/nope');
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'endpoint not found');
  assert.equal(res.body.path, '/api/nope');
});

test('GET /nope returns text 404', async () => {
  const app = createApp();
  const res = await request(app).get('/nope');
  assert.equal(res.status, 404);
  assert.match(res.text, /Not found/);
});

test('invalid JSON body returns 400', async () => {
  const app = createApp();
  const res = await request(app)
    .post('/api/admin/auth/login')
    .set('Content-Type', 'application/json')
    .send('{not json');
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid JSON body');
});
