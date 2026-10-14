import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';

function appWithDb() {
  const db = createDb(':memory:', { quiet: true });
  return { app: createApp({ db }), db };
}

async function makeTable(app, { table_number = 'T1', is_active = 1 } = {}) {
  const created = await request(app)
    .post('/api/admin/tables')
    .send({ table_number });
  if (!is_active) {
    await request(app).put(`/api/admin/tables/${created.body.id}`).send({ is_active: 0 });
  }
  return created.body;
}

test('GET /t/:token serves HTML for a valid active table', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);

  const res = await request(app).get(`/t/${t.qr_token}`);
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /^text\/html/);
  assert.match(res.text, /Menu/);
  db.close();
});

test('GET /t/:token returns 404 for unknown token', async () => {
  const { app, db } = appWithDb();
  const res = await request(app).get('/t/doesNotExist123');
  assert.equal(res.status, 404);
  db.close();
});

test('GET /t/:token returns 410 for inactive table', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app, { table_number: 'T1', is_active: 0 });
  const res = await request(app).get(`/t/${t.qr_token}`);
  assert.equal(res.status, 410);
  db.close();
});

test('regenerated token invalidates the old URL', async () => {
  const { app, db } = appWithDb();
  const t = await makeTable(app);
  await request(app).post(`/api/admin/tables/${t.id}/regenerate-token`).send();
  const res = await request(app).get(`/t/${t.qr_token}`);
  assert.equal(res.status, 404);
  db.close();
});
