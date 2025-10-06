#!/usr/bin/env node
/**
 * Discover cost-like line clusters in reports that currently have NO parsed cost tables.
 * Strategy:
 *  1. Load audit JSON (default: audit_cost_coverage_full.json in current working dir) OR derive missing by recomputing.
 *  2. For each missing report id, load merged bronze text (reassemble slices) and scan for clusters:
 *     - Cluster definition: window of <= 80 lines containing >= 4 lines with dollar amounts ($###) and at most 8 non-dollar lines intermixed.
 *     - Break cluster when >3 consecutive non-dollar lines or a hard section header (Goal, Objective, Section, Table <n>, Implementation Plan).
 *  3. Produce a structured JSON with per-report clusters: firstLineNo, lastLineNo, dollarsPerLine, sampleLines (first 12), headerSignature.
 *  4. Emit a concise stdout summary + write JSON file (--out <path>). Default out: missing_cost_clusters.json
 *
 *  Usage:
 *    node scripts/discover_missing_cost_clusters.js --audit audit_cost_coverage_full.json --out missing_cost_clusters.json
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const CWD = process.cwd();
const BRONZE_DIR = path.join(CWD, 'data', 'bronze');
const SILVER_DIR = path.join(CWD, 'data', 'silver');

function loadAudit(auditPath){
  if(!auditPath || !fs.existsSync(auditPath)) return null;
  try { return JSON.parse(fs.readFileSync(auditPath,'utf8')); } catch(e){ return null; }
}

function listSilverIds(){
  if(!fs.existsSync(SILVER_DIR)) return [];
  return fs.readdirSync(SILVER_DIR).filter(f=>f.endsWith('.json')).map(f=>f.replace(/\.json$/,''));
}

function computeMissing(audit){
  if(audit) return audit.reports.filter(r=>!r.hasCost).map(r=>r.id);
  // fallback: treat missing as those silvers whose normalized tables array empty
  const ids = listSilverIds();
  const missing=[];
  ids.forEach(id=>{
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(SILVER_DIR, id+'.json'),'utf8'));
      const tables = obj.bmpCostTablesNormalized || [];
      const legacy = obj.bmpCostTableNormalized ? [obj.bmpCostTableNormalized]: [];
      if(tables.length+legacy.length===0) missing.push(id);
    } catch(e){ /* ignore */ }
  });
  return missing;
}

function loadBronzeMerged(slug){
  const single = path.join(BRONZE_DIR, slug + '.json');
  if(fs.existsSync(single)){
    try { const o=JSON.parse(fs.readFileSync(single,'utf8')); return o.text || o.rawText || ''; } catch(e){ return ''; }
  }
  const sliceFiles = fs.readdirSync(BRONZE_DIR).filter(f=>f.startsWith(slug+'-') && /-\d+\.json$/.test(f)).sort((a,b)=>{
    const na=parseInt(a.match(/-(\d+)\.json$/)[1],10); const nb=parseInt(b.match(/-(\d+)\.json$/)[1],10); return na-nb;
  });
  let combined='';
  sliceFiles.forEach(f=>{ try { const o=JSON.parse(fs.readFileSync(path.join(BRONZE_DIR,f),'utf8')); combined += (combined?'\n':'') + (o.text||o.rawText||''); } catch(e){ /* ignore */ } });
  return combined;
}

function findClusters(lines){
  const clusters=[]; let i=0; const N=lines.length;
  while(i<N){
    if(!/\$[0-9]/.test(lines[i]||'')){ i++; continue; }
    // potential start: look ahead to see if enough dollar lines in next 80
    const win = lines.slice(i, i+80);
    const moneyIdx = win.map((l,idx)=> /\$[0-9]/.test(l||'') ? idx : -1).filter(x=>x>=0);
    if(moneyIdx.length < 4){ i++; continue; }
    // expand cluster until break conditions
    let end = i; let nonDollarRun=0;
    for(let j=i;j<Math.min(N,i+120);j++){
      const line = lines[j]||'';
      if(/^(Goal|Objective|Section|Table\s+\d+|Implementation Plan)/i.test(line)) break;
      if(/\$[0-9]/.test(line)){ nonDollarRun=0; end=j; }
      else { nonDollarRun++; if(nonDollarRun>3) break; }
    }
    if(end>i){
      const slice = lines.slice(i, end+1);
      const moneyLines = slice.filter(l=>/\$[0-9]/.test(l));
      const headerSignature = moneyLines[0]?.replace(/\s+/g,' ').trim().slice(0,120) || '';
      clusters.push({ startLine: i+1, endLine: end+1, moneyLineCount: moneyLines.length, sample: slice.slice(0,12), headerSignature });
      i = end + 1;
    } else {
      i++;
    }
  }
  return clusters;
}

function main(){
  const auditArgIndex = process.argv.indexOf('--audit');
  const outArgIndex = process.argv.indexOf('--out');
  const auditPath = auditArgIndex!==-1 ? process.argv[auditArgIndex+1] : path.join(CWD,'audit_cost_coverage_full.json');
  const outPath = outArgIndex!==-1 ? process.argv[outArgIndex+1] : path.join(CWD,'missing_cost_clusters.json');
  const audit = loadAudit(auditPath);
  const missing = computeMissing(audit);
  if(!missing.length){ console.log('[info] No missing reports detected.'); return; }
  console.log(`[info] scanning ${missing.length} missing reports for cost-like clusters...`);
  const result = { generatedAt: new Date().toISOString(), missingCount: missing.length, reports: [] };
  missing.forEach(id => {
    const bronzeText = loadBronzeMerged(id);
    if(!bronzeText){
      result.reports.push({ id, clusters: [], note: 'no bronze text' });
      return;
    }
    const lines = bronzeText.split(/\r?\n/);
    const clusters = findClusters(lines);
    result.reports.push({ id, clusterCount: clusters.length, clusters });
    console.log(`[clusters] ${id} -> ${clusters.length}`);
  });
  fs.writeFileSync(outPath, JSON.stringify(result,null,2));
  console.log('[WROTE]', outPath);
  // Quick summary of top signatures
  const sigCounts = {};
  result.reports.forEach(r=> r.clusters?.forEach(c=>{ sigCounts[c.headerSignature] = (sigCounts[c.headerSignature]||0)+1; }));
  const ranked = Object.entries(sigCounts).sort((a,b)=> b[1]-a[1]).slice(0,10);
  if(ranked.length){
    console.log('\nTop header-like signatures among clusters:');
    ranked.forEach(([sig,count])=> console.log(` ${count}x :: ${sig}`));
  }
}

main();
