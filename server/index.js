import { createApp } from './app.js';
import { networkInterfaces } from 'node:os';

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

function findLanIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // IPv4, not loopback
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

const app = createApp();

app.listen(PORT, HOST, () => {
  const ip = findLanIp();
  console.log(`Server running:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${ip}:${PORT}`);
  console.log(`  Health:  http://${ip}:${PORT}/health`);
});