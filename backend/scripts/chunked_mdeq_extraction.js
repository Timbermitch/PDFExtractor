#!/usr/bin/env node
// Chunked + auto-resume orchestrator for MDEQ extraction.
// Processes PDFs in fixed-size chunks, persisting state after every chunk so interruptions lose at most one chunk.
// Usage: node scripts/chunked_mdeq_extraction.js [--chunk 5] [--concurrency 2] [--out final.json] [--state state.json]
// The per-file extraction logic mirrors test_mdeq_extraction.js but aggregates progressively.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdfParse from 'pdf-parse';
import { extractSections } from '../services/sectionExtractor.js';
import { classifyAmbiguous } from '../services/classifier.js';
import { buildStructuredReport } from '../services/reportBuilder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveRawDir(){
  const cwd = process.cwd();
  const direct = path.join(cwd,'data','raw','mdeq');
  if(fs.existsSync(direct)) return direct;
  const upOne = path.join(cwd,'..','data','raw','mdeq');
  if(fs.existsSync(upOne)) return upOne;
  return direct;
}
const RAW_DIR = resolveRawDir();

function parseArgs(){
  const args = process.argv.slice(2);
  const cfg = { chunk:5, concurrency:2, out:null, state:null, once:false };
  for(let i=0;i<args.length;i++){
    const a=args[i];
    if(a==='--chunk') cfg.chunk=parseInt(args[++i],10);
    else if(a==='--concurrency') cfg.concurrency=parseInt(args[++i],10);
    else if(a==='--out') cfg.out=args[++i];
    else if(a==='--state') cfg.state=args[++i];
    else if(a==='--once') cfg.once=true;
  }
  if(!cfg.chunk || cfg.chunk<1) cfg.chunk=5;
  if(!cfg.concurrency || cfg.concurrency<1) cfg.concurrency=1;
  return cfg;
}

async function loadPdfText(fp){
  const buf = await fs.promises.readFile(fp);
  const data = await pdfParse(buf).catch(e=>{ throw new Error('pdf-parse failed: '+e.message); });
  return data.text || '';
}

async function processOne(fullPath, file){
  const start = Date.now();
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
      goalPresence: goals.filter(g=> g._present!==false).length,
      bmpPresence: bmps.filter(b=> b._present!==false).length,
      durationMs: duration,
      zeroGoal: goals.length===0,
      zeroBMP: bmps.length===0,
      sampleGoal: goals[0]?.title?.slice(0,140) || null,
      sampleBMP: bmps[0]?.name?.slice(0,140) || null
    };
  } catch(e){
    return { file, error:e.message };
  }
}

function summarize(results){
  const errors = results.filter(r=> r.error);
  const ok = results.filter(r=> !r.error);
  const totalGoals = ok.reduce((a,r)=> a+r.goals,0);
  const totalBMPs = ok.reduce((a,r)=> a+r.bmps,0);
  const avgGoals = ok.length? (totalGoals/ok.length):0;
  const avgBMPs = ok.length? (totalBMPs/ok.length):0;
  const zeroGoals = ok.filter(r=> r.zeroGoal).length;
  const zeroBMPs = ok.filter(r=> r.zeroBMP).length;
  return { totalDocs: results.length, ok: ok.length, errors: errors.length, totalGoals, totalBMPs, avgGoals:Number(avgGoals.toFixed(1)), avgBMPs:Number(avgBMPs.toFixed(1)), zeroGoal: zeroGoals, zeroBMP: zeroBMPs };
}

async function runChunk(files, cfg){
  const res=[]; let idx=0; let active=0; let done=0;
  return await new Promise(resolve=>{
    async function spawn(){
      if(idx>=files.length) return;
      const file=files[idx++]; active++;
      const full = path.join(RAW_DIR,file);
      try { const r = await processOne(full,file); res.push(r);} catch(e){ res.push({file,error:e.message}); }
      active--; done++;
      if(done % 2 ===0){ process.stdout.write(`  [chunk-progress] ${done}/${files.length}\r`); }
      if(idx<files.length) spawn(); else if(active===0) resolve(res);
    }
    const toLaunch = Math.min(cfg.concurrency, files.length);
    for(let i=0;i<toLaunch;i++) spawn();
  });
}

