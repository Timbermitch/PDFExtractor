// Trigger a Render deploy via API.
// Usage: node backend/scripts/triggerRenderDeploy.js <serviceId>
// Requires env RENDER_API_KEY.
import https from 'https';

const serviceId = process.argv[2] || process.env.RENDER_SERVICE_ID;
if(!serviceId){
  console.error('Missing serviceId arg or RENDER_SERVICE_ID env');
  process.exit(1);
}
const apiKey = process.env.RENDER_API_KEY;
if(!apiKey){
  console.error('Missing RENDER_API_KEY env');
  process.exit(1);
}

const data = JSON.stringify({ serviceId });
const options = {
  hostname: 'api.render.com',
  path: '/v1/services/' + serviceId + '/deploys',
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data)
  }
};

const req = https.request(options, res => {
  const chunks = [];
  res.on('data', d => chunks.push(d));
  res.on('end', () => {
    const body = Buffer.concat(chunks).toString();
    console.log('[render:deploy] status', res.statusCode);
    console.log(body);
    if(res.statusCode >= 300) process.exit(1);
  });
});
req.on('error', e => { console.error('request error', e); process.exit(1); });
req.write(data);
req.end();
