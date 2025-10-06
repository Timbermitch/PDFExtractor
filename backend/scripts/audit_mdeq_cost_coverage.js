#!/usr/bin/env node
/**
 * Audit MDEQ corpus cost coverage & truncation risk.
 * Scans bronze JSON (proxy for raw PDFs) and silver JSON for:
 *  - Presence of any normalized cost tables (patternId or legacy) per report
 *  - Adaptive fallback usage count
 *  - Suspected truncation (very long bronze segment count or abrupt 18000-char boundary markers if present)
 *  - Reports with zero cost detection
 *
 * Output: summary to stdout + optional JSON (--json path)
 */
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ROOT = process.cwd();
const SILVER_DIR = path.join(ROOT,'data','silver');
const BRONZE_DIR = path.join(ROOT,'data','bronze');
const OUT_JSON = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json')+1] : null;

function list(dir){ return fs.existsSync(dir)? fs.readdirSync(dir).filter(f=>f.endsWith('.json')): []; }

function load(dir,f){ return JSON.parse(fs.readFileSync(path.join(dir,f),'utf8')); }

const silverFiles = list(SILVER_DIR);
const bronzeFiles = list(BRONZE_DIR);

const bronzeIndex = Object.fromEntries(bronzeFiles.map(f=>[f.replace(/\.json$/,''), f]));

const reportStats = [];
let totalReports=0, withCost=0, withAdaptive=0, suspectedTrunc=0;

// Normalize slug families: collapse -YYYY and -YYYY-N variants to base logical slug
function baseSlug(id){
  // pattern: optional year/part suffix: -YYYY or -YYYY-N
  const m = id.match(/^(.*?)-(19|20)\d{2}(?:-(?:part)?\d+)?$/);
  return m? m[1] : id;
}

// Precompute ingestion quality for bronze
const bronzeQuality = {};
bronzeFiles.forEach(f=>{
  try {
    const obj = load(BRONZE_DIR,f);
    const raw = (obj.rawText || obj.text || '').replace(/\r/g,'');
    const nonWs = raw.replace(/\s+/g,'');
    const dollarCount = (raw.match(/\$/g)||[]).length;
    const lineCount = raw.split(/\n/).length;
    const printable = raw.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g,'');
    const isMostlyBlank = nonWs.length < 50 && dollarCount===0; // heuristic threshold
    bronzeQuality[f.replace(/\.json$/,'')] = { nonWs: nonWs.length, dollarCount, lineCount, isMostlyBlank };
  } catch(e){ bronzeQuality[f.replace(/\.json$/,'')] = { error:true }; }
});

const familyStats = new Map();

for(const file of silverFiles){
  const id = file.replace(/\.json$/,'');
  const logical = baseSlug(id);
  const silver = load(SILVER_DIR,file);
  totalReports++;
  const tables = silver.bmpCostTablesNormalized || [];
  const legacy = silver.bmpCostTableNormalized ? [silver.bmpCostTableNormalized] : [];
  const allTables = [...tables, ...legacy];
  const hasCost = allTables.length > 0;
  if(hasCost) withCost++;
  const adaptiveTables = allTables.filter(t=>t.patternId==='adaptive_generic_costs');
  if(adaptiveTables.length) withAdaptive++;
  let truncFlag=false; let bronzeLen=null; let segmentCount=null;
  const bronzeFile = bronzeIndex[id];
  if(bronzeFile){
    try {
      const bronze = load(BRONZE_DIR, bronzeFile);
      const text = JSON.stringify(bronze); // heuristic only
      bronzeLen = text.length;
      // detect repeated 18000 char segmentation artifacts or explicit markers sometimes used earlier
      if(/18000/.test(text) || /TRUNCATED_SEGMENT_MARKER/.test(text)) truncFlag=true;
      if(Array.isArray(bronze.pages)) segmentCount = bronze.pages.length;
    } catch(e){ /* ignore */ }
  }
  if(truncFlag) suspectedTrunc++;
  const ingest = bronzeQuality[id] || {};
  reportStats.push({ id, logicalId: logical, hasCost, adaptive: adaptiveTables.length>0, tableCount: allTables.length, adaptiveCount: adaptiveTables.length, bronzeLen, segmentCount, suspectedTrunc: truncFlag, ingestionBlank: ingest.isMostlyBlank||false, ingestionNonWs: ingest.nonWs, ingestionDollarCount: ingest.dollarCount });
  // Aggregate per logical family (choose the best representative: any with cost > without; prefer non-blank)
  const fam = familyStats.get(logical) || { id: logical, variants: [], variantCount:0, anyCost:false, anyAdaptive:false, representative:null };
  fam.variants.push(id);
  fam.variantCount = fam.variants.length;
  if(hasCost) fam.anyCost = true;
  if(adaptiveTables.length) fam.anyAdaptive = true;
  if(!fam.representative){
    fam.representative = id;
  } else {
    const repStats = reportStats.find(r=>r.id===fam.representative);
    // Prefer a variant with cost over one without; otherwise prefer non-blank over blank; else keep existing
    if(hasCost && !repStats.hasCost){ fam.representative = id; }
    else if(!hasCost && repStats && !repStats.hasCost){
      const curIngest = ingest.isMostlyBlank?1:0; const repIngest = (bronzeQuality[fam.representative]||{}).isMostlyBlank?1:0;
      if(curIngest < repIngest) fam.representative = id;
    }
  }
  familyStats.set(logical, fam);
}

