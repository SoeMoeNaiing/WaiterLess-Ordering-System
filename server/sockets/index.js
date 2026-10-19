import { Server as SocketIOServer } from 'socket.io';
import { COOKIE_NAMES } from '../middleware/auth.js';
import { setIO } from './registry.js';
import { createHmac, timingSafeEqual } from 'node:crypto';

// Re-verify the auth cookies independently of Express —
// the socket handshake is HTTP but not an Express request.

function getSecret() {
  let s = process.env.SESSION_SECRET;
  if (!s) s = 'insecure-default-secret-set-SESSION_SECRET-in-env';
  if (s.length < 16) throw new Error('SESSION_SECRET must be at least 16 characters');
  return s;
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', getSecret()).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function readCookieFromHeader(cookieHeader, name) {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export function attachSocketIO(httpServer, { db }) {
  const io = new SocketIOServer(httpServer, {
    cors: { origin: false },  // LAN-only, no cross-origin needed
    path: '/socket.io/',
  });

  setIO(io);

  // Auth middleware — runs on handshake
  io.use((socket, next) => {
    const cookieHeader = socket.handshake.headers.cookie || '';
    const adminTok = readCookieFromHeader(cookieHeader, COOKIE_NAMES.admin);
    const kitchenTok = readCookieFromHeader(cookieHeader, COOKIE_NAMES.kitchen);

    const adminPayload = adminTok ? verifyToken(adminTok) : null;
    if (adminPayload && adminPayload.scope === 'admin') {
      socket.data.scope = 'admin';
      socket.data.table = null;
      return next();
    }

    const kitchenPayload = kitchenTok ? verifyToken(kitchenTok) : null;
    if (kitchenPayload && kitchenPayload.scope === 'kitchen') {
      socket.data.scope = 'kitchen';
      return next();
    }

    return next(new Error('unauthorized'));
  });

  io.on('connection', (socket) => {
    // Auto-join room by scope
    if (socket.data.scope === 'admin') {
      socket.join('admin');
      socket.join('kitchen');  // admins see kitchen events too
    } else if (socket.data.scope === 'kitchen') {
      socket.join('kitchen');
    }

    socket.emit('connected', { scope: socket.data.scope });

    // Customer status page joins a room by order id (no auth — token-gated at HTTP)
    socket.on('watch:order', ({ orderId } = {}) => {
      if (Number.isInteger(orderId) && orderId > 0) {
        socket.join(`order-${orderId}`);
      }
    });

    socket.on('unwatch:order', ({ orderId } = {}) => {
      if (Number.isInteger(orderId) && orderId > 0) {
        socket.leave(`order-${orderId}`);
      }
    });
  });

  return io;
}
