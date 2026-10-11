import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';

test('GET /health returns ok:true', async () => {
  const app = createApp();
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.body.time, /^\d{4}-\d{2}-\d{2}T/);
});

test('GET /nope returns 404', async () => {
  const app = createApp();
  const res = await request(app).get('/nope');
  assert.equal(res.status, 404);
});