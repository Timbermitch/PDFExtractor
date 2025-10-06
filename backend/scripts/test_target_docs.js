#!/usr/bin/env node
/**
 * Targeted extraction test for specific watershed plans (Old Fort Bayou, Coldwater River, Turkey Creek)
 * Validates capture of new pattern types: practice_unit_nrcs_costs, multi_funding_source_costs, implementation_plan_coded_budget
 */
import fs from 'fs';
import path from 'path';
import { extractSections } from '../services/sectionExtractor.js';
import { classifyAmbiguous } from '../services/classifier.js';
import { buildStructuredReport } from '../services/reportBuilder.js';

const targets = [
  'old-fort-bayou-watershed-plan.json',
  'coldwater-river-watershed-plan-2013.json',
  'turkey-creek-watershed-plan-2006.json'
];

const mergedDir = path.join(process.cwd(), 'backend', 'data', 'bronze_merged');
const out = [];

for(const file of targets){
  const full = path.join(mergedDir, file);
  if(!fs.existsSync(full)){ console.warn('[skip] missing', file); continue; }
  let json; try { json = JSON.parse(fs.readFileSync(full,'utf-8')); } catch(e){ console.error('[error] parse', file, e.message); continue; }
  const sections = extractSections(json.rawText||'');
  const classified = await classifyAmbiguous(sections);
  const report = buildStructuredReport(classified, { sourceId: json.id, sourceFile: file });
  const costTables = report?.bmpCostTablesNormalized || report?.bmpCostTables || [];
  const matchedNew = costTables.filter(t => ['practice_unit_nrcs_costs','multi_funding_source_costs','implementation_plan_coded_budget'].includes(t.patternId));
  out.push({ file, detectedCostTables: costTables.length, newPatternTables: matchedNew.map(t => ({ patternId: t.patternId, columns: t.table?.columns, rowCount: t.table?.rows?.length, discrepancy: t.normalized?.discrepancy })) });
}

console.log('Target Document Pattern Capture');
console.log(JSON.stringify(out, null, 2));

const validationDir = path.join(process.cwd(), 'backend', 'data', 'validation');
if(!fs.existsSync(validationDir)) fs.mkdirSync(validationDir,{recursive:true});
fs.writeFileSync(path.join(validationDir,'target_doc_pattern_test.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results: out }, null, 2));
console.log('Wrote validation/target_doc_pattern_test.json');
