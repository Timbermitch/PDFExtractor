#!/usr/bin/env node
/**
 * Batch test BMP & cost table extraction over merged bronze documents.
 * For each merged JSON in backend/data/bronze_merged:
 *  - Run section extraction + classification + reportBuilder
 *  - Count BMPs, cost tables, normalized totals
 *  - Flag if rawText looks truncated (contains char limit signature or length exactly multiple of 18000 in original parts)
 * Output summary stats and per-file sample (top 25 by BMP count).
 */
import fs from 'fs';
import path from 'path';
import { extractSections } from '../services/sectionExtractor.js';
import { classifyAmbiguous } from '../services/classifier.js';
import { buildStructuredReport } from '../services/reportBuilder.js';

const mergedDir = path.join(process.cwd(), 'backend', 'data', 'bronze_merged');
if(!fs.existsSync(mergedDir)){
  console.error('[fatal] merged directory not found. Run merge_bronze_multipart.js first.');
  process.exit(1);
}

const files = fs.readdirSync(mergedDir).filter(f=>f.endsWith('.json'));
if(!files.length){
  console.error('[fatal] no merged files present.');
  process.exit(1);
}

const limit = process.env.LIMIT ? parseInt(process.env.LIMIT,10) : null; // optionally limit run for speed
const sampleFiles = limit ? files.slice(0, limit) : files;

const results = [];
let aggregate = { docs:0, totalBMPs:0, docsWithBMPs:0, totalCostTables:0, docsWithCostTables:0, truncatedSuspects:0 };

function detectTruncation(raw){
  // Heuristic: leftover markers or suspicious absence of trailing punctuation at end over long length.
  if(!raw) return false;
  if(/\bFigure\s+\d+(?:\s*)?$/.test(raw.slice(-120))) return true;
  if(/\bElement\s+[A-I]:\s*$/.test(raw.slice(-40))) return true;
  return false;
}

for(const f of sampleFiles){
  let json;
  try { json = JSON.parse(fs.readFileSync(path.join(mergedDir, f),'utf-8')); } catch(e){ console.warn('[warn] parse failed', f, e.message); continue; }
  const rawText = json.rawText || '';
  const sections = extractSections(rawText);
  const classified = await classifyAmbiguous(sections);
  const report = buildStructuredReport(classified, { sourceId: json.id, sourceFile: f });
  const bmpCount = report?.bmps?.length || 0;
  const costTables = report?.bmpCostTablesNormalized || report?.bmpCostTables || [];
  const costTableCount = Array.isArray(costTables)? costTables.length: 0;
  const truncated = detectTruncation(rawText);
  aggregate.docs++;
  aggregate.totalBMPs += bmpCount;
  if(bmpCount>0) aggregate.docsWithBMPs++;
  aggregate.totalCostTables += costTableCount;
  if(costTableCount>0) aggregate.docsWithCostTables++;
  if(truncated) aggregate.truncatedSuspects++;
  results.push({ file:f, bmpCount, costTableCount, truncated });
}

results.sort((a,b)=> b.bmpCount - a.bmpCount);
const top = results.slice(0,25);

console.log('BMP Extraction Test Summary');
console.log('============================');
console.log({
  totalDocs: aggregate.docs,
  docsWithBMPs: aggregate.docsWithBMPs,
  pctDocsWithBMPs: (aggregate.docsWithBMPs/aggregate.docs*100).toFixed(1)+'%',
  avgBMPsPerDoc: (aggregate.totalBMPs/aggregate.docs).toFixed(2),
  docsWithCostTables: aggregate.docsWithCostTables,
  pctDocsWithCostTables: (aggregate.docsWithCostTables/aggregate.docs*100).toFixed(1)+'%',
  avgCostTablesPerDoc: (aggregate.totalCostTables/aggregate.docs).toFixed(2),
  truncatedSuspects: aggregate.truncatedSuspects
});
console.log('\nTop 25 by BMP count:');
top.forEach(r => console.log(`${r.file} bmp=${r.bmpCount} costTables=${r.costTableCount} trunc=${r.truncated}`));

// Write machine-readable output
const validationDir = path.join(process.cwd(), 'backend', 'data', 'validation');
if(!fs.existsSync(validationDir)) fs.mkdirSync(validationDir,{recursive:true});
fs.writeFileSync(path.join(validationDir, 'bmp_extraction_test.json'), JSON.stringify({ generatedAt: new Date().toISOString(), aggregate, results: results.slice(0,200) }, null, 2));
console.log('\nSaved data/validation/bmp_extraction_test.json (first 200 records).');
