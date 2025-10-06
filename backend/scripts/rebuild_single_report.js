#!/usr/bin/env node
// Regenerates a single silver report JSON from its bronze rawText using current extraction logic.
// Usage: node backend/scripts/rebuild_single_report.js <sourceId>
import fs from 'fs';
import path from 'path';
import { buildStructuredReport } from '../services/reportBuilder.js';

function loadBronze(sourceId){
  const candidates = [
    path.join(process.cwd(),'backend','data','bronze',`${sourceId}.json`),
    path.join(process.cwd(),'data','bronze',`${sourceId}.json`)
  ];
  const p = candidates.find(f=>fs.existsSync(f));
  if(p){
    return { bronze: JSON.parse(fs.readFileSync(p,'utf8')), actualId: sourceId, alias: null };
  }
  // Attempt alias resolution: look for year-suffixed variants (e.g., sourceId-2004.json)
  const bronzeDir = path.join(process.cwd(),'data','bronze');
  if(!fs.existsSync(bronzeDir)) throw new Error('Bronze not found for '+sourceId);
  const files = fs.readdirSync(bronzeDir).filter(f=>f.endsWith('.json'));
  // Accept patterns like <slug>-YYYY.json, <slug>-YYYY-N.json, or <slug>-YYYY-<part>.json
  const yearRegex = new RegExp('^'+sourceId.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$')+'-(19|20)\\d{2}(?:-(?:part)?\\d+)?\\.json$');
  const matches = files.filter(f=> yearRegex.test(f));
  if(!matches.length){
    // Secondary strategy: find files that start with sourceId and have -YYYY-part pattern even if first step regex missed
    const loose = files.filter(f=> f.startsWith(sourceId+'-') && /(19|20)\d{2}-(?:part)?\d+\.json$/.test(f));
    if(loose.length){
      matches.push(...loose);
    }
  }
  if(!matches.length) throw new Error('Bronze not found for '+sourceId);
  // Prefer longest (multi-part) or largest size
  matches.sort((a,b)=>{
    const sa = fs.statSync(path.join(bronzeDir,a)).size;
    const sb = fs.statSync(path.join(bronzeDir,b)).size;
    return sb - sa;
  });
  // Determine base year variant (strip trailing -N part index if present)
  const primary = matches[0]
    .replace(/-(?:part)?\d+\.json$/,'') // drop trailing -1 or -part1 etc
    .replace(/\.json$/,'');
  // Collect multi-part segments for that primary
  const partRegex = new RegExp('^'+primary.replace(/[-/\\^$*+?.()|[\]{}]/g,'\\$')+'-(?:part)?(\\d+)\\.json$');
  const partFiles = files.filter(f=> partRegex.test(f)).sort((a,b)=>{
    const pa = parseInt(a.match(partRegex)[1],10); const pb = parseInt(b.match(partRegex)[1],10); return pa-pb;
  });
  let combinedText = '';
  let combinedLength = 0;
  let representative = null;
  if(partFiles.length){
    partFiles.forEach(f=>{
      const obj = JSON.parse(fs.readFileSync(path.join(bronzeDir,f),'utf8'));
      representative = representative || obj;
      const t = obj.rawText || obj.text || '';
      combinedText += (combinedText? '\n' : '') + t;
      combinedLength += (t? t.length : 0);
    });
  } else {
    // Single file case (with year variant only)
    representative = JSON.parse(fs.readFileSync(path.join(bronzeDir,matches[0]),'utf8'));
    combinedText = representative.rawText || representative.text || '';
    combinedLength = combinedText.length;
  }
  // Build synthetic bronze object
  const synthetic = { ...representative, rawText: combinedText, combinedParts: partFiles.length || undefined, length: combinedLength };
  const actualId = primary; // e.g. sourceId-2004
  return { bronze: synthetic, actualId, alias: sourceId };
}

function naiveSectionize(raw){
  // Extremely simple placeholder: split lines and bucket those mentioning cost/table tokens into a pseudo "BMPs" section
  const lines = raw.split(/\r?\n/);
  const sections = { Goals: [], BMPs: [], Implementation: [], Activities: [], Monitoring: [], Outreach: [], Geography: [] };
  lines.forEach((l,idx) => {
    const t = l.trim();
    if(!t) return;
    if(/\bgoal\b/i.test(t) && sections.Goals.length < 25) sections.Goals.push(t);
    // Broaden cost header capture: include funding source table header even without $ on same line
    if(/\$[0-9]|Practice\s+Units|Code\s+Practice|BMP Cost|Estimated Units|Estimated Cost|Unit Cost|Total Cost|Practice\s+Producer\s+NRCS\s+(EPA-?MDEQ|EPA\s*MDEQ)\s+Total/i.test(t)) {
      sections.BMPs.push(t);
      return;
    }
    // Look ahead for following line that is the funding header; include current line too if it references Projected Costs
    if(/Projected\s+Costs.*Practice.*Producer.*NRCS/i.test(t)){
      sections.BMPs.push(t);
    }
  });
  // Narrative dollar block injection: find contiguous >=4 lines each containing a dollar amount and append them (dedup) to BMPs
  const dollarBlockIdxs = [];
  let i=0;
  while(i < lines.length){
    let block=[]; let j=i;
    while(j<lines.length && /\$[0-9]/.test(lines[j]) && lines[j].trim()){ block.push(lines[j].trim()); j++; }
    if(block.length >= 4){
      dollarBlockIdxs.push({ start:i, end:j, lines:block });
      i = j; continue;
    }
    i = j+1;
  }
  if(dollarBlockIdxs.length){
    const existing = new Set(sections.BMPs);
    dollarBlockIdxs.forEach(b=>{
      b.lines.forEach(L=>{ if(!existing.has(L)){ sections.BMPs.push(L); existing.add(L); } });
    });
  }
  return sections;
}

function writeSilver(sourceId, report){
  // Canonical silver directory is backend/data/silver when running from backend cwd
  const canonicalDir = path.join(process.cwd(),'data','silver');
  if(!fs.existsSync(canonicalDir)) fs.mkdirSync(canonicalDir,{ recursive:true });
  const outPath = path.join(canonicalDir,`${sourceId}.json`);
  const backupPath = outPath + '.bak';
  if(fs.existsSync(outPath) && !fs.existsSync(backupPath)){
    fs.copyFileSync(outPath, backupPath);
  }
  fs.writeFileSync(outPath, JSON.stringify(report,null,2));
  return { outPath, backupPath: fs.existsSync(backupPath)? backupPath : null };
}

function relocateLegacyNestedSilvers(){
  // If an accidental nested backend/backend/data/silver exists, move its JSON files into canonical directory
  const nested = path.join(process.cwd(),'backend','data','silver');
  const canonical = path.join(process.cwd(),'data','silver');
  if(!fs.existsSync(nested)) return;
  fs.mkdirSync(canonical,{ recursive:true });
  const files = fs.readdirSync(nested).filter(f=>f.endsWith('.json'));
  for(const f of files){
    const src = path.join(nested,f);
    const dest = path.join(canonical,f);
    try {
      // If canonical already exists, keep the newer (by mtime)
      if(fs.existsSync(dest)){
        const s1 = fs.statSync(src); const s2 = fs.statSync(dest);
        if(s1.mtimeMs <= s2.mtimeMs){ continue; }
        fs.copyFileSync(src,dest);
      } else {
        fs.copyFileSync(src,dest);
      }
    } catch(e){ /* swallow */ }
  }
}

async function main(){
  const sourceId = process.argv[2];
  if(!sourceId){
    console.error('Usage: node backend/scripts/rebuild_single_report.js <sourceId>');
    process.exit(1);
  }
  relocateLegacyNestedSilvers();
  const { bronze, actualId, alias } = loadBronze(sourceId);
  const raw = bronze.rawText || bronze.text;
  if(!raw){
    console.error('Bronze file missing rawText/text. Keys present:', Object.keys(bronze));
    process.exit(2);
  }
  const sections = naiveSectionize(raw);
  // Force inject multi-funding header if present in raw text but filtered out
  if(!sections.BMPs.some(l=> /Practice\s+Producer\s+NRCS\s+(EPA-?MDEQ|EPA\s*MDEQ)\s+Total/i.test(l))){
    const rawLines = raw.split(/\r?\n/);
    const headerIdx = rawLines.findIndex(l=> /Practice\s+Producer\s+NRCS\s+(EPA-?MDEQ|EPA\s*MDEQ)\s+Total/.test(l));
    if(headerIdx !== -1){
      // push header and following 20 lines to BMPs
      sections.BMPs.push(rawLines[headerIdx]);
      for(let k=headerIdx+1;k<headerIdx+25 && k<rawLines.length;k++){
        sections.BMPs.push(rawLines[k]);
      }
    }
  }
  // Provide raw text globally for pattern fallback BEFORE building report
  globalThis.__RAW_WHOLE_TEXT__ = raw;
  const report = buildStructuredReport(sections,{ sourceId: (alias||sourceId), sourceFile: bronze.originalName || bronze.sourceFile || bronze.source || (sourceId + '.pdf') });
  // Always write silver for primary actualId if different (diagnostics) and alias (requested)
  const written = [];
  if(actualId !== (alias||sourceId)){
    const { outPath } = writeSilver(actualId, report);
    written.push(outPath);
  }
  const { outPath, backupPath } = writeSilver(alias||sourceId, report);
  written.push(outPath);
  console.log('Rebuilt silver report(s):');
  written.forEach(p=> console.log('  -', p));
  if(backupPath) console.log('Backup saved at:', backupPath);
  console.log('Pattern detections:', report.metadata?.costPatternsDetected || []);
  if(!(report.metadata?.costPatternsDetected||[]).length){
    console.warn('No pattern detections found; sectionization may be too naive or patterns not matched.');
  }
}

main().catch(e=>{ console.error(e); process.exit(99); });
