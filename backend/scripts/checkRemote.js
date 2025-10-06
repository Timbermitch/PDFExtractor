// Simple remote endpoint checker for deployed base URL.
// Usage: node scripts/checkRemote.js https://your-service.onrender.com
import https from 'https';
import http from 'http';

const base = process.argv[2];
if(!base){
  console.error('Usage: node scripts/checkRemote.js <baseUrl>');
  process.exit(1);
}

const endpoints = ['/', '/health', '/version', '/__diag'];

function fetchUrl(url){
  return new Promise(resolve => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, res => {
      const chunks = [];
      res.on('data', d => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString();
        resolve({ url, status: res.statusCode, body: body.slice(0, 400) });
      });
    });
    req.on('error', e => resolve({ url, error: e.message }));
    req.setTimeout(8000, () => { req.destroy(new Error('timeout')); });
  });
}

(async () => {
  console.log('[checkRemote] base=', base);
  for(const ep of endpoints){
    const full = base.replace(/\/$/,'') + ep;
    const result = await fetchUrl(full);
    console.log('[checkRemote] result', result);
  }
})();
