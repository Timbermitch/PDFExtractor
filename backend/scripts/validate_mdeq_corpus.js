#!/usr/bin/env node
/**
 * Validate MDEQ corpus: For each silver report, extract summary metrics:
 *  - counts: activities, bmps, goals, costTables
 *  - cost pattern distribution (patternId -> count)
 *  - presence of fallback flags (bmpFallbackApplied)
 * Output JSON lines file + aggregate summary.
 */
import fs from 'fs';
import path from 'path';

const SILVER_DIR = path.join(process.cwd(), 'backend', 'data', 'silver');
const OUT_DIR = path.join(process.cwd(), 'backend', 'data', 'validation');

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const files = fs.readdirSync(SILVER_DIR).filter(f => f.endsWith('.json'));
  const rows = [];
  for (const f of files) {
    try {
      const report = JSON.parse(fs.readFileSync(path.join(SILVER_DIR, f), 'utf-8'));
      // Harmonize cost table sources: prefer bmpCostTablesNormalized then bmpCostTables then legacy costTables
      const enrichedTables = report.bmpCostTablesNormalized || report.bmpCostTables || [];
      const costTables = Array.isArray(enrichedTables) ? enrichedTables : [];
      const patternCounts = {};
      for (const ct of costTables) {
        const pid = ct.patternId || ct.id || 'legacy/unknown';
        patternCounts[pid] = (patternCounts[pid] || 0) + 1;
      }
      // Derive discrepancy metrics per report (aggregate across tables)
      let totalTables = costTables.length;
      let discrepancyWithin1 = 0, discrepancyWithin5 = 0, discrepancyOver20 = 0;
      for(const ct of costTables){
        // Prefer explicit discrepancy field; else derive if both totals present
        let d = (ct.discrepancy !== undefined && ct.discrepancy !== null) ? ct.discrepancy : null;
        const totalReported = (ct.totalReported !== undefined && ct.totalReported !== null) ? ct.totalReported : null;
        if(d == null && totalReported != null && (ct.totalComputed !== undefined && ct.totalComputed !== null)){
          d = totalReported - ct.totalComputed;
        }
        if(d!=null && totalReported){
          const pct = Math.abs(d) / (totalReported || 1) * 100;
          if(pct <= 1) discrepancyWithin1++;
          if(pct <= 5) discrepancyWithin5++;
          if(pct > 20) discrepancyOver20++;
        }
      }
      const row = {
        file: f,
        slug: (report.metadata && report.metadata.slug) || f.replace(/\.json$/,''),
        activities: (report.activities || []).length,
        bmps: (report.bmps || []).length,
        goals: (report.goals || []).length,
        costTables: costTables.length,
        patterns: patternCounts,
        bmpFallbackApplied: !!(report.metadata && report.metadata.bmpFallbackApplied),
        discrepancyWithin1,
        discrepancyWithin5,
        discrepancyOver20,
        tablesWithDiscrepancy: totalTables
      };
      rows.push(row);
    } catch (e) {
      console.error('[warn] could not parse', f, e.message);
    }
  }
  // Aggregate pattern usage
  const patternUsage = {};
  for (const r of rows) {
    for (const [pid, cnt] of Object.entries(r.patterns)) {
      if (!patternUsage[pid]) patternUsage[pid] = { tables: 0, reports: 0 };
      patternUsage[pid].tables += cnt;
    }
  }
  for (const pid of Object.keys(patternUsage)) {
    patternUsage[pid].reports = rows.filter(r => r.patterns[pid]).length;
  }
  const reportsWithCostTables = rows.filter(r => r.costTables > 0);
  const reportsWithoutCostTables = rows.filter(r => r.costTables === 0).map(r=>r.slug);
  // Global discrepancy aggregation
  let gWithin1 = 0, gWithin5 = 0, gOver20 = 0, gTables = 0;
  rows.forEach(r => { gWithin1 += r.discrepancyWithin1; gWithin5 += r.discrepancyWithin5; gOver20 += r.discrepancyOver20; gTables += r.tablesWithDiscrepancy; });
  const summary = {
    generatedAt: new Date().toISOString(),
    reports: rows.length,
    totals: {
      activities: rows.reduce((a,b)=>a+b.activities,0),
      bmps: rows.reduce((a,b)=>a+b.bmps,0),
      goals: rows.reduce((a,b)=>a+b.goals,0),
      costTables: rows.reduce((a,b)=>a+b.costTables,0),
      reportsWithCostTables: reportsWithCostTables.length,
      reportsWithoutCostTables: reportsWithoutCostTables.length,
      discrepancyWithin1: gWithin1,
      discrepancyWithin5: gWithin5,
      discrepancyOver20: gOver20,
      tablesWithDiscrepancy: gTables
    },
    reportsWithoutCostTables,
    patternUsage,
    bmpFallbackReports: rows.filter(r => r.bmpFallbackApplied).length
  };
  fs.writeFileSync(path.join(OUT_DIR, 'mdeq_corpus_reports.json'), JSON.stringify(rows, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'mdeq_corpus_summary.json'), JSON.stringify(summary, null, 2));
  const pctWithCost = ((summary.totals.reportsWithCostTables / rows.length) * 100).toFixed(1);
  const pctWithin1 = summary.totals.tablesWithDiscrepancy ? (summary.totals.discrepancyWithin1 / summary.totals.tablesWithDiscrepancy * 100).toFixed(1) : '0.0';
  const pctWithin5 = summary.totals.tablesWithDiscrepancy ? (summary.totals.discrepancyWithin5 / summary.totals.tablesWithDiscrepancy * 100).toFixed(1) : '0.0';
  const pctOver20 = summary.totals.tablesWithDiscrepancy ? (summary.totals.discrepancyOver20 / summary.totals.tablesWithDiscrepancy * 100).toFixed(1) : '0.0';
  console.log(`[validate] reports=${rows.length} costTables=${summary.totals.costTables} uniquePatterns=${Object.keys(patternUsage).length}`);
  console.log(`[validate] reportsWithCostTables=${summary.totals.reportsWithCostTables} (${pctWithCost}%) withoutCostTables=${summary.totals.reportsWithoutCostTables}`);
  console.log(`[validate] discrepancy buckets: <=1% ${pctWithin1}% | <=5% ${pctWithin5}% | >20% ${pctOver20}% (tables=${summary.totals.tablesWithDiscrepancy})`);
}

main().catch(e => { console.error(e); process.exit(1); });
