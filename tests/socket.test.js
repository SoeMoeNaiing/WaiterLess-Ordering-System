import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import request from 'supertest';
import { io as ioClient } from 'socket.io-client';
import { createApp } from '../server/app.js';
import { createDb } from '../server/db.js';
import { attachSocketIO } from '../server/sockets/index.js';
import { loginAdmin, loginKitchen } from './helpers/auth.js';

async function startServer() {
  const db = createDb(':memory:', { quiet: true });
  const app = createApp({ db });
  const httpServer = createServer(app);
  const io = attachSocketIO(httpServer, { db });
  app.locals.io = io;
  app.locals.db = db;

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const port = httpServer.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  return { httpServer, io, db, port, baseUrl, app };
}

function stopServer(httpServer, io) {
  return new Promise((resolve) => {
    if (io) {
      try { io.close(); } catch {}
    }
    httpServer.close(() => resolve());
  });
}

function connectSocket(baseUrl, cookie) {
  return new Promise((resolve, reject) => {
    const socket = ioClient(baseUrl, {
      path: '/socket.io/',
      transports: ['websocket'],
      extraHeaders: { Cookie: cookie },
      reconnection: false,
      timeout: 3000,
    });

    let done = false;
    const fail = (err) => {
      if (done) return;
      done = true;
      socket.close();
      reject(err);
    };

    socket.once('connect_error', fail);
    socket.once('connected', (data) => {
      if (done) return;
      done = true;
      resolve({ socket, scope: data.scope });
    });
    socket.once('disconnect', () => fail(new Error('disconnected before connected event')));
  });
}

// ---------- Auth ----------

test('anonymous socket connects with anonymous scope (for customer status)', { timeout: 5000 }, async () => {
  const { httpServer, baseUrl, io } = await startServer();
  try {
    const { socket, scope } = await connectSocket(baseUrl, '');
    assert.equal(scope, 'anonymous');
    socket.close();
  } finally {
    await stopServer(httpServer, io);
  }
});

test('anonymous socket does NOT join kitchen room', { timeout: 5000 }, async () => {
  const { httpServer, baseUrl, io } = await startServer();
  try {
    const { socket } = await connectSocket(baseUrl, '');
    await new Promise((r) => setTimeout(r, 100));
    const kitchenRoom = io.sockets.adapter.rooms.get('kitchen');
    // Either the room doesn't exist or it has 0 sockets (anonymous didn't join)
    assert.ok(!kitchenRoom || kitchenRoom.size === 0, 'anonymous must not be in kitchen room');
    socket.close();
  } finally {
    await stopServer(httpServer, io);
  }
});

test('anonymous socket can watch a specific order', { timeout: 5000 }, async () => {
  const { httpServer, baseUrl, io } = await startServer();
  try {
    const { socket } = await connectSocket(baseUrl, '');
    socket.emit('watch:order', { orderId: 42 });
    await new Promise((r) => setTimeout(r, 100));
    const room = io.sockets.adapter.rooms.get('order-42');
    assert.ok(room, 'order-42 room should exist');
    assert.equal(room.size, 1, 'anonymous socket should be in order-42 room');
    socket.close();
  } finally {
    await stopServer(httpServer, io);
  }
});

test('admin cookie connects with admin scope', { timeout: 5000 }, async () => {
  const { httpServer, baseUrl, app, io } = await startServer();
  try {
    const cookie = await loginAdmin(app);
    const { socket, scope } = await connectSocket(baseUrl, cookie);
    assert.equal(scope, 'admin');
    socket.close();
  } finally {
    await stopServer(httpServer, io);
  }
});

test('kitchen cookie connects with kitchen scope', { timeout: 5000 }, async () => {
  const { httpServer, baseUrl, app, io } = await startServer();
  try {
    const cookie = await loginKitchen(app);
    const { socket, scope } = await connectSocket(baseUrl, cookie);
    assert.equal(scope, 'kitchen');
    socket.close();
  } finally {
    await stopServer(httpServer, io);
  }
});

// ---------- DEBUG: server-side inspection ----------

