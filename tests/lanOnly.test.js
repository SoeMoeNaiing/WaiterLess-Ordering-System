import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLanIp, lanOnly } from '../server/middleware/lanOnly.js';

// ---------- isLanIp (pure function) ----------

test('isLanIp accepts 192.168.x.x', () => {
  assert.equal(isLanIp('192.168.1.42'), true);
  assert.equal(isLanIp('192.168.0.1'), true);
});

test('isLanIp accepts loopback', () => {
  assert.equal(isLanIp('127.0.0.1'), true);
  assert.equal(isLanIp('::1'), true);
});

test('isLanIp accepts IPv4-mapped IPv6 on LAN', () => {
  assert.equal(isLanIp('::ffff:192.168.1.10'), true);
});

test('isLanIp rejects public IPv4', () => {
  assert.equal(isLanIp('8.8.8.8'), false);
  assert.equal(isLanIp('1.1.1.1'), false);
});

test('isLanIp rejects other private ranges by default', () => {
  assert.equal(isLanIp('10.0.0.5'), false);
  assert.equal(isLanIp('172.16.0.5'), false);
});

test('isLanIp respects a custom prefix', () => {
  assert.equal(isLanIp('10.0.0.5', '10.'), true);
  assert.equal(isLanIp('192.168.1.1', '10.'), false);
});

test('isLanIp rejects empty / null / non-string', () => {
  assert.equal(isLanIp(''), false);
  assert.equal(isLanIp(null), false);
  assert.equal(isLanIp(undefined), false);
  assert.equal(isLanIp(42), false);
});

// ---------- lanOnly (Express middleware) ----------

function makeReq(remoteAddress) {
  return { socket: { remoteAddress } };
}

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

test('lanOnly calls next() for LAN request', () => {
  const mw = lanOnly('192.168.');
  const req = makeReq('192.168.1.20');
  const res = makeRes();
  let called = false;
  mw(req, res, () => { called = true; });
  assert.equal(called, true);
  assert.equal(res.statusCode, 200);
});

test('lanOnly rejects non-LAN request with 403', () => {
  const mw = lanOnly('192.168.');
  const req = makeReq('8.8.8.8');
  const res = makeRes();
  let called = false;
  mw(req, res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res.statusCode, 403);
  assert.deepEqual(res.body, { error: 'Forbidden: not on LAN' });
});

test('lanOnly allows loopback (dev convenience)', () => {
  const mw = lanOnly('192.168.');
  const req = makeReq('127.0.0.1');
  const res = makeRes();
  let called = false;
  mw(req, res, () => { called = true; });
  assert.equal(called, true);
});
