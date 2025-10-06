#!/usr/bin/env node
/**
 * Scan bronze JSON files to:
 * 1. Detect BMP cost tables / cost lines
 * 2. Detect activity / implementation / outreach lines
 * 3. Flag potential truncation (very short terminal page, abrupt end mid-word, or presence of multi-part segments with large length deltas)
 * 4. Summarize counts per document and overall coverage
 */
import fs from 'fs';
import path from 'path';

const bronzeDir = path.join(process.cwd(), 'backend', 'data', 'bronze');
if (!fs.existsSync(bronzeDir)) {
  console.error('[fatal] bronze directory not found:', bronzeDir);
  process.exit(1);
}

const files = fs.readdirSync(bronzeDir).filter(f => f.endsWith('.json'));

// Heuristic regexes
const costHeaderRe = /(Activity\s+Size\/Amount\s+Estimated\s+Cost)|(BMPs?\s+Amount\s+Estimated\s+Cost)|(Cost Estimate:)/i;
const costLineRe = /(\$\s?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)|(\d{1,3}(?:,\d{3})*\s?@\s?\$\d)/; // money or qty @ $ pattern
const bmpNameHints = /(streambank|stabilization|fencing|ponds?|grade stabilization|heavy use area|tank|trough|cover crops?|riparian|buffer|nutrient management)/i;
const activityHints = /(education|outreach|monitoring|technical assistance|project management|implementation|coordination)/i;
const truncationTailRe = /(\w{12,}$)/; // long last token w/o punctuation might indicate cut

let summary = [];
let globalStats = { totalFiles: 0, withCostHeader: 0, withCostLines: 0, withActivities: 0, suspectedTruncation: 0 };

function analyzeText(text) {
  const lines = text.split(/\r?\n/);
  let costHeader = false;
  let costLines = 0;
  let activityLines = 0;
  let bmpLines = 0;
  lines.forEach(l => {
    const line = l.trim();
    if (!costHeader && costHeaderRe.test(line)) costHeader = true;
    if (costLineRe.test(line)) costLines++;
    if (bmpNameHints.test(line)) bmpLines++;
    if (activityHints.test(line)) activityLines++;
  });
  // Truncation heuristic: last 2 non-empty lines extremely short or abrupt mid-sentence or final char not punctuation while previous lines are long.
  const nonEmpty = lines.filter(l => l.trim().length);
  const tail = nonEmpty.slice(-3);
  let suspectedTrunc = false;
  if (tail.length) {
    const last = tail[tail.length - 1];
    if (last.length < 15 && tail.some(t => t.includes('Figure'))) suspectedTrunc = true; // ended right after figure ref
    else if (!/[.!?]$/.test(last.trim()) && truncationTailRe.test(last.trim())) suspectedTrunc = true;
  }
  return { costHeader, costLines, activityLines, bmpLines, suspectedTrunc };
}

// Group multipart: base slug without -<number>.json suffix
function baseKey(filename) {
  return filename.replace(/-\d+\.json$/, '').replace(/\.json$/, '');
}

const multipartGroups = new Map();

for (const f of files) {
  globalStats.totalFiles++;
  const full = path.join(bronzeDir, f);
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(full, 'utf-8'));
  } catch (e) {
    console.warn('[warn] failed to parse', f, e.message);
    continue;
  }
  const text = raw.rawText || raw.text || '';
  const { costHeader, costLines, activityLines, bmpLines, suspectedTrunc } = analyzeText(text);
  if (costHeader) globalStats.withCostHeader++;
  if (costLines) globalStats.withCostLines++;
  if (activityLines) globalStats.withActivities++;
  if (suspectedTrunc) globalStats.suspectedTruncation++;
  summary.push({ file: f, costHeader, costLines, activityLines, bmpLines, suspectedTrunc, length: text.length });
  const key = baseKey(f);
  if (!multipartGroups.has(key)) multipartGroups.set(key, []);
  multipartGroups.get(key).push({ file: f, length: text.length, suspectedTrunc });
}

// Detect suspicious multipart sets: large variance or many small segments
const multipartFindings = [];
for (const [k, arr] of multipartGroups.entries()) {
  if (arr.length > 1) {
    const lengths = arr.map(a => a.length).sort((a,b)=>a-b);
    const min = lengths[0];
    const max = lengths[lengths.length-1];
    const ratio = max && min ? (max / Math.max(1,min)) : 0;
    if (ratio > 25 || min < 200) {
      multipartFindings.push({ base: k, parts: arr.length, min, max, ratio: Number(ratio.toFixed(2)) });
    }
  }
}

// Output
console.log('Bronze BMP/Cost/Activity Scan Summary');
console.log('====================================');
console.log(globalStats);
console.log('\nTop files with cost signals (header or >3 cost lines):');
summary
  .filter(s => s.costHeader || s.costLines > 3)
  .sort((a,b)=> (b.costLines + (b.costHeader?5:0)) - (a.costLines + (a.costHeader?5:0)))
  .slice(0,25)
  .forEach(s => {
    console.log(`${s.file} | header=${s.costHeader} costLines=${s.costLines} activities=${s.activityLines} bmpLines=${s.bmpLines} trunc=${s.suspectedTrunc}`);
  });

console.log('\nSuspected truncation files:');
summary.filter(s => s.suspectedTrunc).slice(0,40).forEach(s => console.log(`${s.file} len=${s.length}`));

console.log('\nMultipart anomalies (length variance or tiny parts):');
multipartFindings.slice(0,40).forEach(m => console.log(`${m.base} parts=${m.parts} min=${m.min} max=${m.max} ratio=${m.ratio}`));

// Save machine-readable output
const outDir = path.join(process.cwd(), 'backend', 'data', 'validation');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'bronze_bmp_cost_scan.json'), JSON.stringify({ globalStats, summary, multipartFindings }, null, 2));
console.log('\nWrote detailed results to data/validation/bronze_bmp_cost_scan.json');
