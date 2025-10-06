#!/usr/bin/env node
/**
 * Third-pass aggressive cost table enrichment.
 * Targets remaining silver reports without any bmpCostTablesNormalized.
 * Heuristics:
 *  - Scans entire reconstructed bronze text for loose cost row clusters (>=3 consecutive lines containing a dollar sign)
 *  - Detects optional header lines above clusters (keywords: cost, bmp, practice, activity, item, estimate, budget)
 *  - Attempts column inference by splitting on 2+ spaces or tabs; normalizes last money cell as row total
 *  - Computes aggregate total; if a following line within 5 lines contains a larger dollar amount labeled 'Total' uses it as reportedTotal
 *  - Assigns synthetic patternId 'aggressive_loose_cluster' with low confidence (0.55) unless header keywords match stronger pattern raising to 0.6
 * Guardrails:
 *  - Skips clusters whose combined money sum < $5,000 (likely noise)
 *  - Skips clusters where >60% of lines are a single repeating token (avoid legends)
 *  - Caps max lines per cluster at 40
 */
import fs from 'fs';
import path from 'path';
import { parseCostTable } from '../services/reportBuilder.js';

const BRONZE_DIR = path.join(process.cwd(), 'backend', 'data', 'bronze');
const SILVER_DIR = path.join(process.cwd(), 'backend', 'data', 'silver');

function collectBronze(slug){
  const consolidated = path.join(BRONZE_DIR, slug + '.json');
  if(fs.existsSync(consolidated)) return [consolidated];
  return fs.readdirSync(BRONZE_DIR).filter(f=>f.startsWith(slug+'-') && /-\d+\.json$/.test(f))
    .map(f=>path.join(BRONZE_DIR,f))
    .sort((a,b)=>parseInt(a.match(/-(\d+)\.json$/)[1],10)-parseInt(b.match(/-(\d+)\.json$/)[1],10));
}
function reconstruct(slug){
  const files = collectBronze(slug); if(!files.length) return null; const parts=[]; for(const f of files){ try{ const o=JSON.parse(fs.readFileSync(f,'utf8')); const t=o.rawText||o.text||''; if(t) parts.push(t);}catch{}} return parts.join('\n\f\n'); }

function scanLooseClusters(raw){
  const lines = raw.split(/\r?\n/).map(l=>l.replace(/\u00a0/g,' ').trim());
  const clusters=[]; let current=[]; let startIdx=0;
  function flush(){ if(current.length>=3){ clusters.push({ start:startIdx, lines:[...current] }); } current=[]; }
  lines.forEach((l,i)=>{ if(/\$[0-9]/.test(l)){ if(!current.length) startIdx=i; current.push(l); } else { flush(); } }); flush();
  return clusters;
}

function inferTableFromCluster(cluster, allLines){
  const rawLines = cluster.lines.slice(0,40);
  // Basic stop: ensure at least 2 distinct money values
  const moneyVals=[...rawLines.join(' ').matchAll(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/g)].map(m=>m[0]);
  if(new Set(moneyVals).size < 2) return null;
  // Detect preceding header (up to 3 lines before start)
  const headerWindow = allLines.slice(Math.max(0,cluster.start-3), cluster.start).map(s=>s.trim());
  const headerLine = headerWindow.reverse().find(h=>/(cost|estimate|budget|practice|bmp|activity|item)/i.test(h));
  // Determine delimiter strategy: if tabs present prefer split on tabs else 2+ spaces
  const delim = rawLines.some(l=>/\t/.test(l)) ? /\t+/ : / {2,}/;
  const rows=[]; let reportedTotal=null; let sum=0;
  rawLines.forEach(l=>{
    // Skip obvious total lines inside cluster; handle outside
    if(/^total/i.test(l)) return;
    const parts = l.split(delim).map(p=>p.trim()).filter(Boolean);
    // Keep rows with at least one dollar at end
    const moneyMatch = parts[parts.length-1]?.match(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/);
    if(!moneyMatch) return;
    const totalCell = moneyMatch[0];
    // Remove trailing money from previous part join if duplicate
    const cols = parts;
    const numericTotal = parseFloat(totalCell.replace(/[$,]/g,''));
    if(!Number.isNaN(numericTotal)) sum += numericTotal;
    rows.push({ raw: l, columns: cols, total: totalCell, numericTotal });
  });
  if(rows.length < 3) return null;
  if(sum < 5000) return null;
  // Repetition guard
  const firstTokens = rows.map(r=> (r.columns[0]||'').toLowerCase());
  const freq = firstTokens.reduce((a,b)=>{a[b]=(a[b]||0)+1; return a;},{});
  const maxFreq = Math.max(...Object.values(freq));
  if(maxFreq / rows.length > 0.6) return null;
  // Look ahead for explicit total line
  for(let i=cluster.start+rows.length; i<Math.min(cluster.start+rows.length+5, allLines.length); i++){
    const l=allLines[i]; if(!l) continue; if(/total/i.test(l) && /\$[0-9]/.test(l)){ const m=l.match(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/); if(m){ reportedTotal=parseFloat(m[0].replace(/[$,]/g,'')); break; } }
  }
  // Normalize into generic table structure
  // Assume columns: Name, (optional size), Cost
  const tableRows=[]; const normRows=[];
  rows.forEach(r=>{
    const name = r.columns[0];
    let sizePart = '';
    if(r.columns.length > 2){ sizePart = r.columns.slice(1, r.columns.length-1).join(' '); }
    const costCell = r.total;
    tableRows.push({ 'Item': name, 'Size/Amount': sizePart, 'Estimated Cost': costCell });
    normRows.push({ name, rawSize: sizePart, rawCost: costCell, quantity:null, unit:null, unitRaw:null, unitCost:null, totalCost: r.numericTotal });
  });
  if(!tableRows.length) return null;
  const discrepancy = (reportedTotal!=null ? reportedTotal - sum : null);
  return {
    table: { columns:['Item','Size/Amount','Estimated Cost'], rows: tableRows, total: reportedTotal },
    normalized: { rows: normRows, totalReported: reportedTotal, totalComputed: sum, discrepancy, patternId:'aggressive_loose_cluster', patternConfidence: headerLine?0.6:0.55 }
  };
}

