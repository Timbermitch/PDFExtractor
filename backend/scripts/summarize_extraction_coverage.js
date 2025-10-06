#!/usr/bin/env node
// Generates coverage summary from mdeq_extraction_results.json with OCR tagging for empty-text errors.
import fs from 'fs';
import path from 'path';

function loadResults(){
  const base = path.join(process.cwd(),'backend','data','mdeq_extraction_results.json');
  if(!fs.existsSync(base)) throw new Error('results file missing: '+base);
  return JSON.parse(fs.readFileSync(base,'utf-8'));
}

function summarize(data){
  const results = data.results || [];
  const success = results.filter(r=> !r.error);
  const errors = results.filter(r=> r.error);
  const emptyText = errors.filter(e=> /empty-text/i.test(e.error));
  const needsOCR = emptyText.map(e=> e.file);
  const zeroGoal = success.filter(r=> r.zeroGoal);
  const zeroBMP = success.filter(r=> r.zeroBMP);
  const bmpCounts = success.map(r=> r.bmps).sort((a,b)=> a-b);
  function percentile(p){ if(!bmpCounts.length) return 0; const idx = Math.floor((p/100)* (bmpCounts.length-1)); return bmpCounts[idx]; }
  const summary = {
    totalDocs: results.length,
    success: success.length,
    errors: errors.length,
    zeroGoal: zeroGoal.length,
    zeroBMP: zeroBMP.length,
    needsOCR: needsOCR.length,
    needsOCRFiles: needsOCR,
    zeroGoalFiles: zeroGoal.map(r=>r.file),
    zeroBMPFiles: zeroBMP.map(r=>r.file),
    highBmpFiles: success.filter(r=> r.bmps >= 150).map(r=>({ file:r.file, bmps:r.bmps })),
    bmpStats: {
      min: bmpCounts[0] || 0,
      median: bmpCounts.length? bmpCounts[Math.floor(bmpCounts.length/2)] : 0,
      p90: percentile(90),
      p95: percentile(95),
      p99: percentile(99),
      max: bmpCounts[bmpCounts.length-1] || 0,
      mean: success.length ? +(success.reduce((a,r)=>a+r.bmps,0)/success.length).toFixed(2) : 0
    },
    generatedAt: new Date().toISOString()
  };
  return summary;
}

function main(){
  const data = loadResults();
  const summary = summarize(data);
  const outPath = path.join(process.cwd(),'backend','data','mdeq_coverage_summary.json');
  fs.writeFileSync(outPath, JSON.stringify(summary,null,2));
  console.log('Coverage summary written to', outPath);
  console.log('\nQuick Stats:', { total: summary.totalDocs, success: summary.success, errors: summary.errors, zeroBMP: summary.zeroBMP, highBmpFiles: summary.highBmpFiles.length });
}

main();