test('debug: socket joins kitchen room and app.locals.io is set', { timeout: 5000 }, async () => {
  const { httpServer, baseUrl, app, io } = await startServer();
  try {
    const cookie = await loginKitchen(app);
    const { socket } = await connectSocket(baseUrl, cookie);

    // Give the server a moment to process the join
    await new Promise((r) => setTimeout(r, 100));

    console.log('\n[DEBUG] app.locals.io set?', Boolean(app.locals.io));
    console.log('[DEBUG] io instance same?', app.locals.io === io);
    const rooms = [...io.sockets.adapter.rooms.keys()];
    console.log('[DEBUG] all rooms:', rooms);
    const kitchenRoom = io.sockets.adapter.rooms.get('kitchen');
    console.log('[DEBUG] kitchen room size:', kitchenRoom ? kitchenRoom.size : 'MISSING');

    assert.ok(app.locals.io, 'app.locals.io must be set');
    assert.equal(app.locals.io, io, 'app.locals.io must be the same instance');
    assert.ok(kitchenRoom, 'kitchen room must exist');
    assert.equal(kitchenRoom.size, 1, 'kitchen room must contain 1 socket');

    socket.close();
  } finally {
    await stopServer(httpServer, io);
  }
});

// ---------- Event delivery ----------

test('POST /api/customer/orders emits order:new to kitchen socket', { timeout: 8000 }, async () => {
  const { httpServer, baseUrl, app, io } = await startServer();
  try {
    const cookie = await loginAdmin(app);
    const t = await request(app)
      .post('/api/admin/tables').set('Cookie', cookie).send({ table_number: 'T1' });
    const cat = await request(app)
      .post('/api/admin/categories').set('Cookie', cookie).send({ name: 'C' });
    const item = await request(app)
      .post('/api/admin/menu-items').set('Cookie', cookie)
      .send({ name: 'X', price: 5, category_id: cat.body.id });

    const kitchenCookie = await loginKitchen(app);
    const { socket } = await connectSocket(baseUrl, kitchenCookie);

    // Let the join settle
    await new Promise((r) => setTimeout(r, 100));

    console.log('\n[DEBUG] before POST — kitchen room size:',
      io.sockets.adapter.rooms.get('kitchen')?.size || 0);

    const newOrderPromise = new Promise((resolve) => {
      socket.once('order:new', (payload) => {
        console.log('[DEBUG] client received order:new', payload?.order?.id);
        resolve(payload);
      });
    });

    console.log('[DEBUG] sending POST to', baseUrl + '/api/customer/orders');
    const res = await fetch(`${baseUrl}/api/customer/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: t.body.qr_token,
        items: [{ itemId: item.body.id, qty: 1 }],
      }),
    });
    console.log('[DEBUG] POST response status:', res.status);
    assert.equal(res.status, 201);

    console.log('[DEBUG] waiting for order:new event…');
    const payload = await newOrderPromise;
    assert.ok(payload.order.id > 0);
    assert.equal(payload.order.table_id, t.body.id);
    assert.equal(payload.items.length, 1);
    assert.equal(payload.items[0].name_snapshot, 'X');

    socket.close();
  } finally {
    await stopServer(httpServer, io);
  }
});

test('PATCH /api/kitchen/orders/:id emits order:updated', { timeout: 8000 }, async () => {
  const { httpServer, baseUrl, app, io } = await startServer();
  try {
    const cookie = await loginAdmin(app);
    const t = await request(app)
      .post('/api/admin/tables').set('Cookie', cookie).send({ table_number: 'T1' });
    const cat = await request(app)
      .post('/api/admin/categories').set('Cookie', cookie).send({ name: 'C' });
    const item = await request(app)
      .post('/api/admin/menu-items').set('Cookie', cookie)
      .send({ name: 'X', price: 5, category_id: cat.body.id });

    const orderRes = await fetch(`${baseUrl}/api/customer/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: t.body.qr_token,
        items: [{ itemId: item.body.id, qty: 1 }],
      }),
    });
    const orderData = await orderRes.json();

    const kitchenCookie = await loginKitchen(app);
    const { socket } = await connectSocket(baseUrl, kitchenCookie);

    await new Promise((r) => setTimeout(r, 100));

    const updatedPromise = new Promise((resolve) => {
      socket.once('order:updated', resolve);
    });

    const patchRes = await fetch(`${baseUrl}/api/kitchen/orders/${orderData.order.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Cookie: kitchenCookie,
      },
      body: JSON.stringify({ status: 'preparing' }),
    });
    assert.equal(patchRes.status, 200);

    const payload = await updatedPromise;
    assert.equal(payload.order.id, orderData.order.id);
    assert.equal(payload.order.status, 'preparing');

    socket.close();
  } finally {
    await stopServer(httpServer, io);
  }
});
