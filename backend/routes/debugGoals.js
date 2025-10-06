import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// GET /debug/goals -> returns recent goal debug sessions and optionally latest silver report
router.get('/goals', async (req, res) => {
  const debugData = global.__GOAL_DEBUG__ || { sessions: [] };
  const silverDir = path.join(process.cwd(), 'data', 'silver');
  let latestReport = null;
  try {
    if (fs.existsSync(silverDir)) {
      const files = (await fs.promises.readdir(silverDir))
        .filter(f => f.endsWith('.json'))
        .map(f => ({ f, ts: fs.statSync(path.join(silverDir, f)).mtimeMs }))
        .sort((a,b) => b.ts - a.ts);
      if (files.length) {
        const newest = files[0].f;
        latestReport = JSON.parse(await fs.promises.readFile(path.join(silverDir, newest), 'utf-8'));
      }
    }
  } catch (e) {
    // swallow
  }
  res.json({
    goalDebugEnabled: process.env.GOAL_DEBUG === '1',
    sessionCount: debugData.sessions.length,
    sessions: debugData.sessions,
    latestReportSummary: latestReport ? {
      id: latestReport.id,
      totalGoals: latestReport.summary?.totalGoals,
      fallbackUsed: latestReport.metadata?.fallbackGoalHeuristicUsed,
      goalTitles: (latestReport.goals || []).map(g => g.title)
    } : null
  });
});

export default router;
