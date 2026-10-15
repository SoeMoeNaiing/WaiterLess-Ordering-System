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
