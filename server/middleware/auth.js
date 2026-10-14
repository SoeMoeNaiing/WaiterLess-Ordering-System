import { createHmac, timingSafeEqual } from 'node:crypto';

const ADMIN_COOKIE = 'rs_admin';
const KITCHEN_COOKIE = 'rs_kitchen';

const ADMIN_TTL_MS = 12 * 60 * 60 * 1000;      // 12 hours
const KITCHEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

let warnedInsecure = false;

function secret() {
  let s = process.env.SESSION_SECRET;
  if (!s) {
    if (!warnedInsecure) {
      console.warn('[auth] SESSION_SECRET not set — using an insecure default. Set it in .env for production.');
      warnedInsecure = true;
    }
    s = 'insecure-default-secret-set-SESSION_SECRET-in-env';
  }
  if (s.length < 16) throw new Error('SESSION_SECRET must be at least 16 characters');
  return s;
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
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

export function makeAdminSession() {
  return sign({ exp: Date.now() + ADMIN_TTL_MS, scope: 'admin' });
}

export function makeKitchenSession() {
  return sign({ exp: Date.now() + KITCHEN_TTL_MS, scope: 'kitchen' });
}

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export function setCookie(res, name, token, maxAgeSec) {
  res.setHeader(
    'Set-Cookie',
    `${name}=${token}; Max-Age=${maxAgeSec}; Path=/; HttpOnly; SameSite=Lax`
  );
}

export function clearCookie(res, name) {
  res.setHeader(
    'Set-Cookie',
    `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`
  );
}

export function requireAdmin(req, res, next) {
  const token = readCookie(req, ADMIN_COOKIE);
  const payload = token ? verify(token) : null;
  if (!payload || payload.scope !== 'admin') {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

export function requireKitchen(req, res, next) {
  // Admin cookie also grants access to kitchen.
  const aTok = readCookie(req, ADMIN_COOKIE);
  const aPayload = aTok ? verify(aTok) : null;
  if (aPayload && aPayload.scope === 'admin') return next();

  const kTok = readCookie(req, KITCHEN_COOKIE);
  const kPayload = kTok ? verify(kTok) : null;
  if (kPayload && kPayload.scope === 'kitchen') return next();

  return res.status(401).json({ error: 'unauthorized' });
}

export const COOKIE_NAMES = { admin: ADMIN_COOKIE, kitchen: KITCHEN_COOKIE };
export const TTL_SEC = {
  admin: Math.floor(ADMIN_TTL_MS / 1000),
  kitchen: Math.floor(KITCHEN_TTL_MS / 1000),
};
