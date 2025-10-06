import http from 'http';

// Minimal standalone HTTP server for connectivity diagnostics.
// Visit http://localhost:5055/ to confirm basic loopback reachability.
const server = http.createServer((req, res) => {
	res.writeHead(200, { 'Content-Type': 'text/plain' });
	res.end('mini-ok');
});

server.listen(5055, '0.0.0.0', () => {
	console.log('[mini] listening on http://localhost:5055');
});

server.on('error', (err) => {
	console.error('[mini] server error', err);
});