function loadState(statePath, manifest){
  if(!fs.existsSync(statePath)) return { processed:[], remaining:[...manifest], results:[] };
  try {
    const raw = JSON.parse(fs.readFileSync(statePath,'utf-8'));
    // Reconcile with current manifest in case files added.
    const manifestSet = new Set(manifest);
    const processed = raw.processed.filter(f=> manifestSet.has(f));
    const remainingSet = new Set(manifest.filter(f=> !processed.includes(f)));
    // If some files were in previous remaining but now missing from manifest, they disappear quietly.
    const remaining = [...remainingSet];
    const results = (raw.results||[]).filter(r=> manifestSet.has(r.file));
    return { processed, remaining, results };
  } catch(e){
    console.warn('[state] failed to parse, starting fresh:', e.message);
    return { processed:[], remaining:[...manifest], results:[] };
  }
}

function persistState(statePath, state){
  const payload = { ...state, updatedAt: new Date().toISOString(), summary: summarize(state.results) };
  fs.writeFileSync(statePath, JSON.stringify(payload,null,2));
}

async function main(){
  const cfg = parseArgs();
  if(!fs.existsSync(RAW_DIR)){
    console.error('[fatal] raw MDEQ directory not found:', RAW_DIR); process.exit(1);
  }
  const manifest = (await fs.promises.readdir(RAW_DIR)).filter(f=> /\.pdf$/i.test(f)).sort();
  if(!manifest.length){ console.error('[fatal] no PDFs found'); process.exit(1); }
  function resolveOutPath(){
    if(cfg.out) return path.resolve(cfg.out);
    const inBackend = path.basename(process.cwd())==='backend';
    const candidate1 = inBackend ? path.join(process.cwd(),'data','mdeq_extraction_results.json') : path.join(process.cwd(),'backend','data','mdeq_extraction_results.json');
    if(fs.existsSync(path.dirname(candidate1))) return candidate1;
    const alt = path.join(process.cwd(),'backend','data','mdeq_extraction_results.json');
    return alt;
  }
  const outPath = resolveOutPath();
  const statePath = cfg.state ? path.resolve(cfg.state) : outPath.replace(/\.json$/,'') + '.state.json';
  let state = loadState(statePath, manifest);
  console.log(`[start] PDFs total=${manifest.length} processed=${state.processed.length} remaining=${state.remaining.length} chunk=${cfg.chunk} concurrency=${cfg.concurrency}`);
  const startedAt = Date.now();
  while(state.remaining.length){
    const chunk = state.remaining.slice(0,cfg.chunk);
    state.remaining = state.remaining.slice(cfg.chunk);
    console.log(`\n[chunk] processing ${chunk.length} files; remaining after chunk=${state.remaining.length}`);
    const chunkStart = Date.now();
    const chunkResults = await runChunk(chunk, cfg);
    state.results.push(...chunkResults);
    state.processed.push(...chunk);
    const elapsedChunk = ((Date.now()-chunkStart)/1000).toFixed(1);
    const partialSummary = summarize(state.results);
    console.log(`[chunk] done in ${elapsedChunk}s :: goals=${partialSummary.totalGoals} bmps=${partialSummary.totalBMPs} zeroGoal=${partialSummary.zeroGoal} zeroBMP=${partialSummary.zeroBMP}`);
    persistState(statePath, state);
    if(cfg.once){
      console.log('[once] processed a single chunk; exiting early by request');
      break;
    }
  }
  const totalElapsed = ((Date.now()-startedAt)/1000).toFixed(1);
  const finalSummary = summarize(state.results);
  const finalOut = { generatedAt: new Date().toISOString(), count: state.results.length, results: state.results, summary: { ...finalSummary, elapsedSeconds: Number(totalElapsed) } };
  fs.writeFileSync(outPath, JSON.stringify(finalOut,null,2));
  console.log('\n=== Final Summary ===');
  console.log(finalSummary);
  console.log('Results JSON:', outPath);
  console.log('State JSON:', statePath);
}

main().catch(e=>{ console.error('[fatal]', e); process.exit(1); });
