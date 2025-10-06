import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

router.get('/', async (_req, res, next) => {
  try {
    // Resolve silver directory robustly whether server started in project root or backend/.
    const candidateDirs = [
      path.join(process.cwd(), 'data', 'silver'),
      path.join(process.cwd(), 'backend', 'data', 'silver')
    ];
    let dir = null;
    for (const d of candidateDirs) {
      try { if (fs.existsSync(d)) { dir = d; break; } } catch { /* ignore */ }
    }
    if (!dir) {
      return res.json({ reports: [], warning: 'silver data directory not found' });
    }
    let files = [];
    try {
      files = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.json'));
    } catch (e) {
      return res.json({ reports: [], error: 'unable to read silver directory', detail: e.message });
    }

    const items = [];
    for (const f of files) {
      try {
        const full = path.join(dir, f);
        const raw = await fs.promises.readFile(full, 'utf-8');
        const json = JSON.parse(raw);
        const id = path.basename(f, '.json');
        const originalName = json?.metadata?.originalName;
        const displayName = originalName ? path.basename(originalName, path.extname(originalName)) : id;

        // Aggregate normalized BMP cost totals if present (multi-table aware)
        let costReported = 0;
        let costComputed = 0;
        let tablesWithCosts = 0;
        if (Array.isArray(json?.bmpCostTablesNormalized) && json.bmpCostTablesNormalized.length) {
          json.bmpCostTablesNormalized.forEach(t => {
            const rep = Number(t.totalReported);
            const comp = Number(t.totalComputed);
            if (!Number.isNaN(rep) && rep > 0) costReported += rep;
            if (!Number.isNaN(comp) && comp > 0) costComputed += comp;
            if ((rep && rep > 0) || (comp && comp > 0)) tablesWithCosts += 1;
          });
        } else if (json?.bmpCostTableNormalized) { // backward single-table support
          const rep = Number(json.bmpCostTableNormalized.totalReported);
          const comp = Number(json.bmpCostTableNormalized.totalComputed);
          if (!Number.isNaN(rep) && rep > 0) { costReported += rep; tablesWithCosts += 1; }
          if (!Number.isNaN(comp) && comp > 0) { costComputed += comp; if (!tablesWithCosts) tablesWithCosts += 1; }
        }
        const hasCostData = tablesWithCosts > 0;

        // Provide top-level pattern metadata summary count if available for quick UI hint.
        const patterns = Array.isArray(json?.metadata?.costPatternsDetected) ? json.metadata.costPatternsDetected : [];

        items.push({
          id,
          displayName,
          summary: json.summary,
          generatedAt: json.generatedAt,
            costSummary: hasCostData ? {
              tables: tablesWithCosts,
              totalReported: costReported || null,
              totalComputed: costComputed || null,
              discrepancy: (costReported && costComputed) ? (costReported - costComputed) : null,
              patternCount: patterns.length || null
            } : null
        });
      } catch (err) {
        // Skip bad file but include minimal diagnostic once per failure type if needed later
        continue; // eslint-disable-line
      }
    }
    res.json({ reports: items });
  } catch (e) {
    next(e);
  }
});

export default router;
