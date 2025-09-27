#!/usr/bin/env node
// Validation script: compare produced structured JSON with golden example.
// Usage: node validation/validate.js <producedFile> [goldenFile]

import fs from 'fs';
import path from 'path';

function loadJSON(p) {
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function jaccard(setA, setB) {
  const a = new Set(setA);
  const b = new Set(setB);
  const intersection = [...a].filter(x => b.has(x));
  const union = new Set([...a, ...b]);
  return union.size === 0 ? 1 : intersection.length / union.size;
}

function accuracyLists(goldenList, producedList, keyFields) {
  let correct = 0;
  const used = new Set();
  for (const g of goldenList) {
    const matchIdx = producedList.findIndex((p, i) => !used.has(i) && keyFields.every(f => p[f] === g[f]));
    if (matchIdx !== -1) {
      correct++;
      used.add(matchIdx);
    }
  }
  return goldenList.length ? correct / goldenList.length : 1;
}

function runValidation(produced, golden) {
  const goalsAcc = accuracyLists(golden.goals, produced.goals, ['title']);
  const bmpsAcc = accuracyLists(golden.bmps, produced.bmps, ['name']);
  // Monitoring metrics by metric name
  const monitoringAcc = accuracyLists(golden.monitoring, produced.monitoring, ['metric']);

  // False positives: produced items not in golden by those keys
  function falsePosRate(goldenList, producedList, key) {
    const goldenKeys = new Set(goldenList.map(i => i[key]));
    const fp = producedList.filter(i => !goldenKeys.has(i[key])).length;
    return producedList.length ? fp / producedList.length : 0;
  }

  const fpGoals = falsePosRate(golden.goals, produced.goals, 'title');
  const fpBMPs = falsePosRate(golden.bmps, produced.bmps, 'name');
  const fpMonitoring = falsePosRate(golden.monitoring, produced.monitoring, 'metric');

  const meetsThresholds = goalsAcc >= 0.9 && bmpsAcc >= 0.9 && monitoringAcc >= 0.9 && fpGoals === 0 && fpBMPs === 0 && fpMonitoring === 0;

  return {
    goalsAccuracy: goalsAcc,
    bmpsAccuracy: bmpsAcc,
    monitoringAccuracy: monitoringAcc,
    falsePositives: { goals: fpGoals, bmps: fpBMPs, monitoring: fpMonitoring },
    meetsThresholds
  };
}

function main() {
  const producedArg = process.argv[2];
  const goldenArg = process.argv[3] || 'backend/validation/golden-example.json';
  if (!producedArg) {
    console.error('Usage: node validation/validate.js <producedFile> [goldenFile]');
    process.exit(1);
  }
  const producedPath = path.resolve(producedArg);
  const goldenPath = path.resolve(goldenArg);
  if (!fs.existsSync(producedPath)) {
    console.error('Produced file not found:', producedPath);
    process.exit(1);
  }
  if (!fs.existsSync(goldenPath)) {
    console.error('Golden file not found:', goldenPath);
    process.exit(1);
  }
  const produced = loadJSON(producedPath);
  const golden = loadJSON(goldenPath);
  const results = runValidation(produced, golden);
  console.log(JSON.stringify(results, null, 2));
  if (!results.meetsThresholds) process.exit(2);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
