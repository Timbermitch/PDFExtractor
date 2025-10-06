#!/usr/bin/env node
import { startServer } from '../server.js';
import http from 'http';

function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
function fetchJSON(path){
  return new Promise((resolve,reject)=>{
    const req = http.request({ host:'localhost', port: process.env.PORT||5200, path, method:'GET' }, res => {
      let data=''; res.on('data', d=> data+=d); res.on('end', ()=> { try { resolve(JSON.parse(data)); } catch(e){ reject(e); } });
    });
    req.on('error', reject); req.end();
  });
}

(async () => {
  startServer();
  // poll health up to ~3s
  let healthy=false; for(let i=0;i<10;i++){ try { const h = await fetchJSON('/health'); if(h.status==='ok'){ healthy=true; break; } } catch{} await wait(300); }
  if(!healthy){ console.error('[FAIL] server failed to become healthy'); process.exit(1); }
  const summary = await fetchJSON('/reports/summary');
  if(typeof summary.reportCount !== 'number'){ console.error('[FAIL] missing reportCount'); process.exit(1); }
  console.log('[PASS] reports summary fetched');
  console.log(JSON.stringify(summary,null,2).substring(0,800));
  process.exit(0);
})();
