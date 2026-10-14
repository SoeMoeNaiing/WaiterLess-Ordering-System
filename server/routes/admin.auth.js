import { Router } from 'express';
import {
  makeAdminSession, setCookie, clearCookie,
  COOKIE_NAMES, TTL_SEC,
} from '../middleware/auth.js';

function validPin(pin) {
  return typeof pin === 'string'
    && /^\d{4,12}$/.test(pin);
}

export function adminAuthRouter({ db, rateLimit }) {
  const router = Router();

  router.post('/login', (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    const lock = rateLimit.isLocked(ip);
    if (lock.locked) {
      res.setHeader('Retry-After', String(lock.retryAfterSec));
      return res.status(429).json({
        error: 'too many attempts',
        retry_after: lock.retryAfterSec,
      });
    }

    const { pin } = req.body ?? {};
    if (typeof pin !== 'string' || pin.trim() === '') {
      return res.status(400).json({ error: 'pin is required' });
    }

    const row = db.prepare("SELECT value FROM settings WHERE key = 'admin_pin'").get();
    const expected = row?.value;
    const ok = pin === expected;

    rateLimit.record(ip, ok);
    if (!ok) return res.status(401).json({ error: 'incorrect pin' });

    setCookie(res, COOKIE_NAMES.admin, makeAdminSession(), TTL_SEC.admin);
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    clearCookie(res, COOKIE_NAMES.admin);
    res.json({ ok: true });
  });

  // POST /api/admin/auth/change-pin
  // body: { current_pin, target: 'admin' | 'kitchen', new_pin }
  router.post('/change-pin', (req, res) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    const lock = rateLimit.isLocked(ip);
    if (lock.locked) {
      res.setHeader('Retry-After', String(lock.retryAfterSec));
      return res.status(429).json({
        error: 'too many attempts',
        retry_after: lock.retryAfterSec,
      });
    }

    const { current_pin, target, new_pin } = req.body ?? {};

    if (target !== 'admin' && target !== 'kitchen') {
      return res.status(400).json({ error: "target must be 'admin' or 'kitchen'" });
    }

    if (!validPin(current_pin)) {
      return res.status(400).json({ error: 'current_pin must be 4-12 digits' });
    }
    if (!validPin(new_pin)) {
      return res.status(400).json({ error: 'new_pin must be 4-12 digits' });
    }

    const adminRow = db.prepare("SELECT value FROM settings WHERE key = 'admin_pin'").get();
    const expectedAdmin = adminRow?.value;
    const currentOk = current_pin === expectedAdmin;

    rateLimit.record(ip, currentOk);
    if (!currentOk) return res.status(401).json({ error: 'current pin is incorrect' });

    if (current_pin === new_pin) {
      return res.status(400).json({ error: 'new pin must be different' });
    }

    const key = target === 'admin' ? 'admin_pin' : 'kitchen_pin';
    const existing = db.prepare('SELECT key FROM settings WHERE key = ?').get(key);
    if (existing) {
      db.prepare('UPDATE settings SET value = ? WHERE key = ?').run(new_pin, key);
    } else {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run(key, new_pin);
    }

    res.json({ ok: true, target });
  });

  return router;
}
