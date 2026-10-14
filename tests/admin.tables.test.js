import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';

function appWithDb() {
  const db = createDb(':memory:', { quiet: true });
  return { app: createApp({ db }), db };
}

test('POST /api/admin/tables creates a table with a token', async () => {
  const { app, db } = appWithDb();

  const res = await request(app)
    .post('/api/admin/tables')
    .send({ table_number: 'T1', label: 'Window seat' });

  assert.equal(res.status, 201);
  assert.equal(res.body.table_number, 'T1');
  assert.equal(res.body.label, 'Window seat');
  assert.equal(res.body.is_active, 1);
  assert.equal(typeof res.body.qr_token, 'string');
  assert.equal(res.body.qr_token.length, 12);
  assert.ok(res.body.id > 0);
  db.close();
});

test('POST with label omitted stores label as null', async () => {
  const { app, db } = appWithDb();

  const res = await request(app)
    .post('/api/admin/tables')
    .send({ table_number: 'T2' });

  assert.equal(res.status, 201);
  assert.equal(res.body.label, null);
  db.close();
});

test('POST without table_number returns 400', async () => {
  const { app, db } = appWithDb();

  const res = await request(app)
    .post('/api/admin/tables')
    .send({ label: 'No number' });

  assert.equal(res.status, 400);
  assert.match(res.body.error, /table_number/);
  db.close();
});

test('POST with empty/whitespace table_number returns 400', async () => {
  const { app, db } = appWithDb();

  const res = await request(app)
    .post('/api/admin/tables')
    .send({ table_number: '   ' });

  assert.equal(res.status, 400);
  db.close();
});

test('POST with duplicate table_number returns 409', async () => {
  const { app, db } = appWithDb();

  const first = await request(app)
    .post('/api/admin/tables')
    .send({ table_number: 'T1' });
  assert.equal(first.status, 201);

  const second = await request(app)
    .post('/api/admin/tables')
    .send({ table_number: 'T1' });
  assert.equal(second.status, 409);
  assert.match(second.body.error, /already exists/);
  db.close();
});

test('two tables get different tokens', async () => {
  const { app, db } = appWithDb();

  const a = await request(app).post('/api/admin/tables').send({ table_number: 'A' });
  const b = await request(app).post('/api/admin/tables').send({ table_number: 'B' });

  assert.notEqual(a.body.qr_token, b.body.qr_token);
  db.close();
});

test('table_number is trimmed before saving', async () => {
  const { app, db } = appWithDb();

  const res = await request(app)
    .post('/api/admin/tables')
    .send({ table_number: '  T9  ' });

  assert.equal(res.status, 201);
  assert.equal(res.body.table_number, 'T9');
  db.close();
});
