import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { existsSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';
import { loginAdmin } from './helpers/auth.js';

// Tiny 1x1 transparent PNG (67 bytes)
const PNG_1x1 = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63fcffff3f0300050001a5f645400000000049454e44ae426082',
  'hex'
);

const UPLOAD_DIR = 'uploads';

function freshUploadDir() {
  if (existsSync(UPLOAD_DIR)) {
    for (const f of readdirSync(UPLOAD_DIR)) {
      if (f === '.gitkeep') continue;
      rmSync(join(UPLOAD_DIR, f), { force: true });
    }
  }
}

async function appWithDb() {
  const db = createDb(':memory:', { quiet: true });
  const app = createApp({ db });
  const agent = request.agent(app);
  await agent.post('/api/admin/auth/login').send({ pin: '1234' });
  return { app, agent, db };
}

test('POST /api/admin/upload saves a PNG and returns its path', async () => {
  freshUploadDir();
  const { app, agent, db } = await appWithDb();

  const res = await agent.post('/api/admin/upload')
    .attach('file', PNG_1x1, 'photo.png');

  assert.equal(res.status, 201);
  assert.match(res.body.path, /^\/uploads\/[A-Za-z0-9_-]{12}\.png$/);
  assert.equal(res.body.size, PNG_1x1.length);
  assert.equal(res.body.mimetype, 'image/png');

  const saved = join(UPLOAD_DIR, res.body.path.split('/').pop());
  assert.ok(existsSync(saved), 'file should exist on disk');
  db.close();
});

test('upload with no file returns 400', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.post('/api/admin/upload').send({});
  assert.equal(res.status, 400);
  db.close();
});

test('upload rejects a disallowed extension', async () => {
  const { app, agent, db } = await appWithDb();
  const res = await agent.post('/api/admin/upload')
    .attach('file', PNG_1x1, 'evil.txt');
  assert.equal(res.status, 400);
  assert.match(res.body.error, /only jpg/);
  db.close();
});

test('two uploads get different filenames', async () => {
  freshUploadDir();
  const { app, agent, db } = await appWithDb();

  const a = await agent.post('/api/admin/upload').attach('file', PNG_1x1, 'a.png');
  const b = await agent.post('/api/admin/upload').attach('file', PNG_1x1, 'b.png');

  assert.notEqual(a.body.path, b.body.path);
  db.close();
});

test('uploaded file is reachable via /uploads/:name', async () => {
  freshUploadDir();
  const { app, agent, db } = await appWithDb();

  const up = await agent.post('/api/admin/upload').attach('file', PNG_1x1, 'photo.png');
  assert.equal(up.status, 201);

  const got = await request(app).get(up.body.path);
  assert.equal(got.status, 200);
  assert.match(got.headers['content-type'], /^image\/png/);

  const body = Buffer.isBuffer(got.body) ? got.body : Buffer.from(got.text, 'binary');
  assert.deepEqual(body.subarray(0, 4), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  db.close();
});
