#!/usr/bin/env node
/**
 * Verifies each cost table's computed total matches (within tolerance) the reported total.
 * Outputs a summary with pass/fail counts.
 */
import fs from 'fs';
import path from 'path';

const silverDir = path.join(process.cwd(), 'backend', 'data', 'silver');
const TOLERANCE = 1.05; // allow 5% drift (rounding / OCR issues)

let pass = 0, fail = 0, skipped = 0;
const issues = [];

fs.readdirSync(silverDir).filter(f=>f.endsWith('.json')).forEach(f => {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(silverDir, f),'utf8'));
    const tables = json.bmpCostTablesNormalized || [];
    if(!tables.length){ skipped++; return; }
    tables.forEach(t => {
      const reported = t.totalReported;
      const computed = t.totalComputed;
      if(reported == null || computed == null){ skipped++; return; }
      if(computed === 0){ fail++; issues.push({ file:f, id:t.id, reason:'computed=0 with reported set', reported, computed }); return; }
      const ratio = reported / computed;
      if(ratio < 1/TOLERANCE || ratio > TOLERANCE){
        fail++; issues.push({ file:f, id:t.id, reported, computed, ratio: Number(ratio.toFixed(3)) });
      } else { pass++; }
    });
  } catch(e){ /* ignore */ }
});

console.log(JSON.stringify({ pass, fail, skipped, issues }, null, 2));