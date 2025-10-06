#!/usr/bin/env node
/**
 * Regression test: ensures BMP fallback + refinement logic captures expected BMP names
 * from cost tables and summary lines (e.g., Ellison Creek, Steele Bayou cases).
 *
 * Usage:
 *   node backend/scripts/assertBMPFallback.js <reportId> [--expect name1,name2,...]
 * Examples:
 *   node backend/scripts/assertBMPFallback.js ellison-creek-9-key-element-plan-2021-13 
 *   node backend/scripts/assertBMPFallback.js steele-bayou-watershed-plan-2009 --expect "Ag BMP,Noxious Aquatics,Fisheries Management"
 *
 * Behavior:
 * - Reprocesses the given bronze file into Silver.
 * - Loads the resulting Silver JSON.
 * - Checks that each expected BMP name (default set if --expect omitted) is present (case-insensitive).
 * - Exits non-zero on any missing expectation.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { extractSections } from '../services/sectionExtractor.js';
import { classifyAmbiguous } from '../services/classifier.js';
import { buildStructuredReport } from '../services/reportBuilder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, '..');

async function buildSilver(id){
  const bronzePath = path.join(ROOT,'data','bronze',`${id}.json`);
  if(!fs.existsSync(bronzePath)) throw new Error('Bronze not found: '+ bronzePath);
  const bronze = JSON.parse(fs.readFileSync(bronzePath,'utf-8'));
  const sections = extractSections(bronze.rawText||'');
  const classified = await classifyAmbiguous(sections);
  let structured = buildStructuredReport(classified, { sourceId:id, sourceFile:`${id}.pdf` });
  structured = { ...structured, id };
  const silverPath = path.join(ROOT,'data','silver',`${id}.json`);
  fs.writeFileSync(silverPath, JSON.stringify(structured,null,2));
  return structured;
}

function parseArgs(){
  const args = process.argv.slice(2);
  if(!args.length){
    console.error('ERROR: reportId required');
    process.exit(2);
  }
  const reportId = args[0];
  let expectList = null;
  for(let i=1;i<args.length;i++){
    if(args[i]==='--expect'){
      expectList = args[i+1] ? args[i+1].split(',').map(s=>s.trim()).filter(Boolean) : [];
    }
  }
  return { reportId, expectList };
}

function defaultExpect(reportId){
  // Provide narrow defaults keyed by known tricky reports; else empty set
  if(/ellison-creek/.test(reportId)){
    return ['Sediment Basin','Cover Crops','Streambank and Shoreline Protection'];
  }
  if(/steele-bayou/.test(reportId)){
    return ['Ag BMP','Noxious Aquatics','Fisheries Management'];
  }
  return [];
}

(async function main(){
  const { reportId, expectList } = parseArgs();
  const expected = expectList && expectList.length ? expectList : defaultExpect(reportId);
  if(!expected.length){
    console.log('[assertBMPFallback] No expected names provided and no defaults matched. Nothing to assert.');
    process.exit(0);
  }
  console.log('[assertBMPFallback] Building silver for', reportId, '...');
  const silver = await buildSilver(reportId);
  const namesLower = new Set((silver.bmps||[]).map(b=> (b.name||'').toLowerCase()));
  const missing = expected.filter(e => !namesLower.has(e.toLowerCase()));
  if(missing.length){
    console.error('\n[assertBMPFallback] FAIL: Missing BMP(s):');
    missing.forEach(m=> console.error(' -', m));
    console.error('\nExtracted BMP names (first 25):');
    (silver.bmps||[]).slice(0,25).forEach(b=> console.error(' *', b.name));
    process.exit(1);
  }
  console.log('[assertBMPFallback] PASS: All expected BMPs present:', expected.join(', '));
  // Extra info: show provenance for expected
  expected.forEach(e => {
    const hit = silver.bmps.find(b=> (b.name||'').toLowerCase() === e.toLowerCase());
    if(hit){
      console.log('  >', e, 'source=', hit.source, 'category=', hit.category, 'confidence=', hit.confidence);
    }
  });
})();
