// One log line per request. Skips static assets, socket.io, and 304s (cache).
// Captures req.path BEFORE Express mutates it for router matching.
// Format: [req] METHOD /path → status (Xms)

const SKIP_PREFIXES = ['/uploads/', '/socket.io/', '/i18n/'];
const SKIP_EXT = /\.(js|css|png|jpg|jpeg|svg|json|ico|html|woff2?)$/i;

export function requestLog(req, res, next) {
  // Skip noisy paths (checked before Express touches req.path)
  if (SKIP_PREFIXES.some((p) => req.path.startsWith(p))) return next();
  if (!req.path.startsWith('/api/') && SKIP_EXT.test(req.path)) return next();

  // CRITICAL: capture these NOW — Express modifies req.path later during routing
  const method = req.method;
  const path = req.path;
  const start = Date.now();

  res.on('finish', () => {
    // Skip 304 (not modified) — pure cache hits, no useful info
    if (res.statusCode === 304) return;
    const ms = Date.now() - start;
    console.log(`[req] ${method} ${path} → ${res.statusCode} (${ms}ms)`);
  });
  next();
}