function enrichReport(report, raw){
  const result = { added: false, tables: [] };
  if(report.bmpCostTablesNormalized && report.bmpCostTablesNormalized.length) return result; // already has
  const lines = raw.split(/\r?\n/).map(l=>l.replace(/\u00a0/g,' ').trim());
  const clusters = scanLooseClusters(raw);
  const parsedClusters=[];
  clusters.forEach(c=>{ const parsed = inferTableFromCluster(c, lines); if(parsed) parsedClusters.push(parsed); });
  if(!parsedClusters.length) return result;
  // Select the cluster with highest computed total
  parsedClusters.sort((a,b)=> (b.normalized.totalComputed||0) - (a.normalized.totalComputed||0));
  // Merge into report structures
  report.bmpCostTables = (report.bmpCostTables || []).concat(parsedClusters.map((p,i)=>({ id:`aggressive_cluster_${i+1}`, title: 'Loose Cost Cluster', table: p.table, patternId: p.normalized.patternId, patternConfidence: p.normalized.patternConfidence })));
  report.bmpCostTablesNormalized = (report.bmpCostTablesNormalized || []).concat(parsedClusters.map((p,i)=>({ id:`aggressive_cluster_${i+1}`, title:'Loose Cost Cluster', ...p.normalized })));
  if(!report.bmpCostTable && report.bmpCostTables.length){ report.bmpCostTable = report.bmpCostTables[0]; }
  if(!report.bmpCostTableNormalized && report.bmpCostTablesNormalized.length){ report.bmpCostTableNormalized = report.bmpCostTablesNormalized[0]; }
  report.metadata = report.metadata || {}; report.metadata.costPatternsDetected = (report.metadata.costPatternsDetected || []).concat(parsedClusters.map(p=>({ id: p.normalized.patternId, title: 'Loose Cost Cluster', confidence: p.normalized.patternConfidence, totalReported: p.normalized.totalReported, totalComputed: p.normalized.totalComputed })));
  report.metadata.enrichedCostsPass3 = true;
  result.added = true; result.tables = parsedClusters.length;
  return result;
}

async function main(){
  const silverFiles = fs.readdirSync(SILVER_DIR).filter(f=>f.endsWith('.json'));
  let updated=0, tablesAdded=0;
  for(const file of silverFiles){
    const full = path.join(SILVER_DIR, file);
    const report = JSON.parse(fs.readFileSync(full,'utf8'));
    if(report.bmpCostTablesNormalized && report.bmpCostTablesNormalized.length) continue; // skip already enriched
    const slug = report.id || file.replace(/\.json$/,'');
    const raw = reconstruct(slug); if(!raw) continue;
    const enriched = enrichReport(report, raw);
    if(enriched.added){
      fs.writeFileSync(full, JSON.stringify(report,null,2));
      updated++; tablesAdded += enriched.tables;
      console.log(`[pass3] ${slug} clustersAdded=${enriched.tables}`);
    }
  }
  console.log(`[done] pass3 enrichment complete updatedReports=${updated} tablesAdded=${tablesAdded}`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
