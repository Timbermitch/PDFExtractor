#!/usr/bin/env node
/**
 * Enrich silver reports by injecting BMP entries derived from cost tables
 * when those BMP names are not already present. Does not remove existing BMPs.
 */
import fs from 'fs';
import path from 'path';

const SILVER_DIR = path.join(process.cwd(), 'backend', 'data', 'silver');

function extractCostRowNames(report){
  const tables = report.bmpCostTables || [];
  const normTables = report.bmpCostTablesNormalized || [];
  const rowNames = new Set();
  tables.forEach(t => {
    if(!t?.table?.columns || !Array.isArray(t.table.rows)) return;
    const firstCol = t.table.columns[0];
    t.table.rows.forEach(r => {
      const raw = r[firstCol];
      if(typeof raw === 'string'){ const n = raw.replace(/\*+$/,'').trim(); if(n) rowNames.add(n); }
    });
  });
  // Also pull from normalized rows if they have 'name'
  normTables.forEach(nt => {
    if(Array.isArray(nt.rows)) nt.rows.forEach(r => { if(r.name) rowNames.add(r.name); });
  });
  return [...rowNames];
}

async function main(){
  const files = fs.readdirSync(SILVER_DIR).filter(f=>f.endsWith('.json'));
  let updated=0, injectedTotal=0;
  for(const f of files){
    const full = path.join(SILVER_DIR,f);
    const report = JSON.parse(fs.readFileSync(full,'utf8'));
    if(!report.bmpCostTables && !report.bmpCostTablesNormalized) continue;
    const existingLower = new Set((report.bmps||[]).map(b=> (b.name||'').toLowerCase()));
    const costNames = extractCostRowNames(report);
    const toInject = costNames.filter(n => !existingLower.has(n.toLowerCase()) && !/^total$/i.test(n));
    if(!toInject.length) continue;
    report.bmps = report.bmps || [];
    toInject.forEach(name => {
      report.bmps.push({ id: `B${report.bmps.length+1}`, name, category: 'General', keyword: null, quantity: null, unit: null, verb: null, confidence: 0.3, source: 'post_enrich:cost_table_row' });
      existingLower.add(name.toLowerCase());
      injectedTotal++;
    });
    // Re-sequence IDs
    report.bmps.forEach((b,i)=> b.id = `B${i+1}`);
    report.metadata = report.metadata || {};
    report.metadata.bmpEnrichedFromCosts = true;
    fs.writeFileSync(full, JSON.stringify(report,null,2));
    updated++;
    console.log(`[bmp-enrich] ${report.id||f} injected ${toInject.length}`);
  }
  console.log(`[done] bmp enrichment complete; reportsUpdated=${updated} totalInjected=${injectedTotal}`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
