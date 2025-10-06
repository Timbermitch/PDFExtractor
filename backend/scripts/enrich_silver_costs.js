#!/usr/bin/env node
/**
 * Enrich existing silver reports with cost table parsing by re-running parseCostTable
 * over reconstructed sections derived from merged bronze rawText. Does not disturb
 * existing goals/BMPs; only injects cost artifacts if absent or empty.
 */
import fs from 'fs';
import path from 'path';
import { parseCostTable } from '../services/reportBuilder.js';

const BRONZE_DIR = path.join(process.cwd(), 'backend', 'data', 'bronze');
const SILVER_DIR = path.join(process.cwd(), 'backend', 'data', 'silver');

function collectBronzeSlices(slug){
  // Prefer consolidated file if present
  const consolidated = path.join(BRONZE_DIR, slug + '.json');
  if(fs.existsSync(consolidated)) return [consolidated];
  return fs.readdirSync(BRONZE_DIR)
    .filter(f => f.startsWith(slug + '-') && /-\d+\.json$/.test(f))
    .map(f => path.join(BRONZE_DIR, f))
    .sort((a,b) => {
      const na = parseInt(a.match(/-(\d+)\.json$/)[1],10);
      const nb = parseInt(b.match(/-(\d+)\.json$/)[1],10);
      return na - nb;
    });
}

function reconstructRaw(slug){
  const files = collectBronzeSlices(slug);
  if(!files.length) return null;
  const parts = [];
  for(const file of files){
    try {
      const obj = JSON.parse(fs.readFileSync(file,'utf8'));
      const text = obj.rawText || obj.text || '';
      if(text) parts.push(text);
    } catch(e){ /* ignore */ }
  }
  if(!parts.length) return null;
  return parts.join('\n\f\n');
}

function sectionizeForCosts(raw){
  const lines = raw.split(/\r?\n/);
  // Minimal heuristic: Keep full lines; seed into a pseudo section so pattern scanner sees contiguous lines.
  // We'll provide multiple buckets to maximize detection reuse.
  const sections = { BMPs: [], Implementation: [], uncategorized: [] };
  for(const l of lines){
    const t = l.trim();
    if(!t) continue;
    // Route cost-looking lines to BMPs; others to uncategorized
    if(/\$[0-9]/.test(t) || /Practice\s+Units|Code\s+Practice|Estimated Cost|Unit Cost|Total Cost/i.test(t)){
      sections.BMPs.push(t);
    } else {
      sections.uncategorized.push(t);
    }
  }
  return sections;
}

async function main(){
  const silverFiles = fs.readdirSync(SILVER_DIR).filter(f=>f.endsWith('.json'));
  let updated = 0;
  for(const file of silverFiles){
    const full = path.join(SILVER_DIR, file);
    const report = JSON.parse(fs.readFileSync(full,'utf8'));
    // Skip synthetic or already enriched (has any bmpCostTablesNormalized entries)
    if(report?.bmpCostTablesNormalized && report.bmpCostTablesNormalized.length){
      continue;
    }
    const slug = report.id || file.replace(/\.json$/,'');
    const raw = reconstructRaw(slug);
    if(!raw){
      continue;
    }
    const sections = sectionizeForCosts(raw);
    let costArtifacts = parseCostTable(sections);
    if(!costArtifacts.bmpCostTablesNormalized || !costArtifacts.bmpCostTablesNormalized.length){
      // Fallback: feed ALL lines as one section to maximize pattern detection
      const allLines = raw.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
      costArtifacts = parseCostTable({ ALL: allLines });
    }
    if(costArtifacts.bmpCostTablesNormalized && costArtifacts.bmpCostTablesNormalized.length){
      // Inject fields while preserving existing structure
      report.bmpCostTable = costArtifacts.bmpCostTable;
      report.bmpCostTableNormalized = costArtifacts.bmpCostTableNormalized;
      report.bmpCostTables = costArtifacts.bmpCostTables;
      report.bmpCostTablesNormalized = costArtifacts.bmpCostTablesNormalized;
      report.metadata = report.metadata || {};
      report.metadata.costPatternsDetected = costArtifacts.bmpCostTablesNormalized
        .filter(t=>t?.patternId)
        .map(t=>({ id: t.patternId, title: t.title, confidence: t.patternConfidence || null, totalReported: t.totalReported ?? null, totalComputed: t.totalComputed ?? null }));
      report.metadata.enrichedCosts = true;
      fs.writeFileSync(full, JSON.stringify(report,null,2));
      updated++;
      console.log(`[enrich] ${slug} cost tables added (${costArtifacts.bmpCostTablesNormalized.length})`);
    }
  }
  console.log(`[done] enrichment complete; updated=${updated}`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
