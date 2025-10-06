#!/usr/bin/env node
/**
 * diff_bmp_filter_impact.js
 * Compares baseline `mdeq_extraction_results.json` with filtered subset (`filtered_subset_results.json` or NDJSON).
 * Produces `data/bmp_filter_diff.json` summarizing delta in BMP counts and rejection reasons.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');

const BASELINE_FILE = path.join(DATA_DIR, 'mdeq_extraction_results.json');
const FILTERED_JSON = path.join(DATA_DIR, 'filtered_subset_results.json');
const FILTERED_NDJSON = path.join(DATA_DIR, 'filtered_subset_results.ndjson');
const OUT_FILE = path.join(DATA_DIR, 'bmp_filter_diff.json');

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) throw new Error('Missing baseline file');
  const data = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
  const map = new Map();
  for (const r of data.results) {
    if (r.error) continue;
    map.set(r.file, r);
  }
  return map;
}

function loadFiltered() {
  if (fs.existsSync(FILTERED_JSON)) {
    const data = JSON.parse(fs.readFileSync(FILTERED_JSON, 'utf8'));
    const arr = (data.resultsDeduped || data.results || []).filter(r => !r.parseError);
    return arr;
  }
  if (fs.existsSync(FILTERED_NDJSON)) {
    const lines = fs.readFileSync(FILTERED_NDJSON, 'utf8').split(/\r?\n/).filter(Boolean);
    return lines.map(l => { try { return JSON.parse(l); } catch { return { parseError: true }; } }).filter(r => !r.parseError);
  }
  throw new Error('No filtered subset results found');
}

function diff(baselineMap, filtered) {
  const perFile = [];
  let totalBaselineBMPs = 0;
  let totalFilteredBMPs = 0;
  let totalRejected = 0;
  const reasonTotals = {};
  for (const f of filtered) {
    const base = baselineMap.get(f.file);
    if (!base) continue; // filtered subset file not in baseline ok set
    totalBaselineBMPs += base.bmps;
    totalFilteredBMPs += f.bmps;
    totalRejected += (f.rejected || 0);
    for (const [k,v] of Object.entries(f.rejectionReasons || {})) {
      reasonTotals[k] = (reasonTotals[k] || 0) + v;
    }
    perFile.push({
      file: f.file,
      baselineBMPs: base.bmps,
      filteredBMPs: f.bmps,
      delta: f.bmps - base.bmps,
      goalsBaseline: base.goals,
      goalsFiltered: f.goals,
      goalsDelta: f.goals - base.goals,
      rejected: f.rejected || 0,
      reasons: f.rejectionReasons || {}
    });
  }
  perFile.sort((a,b) => b.baselineBMPs - a.baselineBMPs);
  const aggregate = {
    files: perFile.length,
    totalBaselineBMPs,
    totalFilteredBMPs,
    bmpDelta: totalFilteredBMPs - totalBaselineBMPs,
    percentReduction: totalBaselineBMPs ? +(((totalFilteredBMPs - totalBaselineBMPs)/totalBaselineBMPs)*100).toFixed(2) : 0,
    totalRejected,
    reasonTotals
  };
  return { aggregate, perFile };
}

function main() {
  try {
    const baseline = loadBaseline();
    const filtered = loadFiltered();
    const { aggregate, perFile } = diff(baseline, filtered);
    const payload = { generatedAt: new Date().toISOString(), aggregate, perFile };
    fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2));
    console.log('[diff] Wrote', OUT_FILE);
    console.log('[diff] Aggregate:', aggregate);
  } catch (e) {
    console.error('[diff] Failed:', e.message);
    process.exit(1);
  }
}

main();
