#!/usr/bin/env node
/**
 * Batch silver generation for all MDEQ bronze slugs that lack a silver structured report.
 *
 * Strategy:
 *  - Identify unique base slugs from bronze directory (strip -N.json suffix variants).
 *  - For each slug, if a silver file starting with slug does not exist, invoke the existing report building logic.
 */
import fs from 'fs';
import path from 'path';
import { buildStructuredReport } from '../services/reportBuilder.js';

// When executed from backend/, bronze & silver live at backend/data/* (no extra nested backend/)
// Use repo root for clarity similar to batch_bronze script adjustments.
const BRONZE_DIR = path.join(process.cwd(), 'data', 'bronze');
const SILVER_DIR = path.join(process.cwd(), 'data', 'silver');

function collectBronzeSlugs() {
  const files = fs.readdirSync(BRONZE_DIR).filter(f => f.endsWith('.json'));
  const slugs = new Set();
  for (const f of files) {
    const base = f.replace(/\.json$/,'').replace(/-\d+$/,'');
    slugs.add(base);
  }
  return [...slugs];
}

function loadBronze(slug){
  const basePath = path.join(BRONZE_DIR, `${slug}.json`);
  if (fs.existsSync(basePath)) {
    return JSON.parse(fs.readFileSync(basePath,'utf8'));
  }
  // Fallback: gather slice files slug-<n>.json
  const sliceFiles = fs.readdirSync(BRONZE_DIR)
    .filter(f => f.startsWith(slug + '-') && /-\d+\.json$/.test(f))
    .sort((a,b) => {
      const na = parseInt(a.match(/-(\d+)\.json$/)[1],10);
      const nb = parseInt(b.match(/-(\d+)\.json$/)[1],10);
      return na - nb;
    });
  if (!sliceFiles.length) return null;
  let combinedRaw = '';
  let originalName = null;
  for (const f of sliceFiles) {
    try {
      const obj = JSON.parse(fs.readFileSync(path.join(BRONZE_DIR,f),'utf8'));
      if (!originalName && obj.originalName) originalName = obj.originalName;
      const text = obj.rawText || obj.text || '';
      // Separate slices with a form feed marker to reduce accidental word joins
      combinedRaw += (combinedRaw ? '\n\f\n' : '') + text;
    } catch(e){
      console.warn(`[warn] failed to read slice ${f}: ${e.message}`);
    }
  }
  if (!combinedRaw) return null;
  return { rawText: combinedRaw, originalName: originalName || (slug + '.pdf'), mergedSlices: sliceFiles.length };
}

function naiveSectionize(raw){
  const lines = raw.split(/\r?\n/);
  const sections = { Goals: [], BMPs: [], Implementation: [], Activities: [], Monitoring: [], Outreach: [], Geography: [], uncategorized: [] };
  lines.forEach((l,idx) => {
    const t = l.trim(); if(!t) return;
    let bucketed = false;
    if(/\bgoal\b/i.test(t) && sections.Goals.length < 50){ sections.Goals.push(t); bucketed=true; }
    if(/\$[0-9]|Practice\s+Units|Code\s+Practice|BMP Cost|Estimated Units|Estimated Cost|Unit Cost|Total Cost|Practice\s+Producer\s+NRCS\s+(EPA-?MDEQ|EPA\s*MDEQ)\s+Total/i.test(t)) { sections.BMPs.push(t); bucketed=true; }
    else if(/Projected\s+Costs.*Practice.*Producer.*NRCS/i.test(t)){ sections.BMPs.push(t); bucketed=true; }
    if(!bucketed) sections.uncategorized.push(t);
  });
  return sections;
}

async function main() {
  const slugs = collectBronzeSlugs();
  console.log(`[info] discovered ${slugs.length} bronze base slugs in ${BRONZE_DIR}`);
  await fs.promises.mkdir(SILVER_DIR, { recursive: true });
  for (const slug of slugs) {
    const existing = fs.readdirSync(SILVER_DIR).find(f => f.startsWith(slug) && f.endsWith('.json'));
    if (existing) {
      // keep skip log concise
      console.log(`[skip] ${slug}`);
      continue;
    }
    try {
      const bronze = loadBronze(slug);
      if(!bronze || !bronze.rawText){
        console.warn(`[warn] no bronze rawText for ${slug}`);
        continue;
      }
      if (bronze.mergedSlices) {
        console.log(`[merge] ${slug} merged ${bronze.mergedSlices} slices`);
      }
      console.log(`[silver] building ${slug}`);
      const sections = naiveSectionize(bronze.rawText);
      const report = buildStructuredReport(sections,{ sourceId: slug, sourceFile: bronze.originalName || (slug + '.pdf') });
      const outPath = path.join(SILVER_DIR, `${slug}.json`);
      await fs.promises.writeFile(outPath, JSON.stringify(report, null, 2));
      console.log(`[silver] saved ${outPath}`);
    } catch (e) {
      console.error(`[error] silver ${slug} ->`, e.message);
    }
  }
  console.log('[done] silver batch complete');
}

main().catch(e => { console.error(e); process.exit(1); });
