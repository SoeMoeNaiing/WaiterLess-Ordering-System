import { Router } from 'express';
import {
  makeKitchenSession, setCookie, clearCookie,
  COOKIE_NAMES, TTL_SEC,
} from '../middleware/auth.js';

export function kitchenAuthRouter({ db, rateLimit }) {
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

    // Kitchen PIN falls back to admin PIN if not set separately.
    const kRow = db.prepare("SELECT value FROM settings WHERE key = 'kitchen_pin'").get();
    const aRow = db.prepare("SELECT value FROM settings WHERE key = 'admin_pin'").get();
    const expected = kRow?.value || aRow?.value;

    const ok = pin === expected;
    rateLimit.record(ip, ok);
    if (!ok) return res.status(401).json({ error: 'incorrect pin' });

    setCookie(res, COOKIE_NAMES.kitchen, makeKitchenSession(), TTL_SEC.kitchen);
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    clearCookie(res, COOKIE_NAMES.kitchen);
    res.json({ ok: true });
  });

  return router;
}
