#!/usr/bin/env node
import http from 'http';

function fetchJSON(path){
  return new Promise((resolve,reject)=>{
    const req = http.request({ host:'localhost', port: process.env.PORT||5200, path, method:'GET' }, res => {
      let data='';
      res.on('data', d=> data+=d);
      res.on('end', ()=>{
        try { resolve(JSON.parse(data)); } catch(e){ reject(new Error('Invalid JSON '+e.message)); }
      });
    });
    req.on('error', reject); req.end();
  });
}

(async () => {
  const result = await fetchJSON('/reports/summary');
  const errors = [];
  const requiredKeys = ['reportCount','reportsWithCosts','totalReported','totalComputed','patternUsage'];
  requiredKeys.forEach(k => { if(!(k in result)) errors.push('Missing key '+k); });
  if(!Array.isArray(result.patternUsage)) errors.push('patternUsage not array');
  if(result.reportCount < result.reportsWithCosts) errors.push('reportsWithCosts exceeds reportCount');
  if(result.totalReported < 0 || result.totalComputed < 0) errors.push('totals negative');
  if(result.discrepancy !== null && typeof result.discrepancy !== 'number') errors.push('invalid discrepancy');
  // Basic monotonic check: each pattern entry must have positive count
  result.patternUsage.forEach(p => { if(p.count <=0) errors.push('pattern with non-positive count '+p.patternId); });
  if(errors.length){
    console.error('[FAIL] /reports/summary test failed');
    errors.forEach(e=>console.error(' -', e));
    process.exit(1);
  } else {
    console.log('[PASS] /reports/summary basic structure valid');
    console.log(JSON.stringify({
      reportCount: result.reportCount,
      reportsWithCosts: result.reportsWithCosts,
      totalReported: result.totalReported,
      totalComputed: result.totalComputed,
      patterns: result.patternUsage.length
    }, null, 2));
  }
})().catch(e => { console.error('[ERROR] test execution failed', e); process.exit(1); });
