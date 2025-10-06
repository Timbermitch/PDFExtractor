#!/usr/bin/env node
// Quick health probe across potential retry ports (5200-5202).
// Usage: node backend/scripts/checkHealth.js [host]
// Host defaults to localhost. Exits 0 if any port responds 200, else 1.

import http from 'http';

const host = process.argv[2] || 'localhost';
const ports = [5200, 5201, 5202];

function probe(port) {
  return new Promise(resolve => {
    const req = http.request({ host, port, path: '/health', timeout: 2000 }, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => resolve({ port, ok: res.statusCode === 200, status: res.statusCode, body }));
    });
    req.on('error', err => resolve({ port, ok: false, error: err.message }));
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

(async () => {
  const results = [];
  for (const p of ports) {
    // eslint-disable-next-line no-console
    console.log(`[health] probing ${host}:${p}/health`);
    // eslint-disable-next-line no-await-in-loop
    const r = await probe(p);
    results.push(r);
    if (r.ok) {
      // eslint-disable-next-line no-console
      console.log(`[health] SUCCESS port=${p} status=${r.status}`);
      process.exit(0);
    }
  }
  // eslint-disable-next-line no-console
  console.error('[health] All candidate ports failed:', results);
  process.exit(1);
})();
