import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';

function appWithDb() {
  const db = createDb(':memory:', { quiet: true });
  return { app: createApp({ db }), db };
}

test('GET /health returns ok:true and db:connected', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.db, 'connected');
  assert.match(res.body.time, /^\d{4}-\d{2}-\d{2}T/);
  db.close();
});

test('GET /health reports db:unavailable if no db is injected', async () => {
  const app = createApp();
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.db, 'unavailable');
});

test('GET /nope returns 404', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).get('/nope');
  assert.equal(res.status, 404);
  db.close();
});
