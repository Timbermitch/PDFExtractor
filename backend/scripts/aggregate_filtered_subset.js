#!/usr/bin/env node
/**
 * aggregate_filtered_subset.js
 * Reads data/filtered_subset_results.ndjson and produces data/filtered_subset_results.json with summary.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');
const NDJSON_FILE = path.join(DATA_DIR, 'filtered_subset_results.ndjson');
const OUT_FILE = path.join(DATA_DIR, 'filtered_subset_results.json');

function summarize(results) {
  // Dedupe by file keeping the latest (based on ts) successful record (skip errors for final stats)
  const byFile = new Map();
  results.forEach(r => {
    if(!r || !r.file) return;
    const existing = byFile.get(r.file);
    if(!existing) {
      byFile.set(r.file, r);
    } else {
      // Prefer records without error; if both ok choose the newer ts; if existing has error and new is ok take new
      const existingTs = Date.parse(existing.ts || '') || 0;
      const newTs = Date.parse(r.ts || '') || 0;
      if(existing.error && !r.error) {
        byFile.set(r.file, r);
      } else if(!existing.error && r.error) {
        // keep existing ok
      } else if(existing.error && r.error) {
        // both error, keep newest
        if(newTs > existingTs) byFile.set(r.file, r);
      } else {
        // both ok -> choose newer
        if(newTs > existingTs) byFile.set(r.file, r);
      }
    }
  });
  const deduped = Array.from(byFile.values());
  const ok = deduped.filter(r => !r.error);
  const errors = deduped.filter(r => r.error);
  const totalGoalsAll = ok.reduce((a, r) => a + (r.goals||0), 0);
  const totalBMPsAll = ok.reduce((a, r) => a + (r.bmps||0), 0);
  const totalRejectedAll = ok.reduce((a, r) => a + (r.rejected||0), 0);
  const sum = {
    totalDocsRaw: results.length,
    totalDocsDeduped: deduped.length,
    ok: ok.length,
    errors: errors.length,
    totalGoals: totalGoalsAll,
    totalBMPs: totalBMPsAll,
    totalRejected: totalRejectedAll,
    avgGoals: ok.length ? +(totalGoalsAll / ok.length).toFixed(2) : 0,
    avgBMPs: ok.length ? +(totalBMPsAll / ok.length).toFixed(2) : 0,
    avgRejected: ok.length ? +(totalRejectedAll / ok.length).toFixed(2) : 0,
    zeroGoal: ok.filter(r => r.zeroGoal).length,
    zeroBMP: ok.filter(r => r.zeroBMP).length,
    reasons: mergeReasonMaps(ok.map(r => r.rejectionReasons || {})),
    reasonTop5: topNReasons(ok.map(r => r.rejectionReasons || {}), 5)
  };
  return { summary: sum, deduped };
}
function topNReasons(maps, n){
  const merged = mergeReasonMaps(maps);
  const arr = Object.entries(merged).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([reason,count])=>({reason,count}));
  return arr;
}
function mergeReasonMaps(maps) { const merged = {}; for (const m of maps) { for (const [k,v] of Object.entries(m)) merged[k]=(merged[k]||0)+v; } return merged; }

function main() {
  if (!fs.existsSync(NDJSON_FILE)) {
    console.error('[aggregate] No NDJSON file found, nothing to aggregate.');
    process.exit(1);
  }
  const lines = fs.readFileSync(NDJSON_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
  const results = lines.map(l => { try { return JSON.parse(l); } catch { return { parseError: true, raw: l }; } });
  const { summary, deduped } = summarize(results.filter(r => !r.parseError));
  const payload = { generatedAt: new Date().toISOString(), countRaw: results.length, dedupedCount: deduped.length, resultsDeduped: deduped, summary };
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
  console.log('[aggregate] Wrote', OUT_FILE);
  console.log('[aggregate] Summary:', summary);
}

main();
