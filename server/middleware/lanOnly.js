/**
 * Returns true if the given IP string belongs to a private/LAN address.
 *
 * Accepts:
 *   - IPv4 in the configured prefix (default 192.168.)
 *   - IPv4 loopback (127.0.0.1)
 *   - IPv4-mapped IPv6 loopback (::1)
 *   - IPv4-mapped IPv6 (::ffff:192.168.x.x)
 *
 * Rejects everything else.
 */
export function isLanIp(rawIp, prefix = '192.168.') {
  if (!rawIp || typeof rawIp !== 'string') return false;

  // Strip IPv4-mapped IPv6 prefix
  let ip = rawIp.replace(/^::ffff:/, '');

  // Loopback
  if (ip === '127.0.0.1' || ip === '::1') return true;

  // Must start with the LAN prefix
  return ip.startsWith(prefix);
}

/**
 * Express middleware factory. Rejects with 403 if the request
 * did not originate from the LAN.
 */
export function lanOnly(prefix) {
  return function (req, res, next) {
    const ip = req.socket?.remoteAddress || req.ip || '';
    if (!isLanIp(ip, prefix)) {
      return res.status(403).json({ error: 'Forbidden: not on LAN' });
    }
    next();
  };
}
