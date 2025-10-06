#!/usr/bin/env node
// Verifies BMP fallback triggers when no BMP section is present but bronze narrative includes 'These BMPs include:' list.
// Usage: node backend/scripts/test_bmp_fallback.js <sourceId>
import fs from 'fs';
import path from 'path';
import { buildStructuredReport } from '../services/reportBuilder.js';

async function main(){
  const sourceId = process.argv[2];
  if(!sourceId){
    console.error('Source ID required. Example: node backend/scripts/test_bmp_fallback.js old-fort-bayou-watershed-plan-2019');
    process.exit(1);
  }
  // Load bronze raw
  const bronzePaths = [
    path.join(process.cwd(),'backend','data','bronze',`${sourceId}.json`),
    path.join(process.cwd(),'data','bronze',`${sourceId}.json`)
  ];
  const bronzePath = bronzePaths.find(p=>fs.existsSync(p));
  if(!bronzePath){
    console.error('Bronze file not found for', sourceId);
    process.exit(2);
  }
  const bronze = JSON.parse(fs.readFileSync(bronzePath,'utf8'));
  // Minimal fake sectioning: intentionally omit BMPs section to stimulate fallback
  const sections = { Goals: [], Implementation: [], Outreach: [], Monitoring: [], Geography: [], BMPs: [] };
  // Provide some context lines extracted from bronze to mimic typical preprocessing if needed.
  // (We do not attempt real section segmentation here; fallback logic only needs empty sections.BMPs and sourceId.)
  const report = buildStructuredReport(sections,{ sourceId, sourceFile: bronzePath });
  const { bmps, metadata } = report;
  if(!metadata.bmpFallbackApplied){
    console.error('FAIL: bmpFallbackApplied flag not set. Extracted', bmps.length, 'BMPs');
    process.exit(3);
  }
  if(bmps.length === 0){
    console.error('FAIL: No BMPs extracted via fallback.');
    process.exit(4);
  }
  console.log('PASS: BMP fallback applied. Count =', bmps.length);
  console.log('Sample BMP names:', bmps.slice(0,8).map(b=>b.name).join('; '));
}
main().catch(e=>{ console.error(e); process.exit(99); });
