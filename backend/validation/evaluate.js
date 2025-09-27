#!/usr/bin/env node
/**
 * Evaluation script: computes precision/recall/F1 for extraction categories.
 */
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const GOLD_DIR = path.join(ROOT, 'backend', 'validation', 'gold');
const SILVER_DIR = path.join(ROOT, 'backend', 'data', 'silver');
const RESULTS_DIR = path.join(ROOT, 'backend', 'validation', 'results');

await fs.promises.mkdir(RESULTS_DIR, { recursive: true });

const args = process.argv.slice(2);
let filterReport = null;
for (let i=0;i<args.length;i++) {
  if (args[i] === '--report' && args[i+1]) filterReport = args[i+1];
}

// thresholds
const GOAL_MIN = parseFloat(process.env.GOAL_MIN || '0.9');
const BMP_MIN = parseFloat(process.env.BMP_MIN || '0.9');
const ACTIVITY_MIN = parseFloat(process.env.ACTIVITY_MIN || '0.9');
const METRIC_MIN = parseFloat(process.env.METRIC_MIN || '0.9');
const VALUE_TOL = parseFloat(process.env.METRIC_VALUE_TOLERANCE || '0.01');

function normalize(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9%]+/g,' ').replace(/\s+/g,' ').trim();
}
function uniq(arr) { return [...new Set(arr.filter(Boolean))]; }

function evaluateSet(goldArr, extractedArr) {
  const gold = uniq(goldArr.map(normalize));
  const extracted = uniq(extractedArr.map(normalize));
  let tp = 0; extracted.forEach(e => { if (gold.includes(e)) tp++; });
  const fp = extracted.length - tp;
  const fn = gold.length - tp;
  const precision = extracted.length ? tp / extracted.length : (gold.length?0:1);
  const recall = gold.length ? tp / gold.length : 1;
  const f1 = (precision+recall) ? 2*precision*recall/(precision+recall) : 0;
  return { tp, fp, fn, precision, recall, f1, goldCount: gold.length, extractedCount: extracted.length };
}

function extractValues(report, rawText) {
  return {
    goals: (report.goals||[]).map(g => g.title || g.name || ''),
    bmps: (report.bmps||[]).map(b => b.name || ''),
    activities: (report.implementation||[]).map(i => i.description || ''),
    metrics: (report.monitoring||[]).map(m => m.metric || '')
  };
}

function metricValueAccuracy(goldMetrics, extractedMetrics) {
  // Only attempt if gold provides structured pattern "label NUMBER unit" or exact text match already covered.
  // For now, we treat normalization of line as label and numeric portion.
  const parse = line => {
    const num = line.match(/([0-9]+(?:\.[0-9]+)?)/);
    const unit = line.match(/(mg\/l|mg\\l|cfs|acres?|percent|%|tons?|kg|km)/i);
    return { norm: normalize(line.replace(/([0-9]+(?:\.[0-9]+)?)/,'').trim()), value: num?parseFloat(num[1]):null, unit: unit?unit[1].toLowerCase():null };
  };
  const goldParsed = goldMetrics.map(parse);
  const extractedParsed = extractedMetrics.map(parse);
  let matched=0, valueMatches=0, unitMatches=0;
  goldParsed.forEach(g => {
    const candidate = extractedParsed.find(e => e.norm === g.norm);
    if (candidate) {
      matched++;
      if (g.value!=null && candidate.value!=null) {
        const rel = g.value===0? Math.abs(candidate.value - g.value): Math.abs(candidate.value - g.value)/g.value;
        if (rel <= VALUE_TOL) valueMatches++;
      }
      if (g.unit && candidate.unit && g.unit===candidate.unit) unitMatches++;
    }
  });
  return { matched, valueMatches, unitMatches };
}

function loadJSON(p) { return JSON.parse(fs.readFileSync(p,'utf-8')); }

const goldFiles = fs.readdirSync(GOLD_DIR).filter(f => f.endsWith('.gold.json'));
if (!goldFiles.length) {
  console.error('No gold files found in', GOLD_DIR);
  process.exit(1);
}

const reportSummaries = [];
for (const gf of goldFiles) {
  const gold = loadJSON(path.join(GOLD_DIR, gf));
  const id = gold.reportId || gf.replace(/\.gold\.json$/,'');
  if (filterReport && filterReport !== id) continue;
  const silverPath = path.join(SILVER_DIR, id + '.json');
  if (!fs.existsSync(silverPath)) {
    console.warn('Silver file missing for', id);
    continue;
  }
  const silver = loadJSON(silverPath);
  const rawText = ''; // could load bronze for cross-check in future
  const extractedValues = extractValues(silver, rawText);

  const results = {};
  if (gold.goals) results.goals = evaluateSet(gold.goals, extractedValues.goals);
  if (gold.bmps) results.bmps = evaluateSet(gold.bmps, extractedValues.bmps);
  if (gold.activities) results.activities = evaluateSet(gold.activities, extractedValues.activities);
  if (gold.metrics) {
    results.metrics = evaluateSet(gold.metrics, extractedValues.metrics);
    const mv = metricValueAccuracy(gold.metrics, extractedValues.metrics);
    results.metrics.valueDetail = mv;
  }

  // Threshold evaluation
  const pass = {
    goals: !results.goals || results.goals.recall >= GOAL_MIN,
    bmps: !results.bmps || results.bmps.recall >= BMP_MIN,
    activities: !results.activities || results.activities.recall >= ACTIVITY_MIN,
    metrics: !results.metrics || results.metrics.recall >= METRIC_MIN
  };

  reportSummaries.push({ id, results, pass });
}

const summary = { generatedAt: new Date().toISOString(), threshold: { GOAL_MIN, BMP_MIN, ACTIVITY_MIN, METRIC_MIN }, reports: reportSummaries };
const outPath = path.join(RESULTS_DIR, `summary-${Date.now()}.json`);
fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));

// Console output
for (const r of reportSummaries) {
  console.log('Report:', r.id);
  for (const k of ['goals','bmps','activities','metrics']) {
    if (!r.results[k]) continue;
    const { precision, recall, f1, goldCount, extractedCount } = r.results[k];
    console.log(`  ${k}: P=${precision.toFixed(2)} R=${recall.toFixed(2)} F1=${f1.toFixed(2)} gold=${goldCount} extracted=${extractedCount} PASS=${r.pass[k]}`);
    if (k==='metrics' && r.results.metrics.valueDetail) {
      const vd = r.results.metrics.valueDetail;
      console.log(`    valueMatches=${vd.valueMatches}/${vd.matched} unitMatches=${vd.unitMatches}/${vd.matched}`);
    }
  }
}
console.log('\nWrote summary:', outPath);
