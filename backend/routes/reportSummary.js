import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// GET /reports/summary -> aggregated cost & pattern statistics across all silver reports
router.get('/summary', async (_req, res) => {
  const candidateDirs = [
    path.join(process.cwd(), 'data', 'silver'),
    path.join(process.cwd(), 'backend', 'data', 'silver')
  ];
  let dir = null;
  for (const d of candidateDirs) { if (fs.existsSync(d)) { dir = d; break; } }
  if (!dir) return res.json({ reports: 0, totals: null, warning: 'silver data directory not found' });
  let files = [];
  try { files = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.json')); } catch (e) {
    return res.status(500).json({ error: 'unable to read silver directory', detail: e.message });
  }

  const aggregate = {
    reportCount: 0,
    reportsWithCosts: 0,
    totalReported: 0,
    totalComputed: 0,
    totalComputedWeighted: 0, // Σ totalComputed * patternConfidence (where available)
    patternUsage: {}, // patternId -> { count, totalReported, totalComputed, weightedComputed, withReportedTotals, within1pct:0, within5pct:0, totalWithBoth:0, sumDiscrepancy:0 }
    discrepancies: [] // collect large discrepancy summaries
  };
  const discrepancyThreshold = 0.01; // 1% relative difference for flagging

  for (const f of files) {
    try {
      const json = JSON.parse(await fs.promises.readFile(path.join(dir, f), 'utf-8'));
      aggregate.reportCount += 1;
      let rep = 0; let comp = 0;
      if (Array.isArray(json?.bmpCostTablesNormalized) && json.bmpCostTablesNormalized.length) {
        json.bmpCostTablesNormalized.forEach(t => {
          const r = Number(t.totalReported); const c = Number(t.totalComputed); const conf = Number(t.patternConfidence);
          if (!Number.isNaN(r) && r > 0) rep += r;
          if (!Number.isNaN(c) && c > 0) comp += c;
          if (!Number.isNaN(c) && c > 0 && !Number.isNaN(conf) && conf > 0) aggregate.totalComputedWeighted += c * Math.min(conf,1);
          if (t.patternId) {
            if (!aggregate.patternUsage[t.patternId]) aggregate.patternUsage[t.patternId] = { count: 0, totalReported: 0, totalComputed: 0, weightedComputed: 0, withReportedTotals:0, within1pct:0, within5pct:0, totalWithBoth:0, sumDiscrepancy:0 };
            const entry = aggregate.patternUsage[t.patternId];
            entry.count += 1;
            if (!Number.isNaN(r) && r > 0) { entry.totalReported += r; entry.withReportedTotals += 1; }
            if (!Number.isNaN(c) && c > 0) entry.totalComputed += c;
            if (!Number.isNaN(c) && c > 0 && !Number.isNaN(conf) && conf > 0) entry.weightedComputed += c * Math.min(conf,1);
            if (!Number.isNaN(r) && r > 0 && !Number.isNaN(c) && c > 0) {
              entry.totalWithBoth += 1;
              const diff = r - c;
              entry.sumDiscrepancy += diff;
              const rel = c ? Math.abs(diff)/c : null;
              if (rel !== null) {
                if (rel <= 0.01) entry.within1pct += 1;
                if (rel <= 0.05) entry.within5pct += 1;
              }
            }
          }
        });
      } else if (json?.bmpCostTableNormalized) {
        const r = Number(json.bmpCostTableNormalized.totalReported);
        const c = Number(json.bmpCostTableNormalized.totalComputed);
        if (!Number.isNaN(r) && r > 0) rep += r;
        if (!Number.isNaN(c) && c > 0) comp += c;
      }
      if (rep > 0 || comp > 0) {
        aggregate.reportsWithCosts += 1;
        aggregate.totalReported += rep;
        aggregate.totalComputed += comp;
        if (rep && comp) {
          const diff = rep - comp;
            const rel = comp ? Math.abs(diff) / comp : null;
            if (rel !== null && rel > discrepancyThreshold) {
              aggregate.discrepancies.push({ report: f.replace(/\.json$/,''), reported: rep, computed: comp, diff, rel });
            }
        }
      }
    } catch { /* skip unreadable file */ }
  }

  // Convert patternUsage object to sorted array by totalReported desc for easier client consumption
  const patternArray = Object.entries(aggregate.patternUsage).map(([patternId, v]) => ({
    patternId,
    count: v.count,
    totalReported: v.totalReported,
    totalComputed: v.totalComputed,
    weightedComputed: v.weightedComputed,
    withReportedTotals: v.withReportedTotals,
    totalWithBoth: v.totalWithBoth,
    pctWithin1pct: v.totalWithBoth ? v.within1pct / v.totalWithBoth : 0,
    pctWithin5pct: v.totalWithBoth ? v.within5pct / v.totalWithBoth : 0,
    avgDiscrepancy: v.totalWithBoth ? v.sumDiscrepancy / v.totalWithBoth : null,
    sumDiscrepancy: v.sumDiscrepancy
  }));
  patternArray.sort((a,b) => b.totalComputed - a.totalComputed);

  res.json({
    reportCount: aggregate.reportCount,
    reportsWithCosts: aggregate.reportsWithCosts,
    totalReported: aggregate.totalReported,
    totalComputed: aggregate.totalComputed,
    discrepancy: aggregate.totalReported && aggregate.totalComputed ? (aggregate.totalReported - aggregate.totalComputed) : null,
    totalComputedWeighted: aggregate.totalComputedWeighted || null,
    patternUsage: patternArray,
    discrepancyFlags: aggregate.discrepancies
  });
});

export default router;
