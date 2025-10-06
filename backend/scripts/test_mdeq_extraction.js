#!/usr/bin/env node
// Batch extraction test for MDEQ raw PDFs with concurrency, resume & incremental writes.
// Usage:
//   node scripts/test_mdeq_extraction.js [--limit N] [--concurrency K] [--resume] [--out custom.json]
// Writes results JSON (default: backend/data/mdeq_extraction_results.json)
// and a rolling partial file (same path + .partial) after each PDF.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdfParse from 'pdf-parse';
import { extractSections } from '../services/sectionExtractor.js';
import { classifyAmbiguous } from '../services/classifier.js';
import { buildStructuredReport } from '../services/reportBuilder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Resolve raw directory robustly: allow running from repo root or backend/ subfolder.
function resolveRawDir(){
  const cwd = process.cwd();
  const direct = path.join(cwd,'data','raw','mdeq');
  if(fs.existsSync(direct)) return direct;
  // If we are inside backend/, go one level up.
  const upOne = path.join(cwd,'..','data','raw','mdeq');
  if(fs.existsSync(upOne)) return upOne;
  return direct; // fallback (will fail later with clear message)
}
const RAW_DIR = resolveRawDir();

async function loadPdfText(fp){
  const buf = await fs.promises.readFile(fp);
  const data = await pdfParse(buf).catch(e=>{ throw new Error('pdf-parse failed: '+e.message); });
  return data.text || '';
}

async function processOne(file){
  const start = Date.now();
  const fullPath = path.join(RAW_DIR, file);
  try {
    const text = await loadPdfText(fullPath);
    if(!text.trim()) return { file, error:'empty-text' };
    const sections = extractSections(text);
    const classified = await classifyAmbiguous(sections);
    const structured = buildStructuredReport(classified, { sourceId: file.replace(/\.pdf$/i,'') });
    const goals = structured.goals || [];
    const bmps = structured.bmps || [];
    const duration = Date.now()-start;
    return {
      file,
      pagesApprox: (text.match(/\f/g)||[]).length + 1,
      goals: goals.length,
      bmps: bmps.length,
      goalPresence: goals.filter(g=> g._present!==false).length, // present guard may run later
      bmpPresence: bmps.filter(b=> b._present!==false).length,
      durationMs: duration,
      zeroGoal: goals.length===0,
      zeroBMP: bmps.length===0,
      sampleGoal: goals[0]?.title?.slice(0,140) || null,
      sampleBMP: bmps[0]?.name?.slice(0,140) || null
    };
  } catch(e){
    return { file, error: e.message };
  }
}

function parseArgs(){
  const args = process.argv.slice(2);
  const cfg = { limit:null, concurrency:2, resume:false, out:null };
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(a==='--limit') cfg.limit=parseInt(args[++i],10);
    else if(a==='--concurrency') cfg.concurrency=parseInt(args[++i],10);
    else if(a==='--resume') cfg.resume=true;
    else if(a==='--out') cfg.out=args[++i];
  }
  if(!cfg.concurrency || cfg.concurrency<1) cfg.concurrency=1;
  return cfg;
}

