// In-memory brute-force protection for PIN login.
//
// Escalating tiers:
//   5  failures within 15 min  → 15 min lockout
//   10 failures within 60 min  → 60 min lockout
//   20 failures within 24 hours → 24 hour lockout
//
// Successful login resets the counter for that IP.
// State is per-process; restarting the server clears all lockouts.

const TIERS = [
  { fails: 5,  windowMs: 15 * 60 * 1000,      lockMs: 15 * 60 * 1000 },
  { fails: 10, windowMs: 60 * 60 * 1000,      lockMs: 60 * 60 * 1000 },
  { fails: 20, windowMs: 24 * 60 * 60 * 1000, lockMs: 24 * 60 * 60 * 1000 },
];

const MAX_WINDOW_MS = TIERS[TIERS.length - 1].windowMs;

export function createRateLimiter() {
  const state = new Map(); // ip -> { fails: number[], lockedUntil: number }

  function getEntry(ip) {
    let s = state.get(ip);
    if (!s) {
      s = { fails: [], lockedUntil: 0 };
      state.set(ip, s);
    }
    return s;
  }

  function prune(s, now) {
    s.fails = s.fails.filter((t) => now - t < MAX_WINDOW_MS);
  }

  function isLocked(ip) {
    const s = getEntry(ip);
    const now = Date.now();
    if (s.lockedUntil > now) {
      return {
        locked: true,
        retryAfterSec: Math.ceil((s.lockedUntil - now) / 1000),
      };
    }
    return { locked: false };
  }

  function record(ip, success) {
    const s = getEntry(ip);
    const now = Date.now();

    if (success) {
      s.fails = [];
      s.lockedUntil = 0;
      return;
    }

    s.fails.push(now);
    prune(s, now);

    // Find the strongest tier we've triggered.
    for (let i = TIERS.length - 1; i >= 0; i--) {
      const tier = TIERS[i];
      const inWindow = s.fails.filter((t) => now - t < tier.windowMs).length;
      if (inWindow >= tier.fails) {
        s.lockedUntil = now + tier.lockMs;
        return;
      }
    }
  }

  function reset() {
    state.clear();
  }

  return { isLocked, record, reset };
}
