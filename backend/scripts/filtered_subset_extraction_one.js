#!/usr/bin/env node
/**
 * filtered_subset_extraction_one.js
 * Process a single PDF from the predefined filtered subset list with BMP filtering enabled.
 * Appends result as one JSON line (NDJSON) to data/filtered_subset_results.ndjson
 * Safe to re-run; will skip if file already processed.
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
const RAW_DIR = path.join(DATA_DIR, 'raw');
const RAW_MDEQ_DIR = path.resolve(DATA_DIR, '../data/raw/mdeq'); // fallback within backend structure
// Additional fallbacks when raw PDFs live at repoRoot/data/raw/mdeq
const ROOT_RAW_MDEQ_DIR = path.resolve(__dirname, '../../data/raw/mdeq');
const ROOT_RAW_DIR = path.resolve(__dirname, '../../data/raw');
const NDJSON_FILE = path.join(DATA_DIR, 'filtered_subset_results.ndjson');

const subset = new Set([
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
]);

function ensureEnvFlag() { if (process.env.BMP_FILTER !== '1') process.env.BMP_FILTER = '1'; }

function alreadyProcessed(file) {
  if (!fs.existsSync(NDJSON_FILE)) return false;
  const lines = fs.readFileSync(NDJSON_FILE, 'utf8').split(/\r?\n/).filter(Boolean);
  for(const line of lines){
    try {
      const obj = JSON.parse(line);
      if(obj.file === file){
        // Allow re-run if prior record had an error (e.g. missing-file)
        if(obj.error) return false;
        return true;
      }
    } catch(_){/* ignore parse errors */}
  }
  return false;
}

function aggregateReasons(rejected) {
  const counts = {};
  for (const r of rejected || []) {
    // New enriched rejection objects: rejectReasons (array) + rejectPrimary
    if(Array.isArray(r.rejectReasons) && r.rejectReasons.length){
      r.rejectReasons.forEach(reason => { counts[reason] = (counts[reason]||0)+1; });
    } else if(r.rejectPrimary) {
      counts[r.rejectPrimary] = (counts[r.rejectPrimary]||0)+1;
    } else if(r.reason) {
      counts[r.reason] = (counts[r.reason]||0)+1;
    } else {
      counts.unknown = (counts.unknown||0)+1;
    }
  }
  return counts;
}

async function main() {
  ensureEnvFlag();
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const targetFile = args.find(a=> !a.startsWith('--'));
  if (!targetFile) {
    console.error('Usage: node scripts/filtered_subset_extraction_one.js <PDF_FILE>');
    process.exit(1);
  }
  if (!subset.has(targetFile)) {
    console.error('[subset-one] Provided file not in subset list:', targetFile);
    process.exit(2);
  }
  if (!force && alreadyProcessed(targetFile)) {
    console.log('[subset-one] Already processed (use --force to re-run):', targetFile);
    return;
  } else if(force){
    console.log('[subset-one] Force reprocessing:', targetFile);
  }
  const candidatePaths = [
    path.join(RAW_DIR, targetFile),
    path.join(RAW_MDEQ_DIR, targetFile),
    path.join(ROOT_RAW_MDEQ_DIR, targetFile),
    path.join(ROOT_RAW_DIR, targetFile)
  ];
  const existenceMap = candidatePaths.map(p => ({ path: p, exists: fs.existsSync(p) }));
  let pdfPath = existenceMap.find(e => e.exists)?.path;
  if(!pdfPath){
    console.error('[subset-one] PDF not found. Candidate paths with existence flags:');
    existenceMap.forEach(e => console.error('  -', e.exists ? '[FOUND ]' : '[MISSING]', e.path));
    const fail = { file: targetFile, error: 'missing-file', ts: new Date().toISOString() };
    fs.appendFileSync(NDJSON_FILE, JSON.stringify(fail) + '\n');
    process.exit(0);
  } else {
    console.log('[subset-one] Selected path:', pdfPath);
    existenceMap.forEach(e => console.log('  candidate', e.exists ? '[x]' : '[ ]', e.path));
  }
  if(!pdfPath.includes('backend')) {
    console.log('[subset-one] Using root-level data path:', pdfPath);
  }
  const start = Date.now();
  try {
    const buf = await fs.promises.readFile(pdfPath);
    const parsed = await pdfParse(buf);
    const text = parsed.text || '';
    if(!text.trim()) throw new Error('empty-text');
    const sections = extractSections(text);
    const classified = await classifyAmbiguous(sections);
    const report = buildStructuredReport(classified, { sourceId: targetFile.replace(/\.pdf$/i,'') });
    const durationMs = Date.now() - start;
    const record = {
      file: targetFile,
      goals: (report.goals||[]).length,
      bmps: (report.bmps||[]).length,
      rejected: report.bmpRejected ? report.bmpRejected.length : 0,
      rejectionReasons: aggregateReasons(report.bmpRejected),
      durationMs,
      zeroGoal: (report.goals||[]).length === 0,
      zeroBMP: (report.bmps||[]).length === 0,
      sampleGoal: report.goals ? (report.goals[0]?.title || report.goals[0]) : null,
      sampleBMP: report.bmps ? (report.bmps[0]?.name || report.bmps[0]) : null,
      ts: new Date().toISOString()
    };
    fs.appendFileSync(NDJSON_FILE, JSON.stringify(record) + '\n');
    console.log('[subset-one] Wrote result for', targetFile);
  } catch (e) {
    const errRec = { file: targetFile, error: e.message || String(e), ts: new Date().toISOString() };
    fs.appendFileSync(NDJSON_FILE, JSON.stringify(errRec) + '\n');
    console.error('[subset-one] Error for', targetFile, e.message || e);
  }
}

main();
