import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';

test('GET /admin/ returns the admin HTML page', async () => {
  const app = createApp();
  const res = await request(app).get('/admin/');
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.match(res.text, /Admin panel/);
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
