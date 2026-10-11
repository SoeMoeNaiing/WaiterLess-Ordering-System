import 'dotenv/config';
import express from 'express';
import { lanOnly } from './middleware/lanOnly.js';

const LAN_PREFIX = process.env.LAN_PREFIX || '192.168.';

export function createApp({ db } = {}) {
  const app = express();

  app.use(express.json());
  app.use(lanOnly(LAN_PREFIX));

  app.get('/health', (req, res) => {
    let dbStatus = 'unavailable';
    try {
      if (db) {
        db.prepare('SELECT 1').get();
        dbStatus = 'connected';
      }
    } catch {
      dbStatus = 'error';
      return res.status(500).json({
        ok: false,
        db: dbStatus,
        time: new Date().toISOString(),
      });
    }

    res.json({
      ok: true,
      db: dbStatus,
      time: new Date().toISOString(),
    });
  });

  return app;
}
