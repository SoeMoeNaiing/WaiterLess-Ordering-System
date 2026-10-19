// Simple in-memory rate limiter for order placement.
// Keyed by table id (not IP — one table, one budget).
// 10 orders per 5 minutes per table. That's 2 orders per minute — generous for
// a real table (a family of 6 might place 3-4 orders over a meal; 10 in 5 min
// means something is wrong).

const WINDOW_MS = 5 * 60 * 1000;
const MAX_ORDERS = 10;

export function createOrderRateLimiter() {
  // Map<tableId, timestamps[]> — one array per table
  const state = new Map();

  function check(tableId) {
    const now = Date.now();
    let arr = state.get(tableId);
    if (!arr) {
      arr = [];
      state.set(tableId, arr);
    }
    // Drop entries outside the window
    while (arr.length > 0 && now - arr[0] > WINDOW_MS) {
      arr.shift();
    }
    if (arr.length >= MAX_ORDERS) {
      return {
        allowed: false,
        retryAfterSec: Math.ceil((arr[0] + WINDOW_MS - now) / 1000),
        currentCount: arr.length,
      };
    }
    return { allowed: true, currentCount: arr.length };
  }

  function record(tableId) {
    let arr = state.get(tableId);
    if (!arr) {
      arr = [];
      state.set(tableId, arr);
    }
    arr.push(Date.now());
  }

  function reset() {
    state.clear();
  }

  return { check, record, reset };
}