reportStats.sort((a,b)=> (a.hasCost===b.hasCost)? a.id.localeCompare(b.id): (a.hasCost? -1:1));

// Family-level coverage (logical unique reports)
const families = Array.from(familyStats.values());
const familyWithCost = families.filter(f=>f.anyCost).length;
const familyWithoutCost = families.length - familyWithCost;
const familyAdaptive = families.filter(f=>f.anyAdaptive).length;
const blankFamilies = families.filter(f=> f.variants.every(v=> (reportStats.find(r=>r.id===v)?.ingestionBlank))).length;

const summary = {
  totalReports,
  withCost,
  withoutCost: totalReports - withCost,
  coveragePct: totalReports? (withCost/totalReports): 0,
  logicalFamilies: families.length,
  familiesWithCost: familyWithCost,
  familiesWithoutCost: familyWithoutCost,
  familyCoveragePct: families.length? (familyWithCost / families.length) : 0,
  familiesWithAdaptive: familyAdaptive,
  blankFamilies,
  withAdaptive,
  suspectedTrunc,
  timestamp: new Date().toISOString()
};

function formatPercent(p){ return (p*100).toFixed(1)+'%'; }

console.log('\nMDEQ Cost Coverage Audit');
console.log('==========================');
console.log(`Total reports (variants):   ${summary.totalReports}`);
console.log(`Variant coverage:           ${withCost}/${summary.totalReports} (${formatPercent(summary.coveragePct)})`);
console.log(`Logical families:           ${summary.logicalFamilies}`);
console.log(`Families with cost:         ${summary.familiesWithCost}/${summary.logicalFamilies} (${formatPercent(summary.familyCoveragePct)})`);
console.log(`Families blank ingestion:   ${summary.blankFamilies}`);
console.log(`Families without cost:      ${summary.familiesWithoutCost}`);
console.log(`Variants using adaptive:    ${withAdaptive}`);
console.log(`Families using adaptive:    ${summary.familiesWithAdaptive}`);
console.log(`Suspected truncation:       ${suspectedTrunc}`);

const noCost = reportStats.filter(r=>!r.hasCost);
const familyNoCost = families.filter(f=>!f.anyCost);
if(familyNoCost.length){
  console.log('\nLogical reports missing cost tables (first 30):');
  familyNoCost.slice(0,30).forEach(f=> {
    const blank = f.variants.every(v=> (reportStats.find(r=>r.id===v)?.ingestionBlank));
    console.log(` - ${f.id}${blank?' (blank-ingestion)':''}`);
  });
}

if(OUT_JSON){
  const out = { summary, reports: reportStats, families };
  fs.writeFileSync(OUT_JSON, JSON.stringify(out,null,2));
  console.log('\n[WROTE] '+OUT_JSON);
}

// Basic recommendation heuristics
const recs=[];
if(noCost.length) recs.push('Expand patterns or adaptive heuristics to cover '+noCost.length+' reports lacking cost tables.');
if(withAdaptive>0) recs.push('Review adaptive_generic_costs outputs for correctness and consider promoting common formats to explicit patterns.');
if(suspectedTrunc>0) recs.push('Investigate truncation markers in '+suspectedTrunc+' bronze records to ensure full text ingestion.');
if(!recs.length) recs.push('All reports covered with no truncation indicators.');

console.log('\nRecommendations:');
recs.forEach(r=>console.log(' * '+r));

// Exit code non-zero if more than 10% missing cost or any truncation flagged
if((summary.withoutCost/summary.totalReports) > 0.1 || suspectedTrunc>0){
  process.exitCode = 1;
}
