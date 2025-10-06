#!/usr/bin/env node
/**
 * Snapshot regression for normalized cost tables.
 * Usage:
 *   node scripts/snapshot_cost_tables.js            # compare against existing snapshots
 *   node scripts/snapshot_cost_tables.js --update   # rewrite snapshots
 *
 * Snapshot schema (per report):
 * { reportId, tables:[ { id,title,patternId,rowCount,totalReported,totalComputed,hash,rowHashes: {nameHash, totalHash} } ], combinedHash }
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ROOT = process.cwd();
const SILVER_DIR = path.join(ROOT,'data','silver');
const FIXTURE_DIR = path.join(ROOT,'test','fixtures','costTables');
const UPDATE = process.argv.includes('--update');

function sha(str){ return crypto.createHash('sha1').update(str,'utf8').digest('hex'); }

function loadReport(file){
  return JSON.parse(fs.readFileSync(path.join(SILVER_DIR,file),'utf8'));
}

function buildSnapshot(report){
  const tables = (report.bmpCostTablesNormalized||[]).map(t=>{
    const rowNames = (t.rows||[]).map(r=>r.name||'').filter(Boolean);
    const rowCosts = (t.rows||[]).map(r=> (r.totalCost!=null? r.totalCost: '')).join('|');
    const nameHash = sha(rowNames.join('|'));
    const totalHash = sha(String(t.totalComputed||'')+"|"+String(t.totalReported||''));
    const tableHash = sha([t.id,t.patternId,rowNames.join('|'),t.totalReported,t.totalComputed].join('||'));
    return {
      id: t.id || 'table_'+sha(t.title||'untitled').slice(0,8),
      title: t.title || null,
      patternId: t.patternId || null,
      rowCount: (t.rows||[]).length,
      totalReported: t.totalReported ?? null,
      totalComputed: t.totalComputed ?? null,
      hash: tableHash,
      rowHashes: { nameHash, totalHash }
    };
  });
  const combinedHash = sha(tables.map(t=>t.hash).sort().join('|'));
  return { reportId: report.id, tables, combinedHash };
}

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }

function loadSnapshot(reportId){
  const p = path.join(FIXTURE_DIR, reportId+'.json');
  if(!fs.existsSync(p)) return null; return JSON.parse(fs.readFileSync(p,'utf8'));
}

function saveSnapshot(snap){
  const p = path.join(FIXTURE_DIR, snap.reportId+'.json');
  fs.writeFileSync(p, JSON.stringify(snap,null,2));
  console.log('[WROTE] '+p);
}

function diffSnapshots(oldSnap,newSnap){
  const diffs=[];
  const oldMap = Object.fromEntries(oldSnap.tables.map(t=>[t.id,t]));
  const newMap = Object.fromEntries(newSnap.tables.map(t=>[t.id,t]));
  // Removed tables
  Object.keys(oldMap).forEach(id=>{ if(!newMap[id]) diffs.push(`REMOVED table ${id}`); });
  // Added tables
  Object.keys(newMap).forEach(id=>{ if(!oldMap[id]) diffs.push(`ADDED table ${id}`); });
  // Modified
  Object.keys(newMap).forEach(id=>{
    if(!oldMap[id]) return;
    const a=oldMap[id], b=newMap[id];
    if(a.hash!==b.hash){
      if(a.rowCount!==b.rowCount) diffs.push(`CHANGED ${id} rowCount ${a.rowCount}->${b.rowCount}`);
      if(a.totalReported!==b.totalReported) diffs.push(`CHANGED ${id} totalReported ${a.totalReported}->${b.totalReported}`);
      if(a.totalComputed!==b.totalComputed) diffs.push(`CHANGED ${id} totalComputed ${a.totalComputed}->${b.totalComputed}`);
      if(a.rowHashes.nameHash!==b.rowHashes.nameHash) diffs.push(`CHANGED ${id} row set hash`);
    }
  });
  if(oldSnap.combinedHash !== newSnap.combinedHash) diffs.push('CHANGED combinedHash');
  return diffs;
}

function main(){
  ensureDir(FIXTURE_DIR);
  const files = fs.readdirSync(SILVER_DIR).filter(f=>f.endsWith('.json'));
  let failures=0; let created=0; let updated=0; let skipped=0;
  for(const file of files){
    const report=loadReport(file);
    if(!report.bmpCostTablesNormalized || !report.bmpCostTablesNormalized.length){ skipped++; continue; }
    const snap=buildSnapshot(report);
    const existing=loadSnapshot(snap.reportId);
    if(!existing){
      if(UPDATE){ saveSnapshot(snap); created++; } else { console.warn('[MISSING SNAPSHOT] '+snap.reportId+' (run with --update to create)'); failures++; }
      continue;
    }
    if(UPDATE){ saveSnapshot(snap); updated++; continue; }
    const diffs=diffSnapshots(existing,snap);
    if(diffs.length){
      console.error('\n[FAIL] '+snap.reportId+' diffs:');
      diffs.forEach(d=>console.error('  - '+d));
      failures++;
    } else {
      console.log('[OK] '+snap.reportId+' unchanged');
    }
  }
  if(UPDATE){
    console.log(`\nSnapshot update complete: created=${created} updated=${updated} skipped(no tables)=${skipped}`);
  } else {
    if(failures){
      console.error(`\nSnapshot regression FAILED: diffs=${failures}`);
      process.exit(1);
    } else {
      console.log(`\nSnapshot regression PASSED: checked=${files.length} withTables=${files.length-skipped}`);
    }
  }
}

main();
