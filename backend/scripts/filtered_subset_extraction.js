#!/usr/bin/env node
/*
 * filtered_subset_extraction.js
 * Runs a targeted subset of PDFs with the BMP filtering flag enabled, producing
 * `data/filtered_subset_results.json` for diffing against baseline `mdeq_extraction_results.json`.
 *
 * Subset selection strategy:
 *  - High-BMP outliers likely containing noise: Lake_Washington_Watershed_Plan_2007.pdf (622),
 *    Red_Bud_Catalpa_Creek_Watershed_Plan_2016.pdf (182), Upper_Porter_Bayou_Watershed_Plan_2013.pdf (165),
 *    Middle_Porter_Bayou_Watershed_Plan_2013.pdf (154), Muddy_Bayou_Opossum_Bayou_9_Key_Element_Plan_2022.pdf (88),
 *    Dry_Creek_9_Key_Element_Plan_2017.pdf (74), Bear_Lake_9_Key_Elelment_Plan_2018.pdf (77), Deer_Creek_Watershed_Plan_2008.pdf (54), Overcup_Slough_Watershed_Plan_2013.pdf (57)
 *  - Zero-BMP but goal-present docs to validate no false negatives introduced: Pickwick_Reservoir_Watershed_Plan_2009.pdf,
 *    Old_Fort_Bayou_Watershed_Plan_2019.pdf, Rotten_Bayou_Watershed_Plan_2015.pdf, Ross_Barnett_Reservoir_Watershed_Plan_2011.pdf,
 *    Upper_Bay_of_St_Louis_Watershed_Action_Plan_2007.pdf, Tchoutacabouffa_River_Watershed_Action_Plan_2007.pdf
 *  - One typical mid-range control: Upper_Piney_Creek_9_Key_Element_Plan_2022.pdf (32)
 *
 * Produces per-file metrics plus aggregate summary.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pdfParse from 'pdf-parse';
import { extractSections } from '../services/sectionExtractor.js';
import { classifyAmbiguous } from '../services/classifier.js';
import { buildStructuredReport } from '../services/reportBuilder.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '../data');
function resolveRawDir(){
  const candidates = [
    path.join(process.cwd(),'..','data','raw','mdeq'),
    path.join(process.cwd(),'data','raw','mdeq'),
    path.join(process.cwd(),'backend','data','raw','mdeq'),
    path.join(__dirname,'../data','raw','mdeq'),
    path.join(__dirname,'../../data','raw','mdeq')
  ];
  for (const c of candidates){ if(fs.existsSync(c)) return c; }
  return candidates[1];
}
const RAW_DIR = resolveRawDir();
const OUT_FILE = path.join(DATA_DIR, 'filtered_subset_results.json');
const OUT_FILE_TMP = path.join(DATA_DIR, 'filtered_subset_results.partial.json');

// Ordered subset (unique)
const subset = [
  'Lake_Washington_Watershed_Plan_2007.pdf',
  'Red_Bud_Catalpa_Creek_Watershed_Plan_2016.pdf',
  'Upper_Porter_Bayou_Watershed_Plan_2013.pdf',
  'Middle_Porter_Bayou_Watershed_Plan_2013.pdf',
  'Muddy_Bayou_Opossum_Bayou_9_Key_Element_Plan_2022.pdf',
  'Dry_Creek_9_Key_Element_Plan_2017.pdf',
  'Bear_Lake_9_Key_Elelment_Plan_2018.pdf',
  'Deer_Creek_Watershed_Plan_2008.pdf',
  'Overcup_Slough_Watershed_Plan_2013.pdf',
  'Pickwick_Reservoir_Watershed_Plan_2009.pdf',
  'Old_Fort_Bayou_Watershed_Plan_2019.pdf',
  'Rotten_Bayou_Watershed_Plan_2015.pdf',
  'Ross_Barnett_Reservoir_Watershed_Plan_2011.pdf',
  'Upper_Bay_of_St_Louis_Watershed_Action_Plan_2007.pdf',
  'Tchoutacabouffa_River_Watershed_Action_Plan_2007.pdf',
  'Upper_Piney_Creek_9_Key_Element_Plan_2022.pdf'
];

function ensureEnvFlag() {
  if (process.env.BMP_FILTER !== '1') {
    console.log('[info] Setting BMP_FILTER=1 for this run');
    process.env.BMP_FILTER = '1';
  }
}

async function processOne(file) {
  const pdfPath = path.join(RAW_DIR, file);
  const start = Date.now();
  try {
    if (!fs.existsSync(pdfPath)) return { file, error: 'missing-file' };
    const buf = await fs.promises.readFile(pdfPath);
    const data = await pdfParse(buf);
    const text = data.text || '';
    if(!text.trim()) return { file, error: 'empty-text' };
    const sections = extractSections(text);
    const classified = await classifyAmbiguous(sections);
    const report = buildStructuredReport(classified, { sourceId: file.replace(/\.pdf$/i,'') });
    const durationMs = Date.now() - start;
    return {
      file,
      goals: (report.goals||[]).length,
      bmps: (report.bmps||[]).length,
      rejected: report.bmpRejected ? report.bmpRejected.length : 0,
      rejectionReasons: aggregateReasons(report.bmpRejected || []),
      durationMs,
      zeroGoal: (report.goals||[]).length === 0,
      zeroBMP: (report.bmps||[]).length === 0,
      sampleGoal: report.goals?.[0]?.title || null,
      sampleBMP: report.bmps?.[0]?.name || null
    };
  } catch (e) {
    return { file, error: e.message || String(e) };
  }
}

function aggregateReasons(rejected) {
  const counts = {};
  for (const r of rejected) {
    const reason = r.reason || 'unknown';
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function summarize(results) {
  const ok = results.filter(r => !r.error);
  const errors = results.filter(r => r.error);
  const sum = {
    totalDocs: results.length,
    ok: ok.length,
    errors: errors.length,
    totalGoals: ok.reduce((a, r) => a + r.goals, 0),
    totalBMPs: ok.reduce((a, r) => a + r.bmps, 0),
    totalRejected: ok.reduce((a, r) => a + r.rejected, 0),
    avgGoals: ok.length ? +(ok.reduce((a, r) => a + r.goals, 0) / ok.length).toFixed(2) : 0,
    avgBMPs: ok.length ? +(ok.reduce((a, r) => a + r.bmps, 0) / ok.length).toFixed(2) : 0,
    avgRejected: ok.length ? +(ok.reduce((a, r) => a + r.rejected, 0) / ok.length).toFixed(2) : 0,
    zeroGoal: ok.filter(r => r.zeroGoal).length,
    zeroBMP: ok.filter(r => r.zeroBMP).length,
    reasons: mergeReasonMaps(ok.map(r => r.rejectionReasons))
  };
  return sum;
}

function mergeReasonMaps(maps) {
  const merged = {};
  for (const m of maps) {
    for (const [k,v] of Object.entries(m)) {
      merged[k] = (merged[k] || 0) + v;
    }
  }
  return merged;
}

function loadExisting() {
  const file = fs.existsSync(OUT_FILE) ? OUT_FILE : (fs.existsSync(OUT_FILE_TMP) ? OUT_FILE_TMP : null);
  if (!file) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(data.results)) return data.results;
    if (Array.isArray(data)) return data; // older format safeguard
  } catch (e) {
    console.warn('[subset] Failed to parse existing partial file:', e.message);
  }
  return [];
}

function writeProgress(results, final = false) {
  const summary = summarize(results);
  const payload = { generatedAt: new Date().toISOString(), count: results.length, results, summary, final };
  const target = final ? OUT_FILE : OUT_FILE_TMP;
  fs.writeFileSync(target, JSON.stringify(payload, null, 2));
  console.log(`[subset] ${final ? 'Final write' : 'Progress write'} -> ${path.basename(target)}`);
  if (final && fs.existsSync(OUT_FILE_TMP)) {
    try { fs.unlinkSync(OUT_FILE_TMP); } catch(_){}
  }
}

async function main() {
  ensureEnvFlag();
  const existing = loadExisting();
  const processedSet = new Set(existing.map(r => r.file));
  console.log(`[subset] Running filtered subset of ${subset.length} PDFs (already processed: ${processedSet.size})...`);
  const results = existing;

  let interrupted = false;
  const handleInterrupt = () => {
    if (interrupted) return; // avoid double
    interrupted = true;
    console.log('\n[subset] Caught interrupt (SIGINT). Writing partial progress...');
    writeProgress(results, false);
    console.log('[subset] Partial progress saved. Re-run the script to resume.');
    process.exit(130);
  };
  process.on('SIGINT', handleInterrupt);

  for (const f of subset) {
    if (processedSet.has(f)) {
      console.log(`[subset] Skipping already processed ${f}`);
      continue;
    }
    console.log(`[subset] Processing ${f}`);
    const r = await processOne(f);
    results.push(r);
    processedSet.add(f);
    writeProgress(results, false); // incremental write
  }
  writeProgress(results, true);
  console.log('[subset] Completed all subset files.');
  console.log('[subset] Summary:', summarize(results));
}

main();
