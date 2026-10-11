import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createApp } from './app.js';
import { createDb } from './db.js';
import { networkInterfaces } from 'node:os';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const DB_PATH = resolve(process.env.DB_PATH || './data/restaurant.db');

function findLanIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

// Make sure the folder for the DB file exists.
mkdirSync(dirname(DB_PATH), { recursive: true });

console.log(`[boot] opening database at ${DB_PATH}`);
const db = createDb(DB_PATH);

const app = createApp({ db });

app.listen(PORT, HOST, () => {
  const ip = findLanIp();
  console.log('Server running:');
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${ip}:${PORT}`);
  console.log(`  Health:  http://${ip}:${PORT}/health`);
});
