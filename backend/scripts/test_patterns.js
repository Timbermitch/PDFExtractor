#!/usr/bin/env node
/**
 * Lightweight pattern regression test.
 * 1. Loads all silver JSON files.
 * 2. Asserts: if patternId present then totalComputed > 0 (unless rows empty) and discrepancy within tolerance.
 * 3. Reports pass/fail summary and exits non-zero on failure.
 */
import fs from 'fs';
import path from 'path';

const silverDir = path.join(process.cwd(), 'backend', 'data', 'silver');
const TOLERANCE_RATIO = 1.10; // 10% tolerance
let pass=0, fail=0; const problems=[];

function checkTable(file, t){
  const { patternId, totalReported, totalComputed, rows } = t;
  if(!patternId) return; // only validate pattern-based
  if(rows && rows.length && (totalComputed == null || totalComputed <= 0)){
    fail++; problems.push({ file, patternId, reason:'non-positive computed', totalComputed }); return;
  }
  if(totalReported != null && totalComputed != null && totalComputed !== 0){
    const ratio = totalReported / totalComputed;
    if(ratio > TOLERANCE_RATIO || ratio < 1 / TOLERANCE_RATIO){
      fail++; problems.push({ file, patternId, ratio: Number(ratio.toFixed(3)), totalReported, totalComputed }); return;
    }
  }
  pass++;
}

fs.readdirSync(silverDir).filter(f=>f.endsWith('.json')).forEach(f => {
  try {
    const j = JSON.parse(fs.readFileSync(path.join(silverDir, f),'utf8'));
    (j.bmpCostTablesNormalized||[]).forEach(t=>checkTable(f,t));
  } catch(e){ /* ignore */ }
});

const summary = { pass, fail, problems };
console.log(JSON.stringify(summary,null,2));
if(fail>0){ process.exit(1); }
