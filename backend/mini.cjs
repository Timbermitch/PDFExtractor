// CommonJS minimal server (bypasses ESM) for diagnostics with port fallback
const http = require('http');

let port = 5060;
const maxAttempts = 10;

function start() {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('mini-cjs-ok');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && port < 5060 + maxAttempts) {
      console.warn(`[mini.cjs] port ${port} in use, trying ${port + 1}`);
      port += 1;
      setTimeout(start, 50);
    } else {
      console.error('[mini.cjs] server error (giving up)', err);
      process.exit(1);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[mini.cjs] listening on http://127.0.0.1:${port}`);
  });
}

start();
