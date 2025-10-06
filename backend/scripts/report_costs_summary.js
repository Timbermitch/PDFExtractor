#!/usr/bin/env node
/**
 * Aggregates cost totals across all silver reports and groups by patternId.
 */
import fs from 'fs';
import path from 'path';

const silverDir = path.join(process.cwd(), 'backend', 'data', 'silver');
const patternAgg = {};
let grandReported = 0, grandComputed = 0;

fs.readdirSync(silverDir).filter(f=>f.endsWith('.json')).forEach(f => {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(silverDir, f),'utf8'));
    (j.bmpCostTablesNormalized||[]).forEach(t => {
      const pid = t.patternId || t.id || 'unknown';
      if(!patternAgg[pid]) patternAgg[pid] = { patternId: pid, tables:0, sumReported:0, sumComputed:0 };
      patternAgg[pid].tables += 1;
      if(typeof t.totalReported === 'number') { patternAgg[pid].sumReported += t.totalReported; grandReported += t.totalReported; }
      if(typeof t.totalComputed === 'number') { patternAgg[pid].sumComputed += t.totalComputed; grandComputed += t.totalComputed; }
    });
  } catch(e){ /* ignore */ }
});

const out = { grandReported, grandComputed, patterns: Object.values(patternAgg).sort((a,b)=> b.sumReported - a.sumReported) };
console.log(JSON.stringify(out, null, 2));