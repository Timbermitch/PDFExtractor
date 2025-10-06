#!/usr/bin/env node
/**
 * Debug utility: print surrounding lines for cost-like row patterns or adaptive triggers.
 * Usage: node scripts/debug_cost_lines.js <reportId> [--lines 25]
 */
import fs from 'fs';
import path from 'path';

const reportId = process.argv[2];
if(!reportId){
  console.error('Usage: node scripts/debug_cost_lines.js <reportId> [--lines N]');
  process.exit(1);
}
const linesArgIdx = process.argv.indexOf('--lines');
const context = linesArgIdx !== -1 ? parseInt(process.argv[linesArgIdx+1],10) : 20;

const BRONZE_DIR = path.join(process.cwd(),'data','bronze');

function loadBronze(slug){
  const single = path.join(BRONZE_DIR, slug + '.json');
  if(fs.existsSync(single)){
    try { const o=JSON.parse(fs.readFileSync(single,'utf8')); return o.text || o.rawText || ''; } catch(e){ return ''; }
  }
  const sliceFiles = fs.readdirSync(BRONZE_DIR).filter(f=>f.startsWith(slug+'-') && /-\d+\.json$/.test(f)).sort((a,b)=>{
    const na=parseInt(a.match(/-(\d+)\.json$/)[1],10); const nb=parseInt(b.match(/-(\d+)\.json$/)[1],10); return na-nb;
  });
  let combined='';
  sliceFiles.forEach(f=>{ try { const o=JSON.parse(fs.readFileSync(path.join(BRONZE_DIR,f),'utf8')); combined += (combined?'\n':'') + (o.text||o.rawText||''); } catch(e){} });
  return combined;
}

const raw = loadBronze(reportId);
if(!raw){ console.error('No bronze text for', reportId); process.exit(2); }
const lines = raw.split(/\r?\n/);

// Row regexes similar to range patterns
const rangeRowRe = /\$[0-9][0-9,]*(?:\.[0-9]{2})?.+\$[0-9][0-9,]*(?:\.[0-9]{2})?/;
let firstIdx = -1;
for(let i=0;i<lines.length;i++){
  const l = lines[i];
  if(rangeRowRe.test(l) && /\$/.test(l)) { firstIdx = i; break; }
}
if(firstIdx === -1){ console.log('No range-like cost row found. Searching for any $ lines...'); firstIdx = lines.findIndex(l=>/\$[0-9]/.test(l)); }
if(firstIdx === -1){ console.log('No dollar lines at all.'); process.exit(0); }

const start = Math.max(0, firstIdx - context);
const end = Math.min(lines.length, firstIdx + context + 1);
console.log(`Context lines ${start+1}-${end} (focus index ${firstIdx+1})`);
for(let i=start;i<end;i++){
  const mark = (i===firstIdx)? '>>':'  ';
  console.log(mark + String(i+1).padStart(6,' ') + ' | ' + lines[i]);
}