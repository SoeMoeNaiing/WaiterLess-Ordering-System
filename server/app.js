import 'dotenv/config';
import express from 'express';
import { lanOnly } from './middleware/lanOnly.js';

const LAN_PREFIX = process.env.LAN_PREFIX || '192.168.';

export function createApp() {
  const app = express();

  app.use(express.json());

  // Security: only requests from the shop LAN (or loopback) get through.
  app.use(lanOnly(LAN_PREFIX));

  app.get('/health', (req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  return app;
}