async function main(){
  const cfg = parseArgs();
  if(!fs.existsSync(RAW_DIR)){
    console.error('[fatal] raw MDEQ directory not found:', RAW_DIR); process.exit(1);
  }
  let files = (await fs.promises.readdir(RAW_DIR)).filter(f=>/\.pdf$/i.test(f)).sort();
  if(cfg.limit) files = files.slice(0,cfg.limit);
  function resolveOutPath(){
    if(cfg.out) return path.resolve(cfg.out);
    // If running inside backend/, prefer ./data
    const inBackend = path.basename(process.cwd())==='backend';
    const candidate1 = inBackend ? path.join(process.cwd(),'data','mdeq_extraction_results.json') : path.join(process.cwd(),'backend','data','mdeq_extraction_results.json');
    if(fs.existsSync(path.dirname(candidate1))) return candidate1;
    // Fallback: try sibling backend/data if inside root w/out structure created yet
    const alt = path.join(process.cwd(),'backend','data','mdeq_extraction_results.json');
    return alt;
  }
  const outPath = resolveOutPath();
  const partialPath = outPath + '.partial';
  const results = [];
  const seen = new Set();
  if(cfg.resume && fs.existsSync(partialPath)){
    try { const partial = JSON.parse(fs.readFileSync(partialPath,'utf-8')); (partial.results||[]).forEach(r=>{ results.push(r); seen.add(r.file); }); console.log('[resume] loaded', results.length, 'existing results'); } catch(e){ console.warn('[resume] failed to parse partial file:', e.message); }
  }
  const remaining = files.filter(f=> !seen.has(f));
  console.log(`[info] Processing ${remaining.length} PDFs (total target ${files.length}) with concurrency=${cfg.concurrency}`);
  let active = 0; let idx = 0; let done=0; let errorCount=0;
  const startAll = Date.now();
  async function spawn(){
    if(idx>=remaining.length) return;
    const file = remaining[idx++]; active++;
    try { const r = await processOne(file); results.push(r); if(r.error) errorCount++; } catch(e){ results.push({file, error:e.message}); errorCount++; }
    done++; active--; if(done % 3 ===0){ // incremental write every 3 docs
      const partial = { generatedAt: new Date().toISOString(), count: results.length, results };
      try { fs.writeFileSync(partialPath, JSON.stringify(partial,null,2)); } catch(e){ console.warn('[partial-write] failed:', e.message); }
    }
    if(done % 10 ===0){
      const totalGoals = results.filter(r=>!r.error).reduce((a,r)=>a+r.goals,0);
      const totalBMPs = results.filter(r=>!r.error).reduce((a,r)=>a+r.bmps,0);
      process.stdout.write(`\n[progress] ${done}/${remaining.length} goals=${totalGoals} bmps=${totalBMPs} errors=${errorCount}\n`);
    }
    if(idx < remaining.length) spawn();
  }
  const toLaunch = Math.min(cfg.concurrency, remaining.length);
  for(let i=0;i<toLaunch;i++) spawn();
  // wait for completion
  while(done < remaining.length){ await new Promise(r=> setTimeout(r,150)); }
  const duration = ((Date.now()-startAll)/1000).toFixed(1);
  const zeroGoals = results.filter(r=> r.zeroGoal && !r.error);
  const zeroBMPs = results.filter(r=> r.zeroBMP && !r.error);
  const errors = results.filter(r=> r.error);
  const totalGoals = results.filter(r=>!r.error).reduce((a,r)=> a+r.goals,0);
  const totalBMPs = results.filter(r=>!r.error).reduce((a,r)=> a+r.bmps,0);
  const avgGoals = (totalGoals / Math.max(1,(results.length-errors.length))).toFixed(1);
  const avgBMPs = (totalBMPs / Math.max(1,(results.length-errors.length))).toFixed(1);
  console.log('\n=== Extraction Summary ===');
  console.log('Files processed:', results.length, 'Elapsed(s):', duration);
  console.log('Errors:', errors.length);
  console.log('Zero Goal files:', zeroGoals.length, zeroGoals.length? zeroGoals.slice(0,8).map(z=>z.file).join(', ')+ (zeroGoals.length>8?' …':''):'');
  console.log('Zero BMP files:', zeroBMPs.length, zeroBMPs.length? zeroBMPs.slice(0,8).map(z=>z.file).join(', ')+ (zeroBMPs.length>8?' …':''):'');
  console.log('Total Goals:', totalGoals, 'Avg/Doc:', avgGoals);
  console.log('Total BMPs:', totalBMPs, 'Avg/Doc:', avgBMPs);
  const out = { generatedAt: new Date().toISOString(), count: results.length, results, summary:{ totalGoals, totalBMPs, avgGoals:Number(avgGoals), avgBMPs:Number(avgBMPs), zeroGoal: zeroGoals.length, zeroBMP: zeroBMPs.length, errors: errors.length, elapsedSeconds: Number(duration) } };
  try { fs.writeFileSync(outPath, JSON.stringify(out,null,2)); console.log('Results JSON:', outPath); fs.existsSync(partialPath)&&fs.unlinkSync(partialPath); } catch(e){ console.error('[write-final] failed:', e.message); }
  if(errors.length){ console.log('\nErrors Detail (first 12):'); errors.slice(0,12).forEach(e=> console.log('-', e.file, '::', e.error)); }
}

main().catch(e=>{ console.error('[fatal]', e); process.exit(1); });
