import express from 'express';
import fs from 'fs';
import path from 'path';
import { extractSections } from '../services/sectionExtractor.js';
import { classifyAmbiguous } from '../services/classifier.js';
import { buildStructuredReport } from '../services/reportBuilder.js';
import { requireBody } from '../utils/errorHandlers.js';

const router = express.Router();

router.post('/', requireBody([]), async (req, res, next) => {
  const t0 = Date.now();
  try {
    const { id, rawText } = req.body || {};
    let workingText = rawText;
    let bronzeId = id;
    let originalName = null;
    const diag = { steps: [], bronzeId: bronzeId || null };

    function step(label, extra){ diag.steps.push({ label, at: Date.now(), ...(extra||{}) }); }
    step('start');

    // Attempt bronze lookup if only id passed
    if (!workingText && bronzeId) {
      const bronzePath = path.join(process.cwd(), 'data', 'bronze', `${bronzeId}.json`);
      step('bronzePathCheck', { bronzePath, exists: fs.existsSync(bronzePath) });
      if (fs.existsSync(bronzePath)) {
        try {
          const raw = await fs.promises.readFile(bronzePath, 'utf-8');
          const bronze = JSON.parse(raw);
          workingText = bronze.rawText;
          originalName = bronze?.metadata?.originalName || null;
          step('bronzeLoaded', { chars: workingText?.length || 0 });
        } catch(e){
          step('bronzeLoadError', { message: e.message });
        }
      }
    }

    if (!workingText) {
      return res.status(400).json({ error: 'rawText or valid bronze id required', diag });
    }

    // Section extraction
    const sections = extractSections(workingText);
    step('sectionsExtracted', { keys: Object.keys(sections), uncategorized: sections.uncategorized.length });

    if (process.env.GOAL_DEBUG === '1') {
      const rawGoalLines = workingText.split(/\r?\n/).filter(l => /goal/i.test(l));
      console.log('[goal-debug] raw lines containing goal:', rawGoalLines.length);
      try {
        global.__GOAL_DEBUG__ = global.__GOAL_DEBUG__ || { sessions: [] };
        global.__GOAL_DEBUG__.sessions.push({
          timestamp: new Date().toISOString(),
          stage: 'rawTextScan',
          rawGoalLines: rawGoalLines.length
        });
        if (global.__GOAL_DEBUG__.sessions.length > 12) {
          global.__GOAL_DEBUG__.sessions.splice(0, global.__GOAL_DEBUG__.sessions.length - 12);
        }
      } catch(e) { /* ignore */ }
    }

    let classified;
    try {
      classified = await classifyAmbiguous(sections);
      step('classified', { remainingUncategorized: classified.uncategorized?.length || 0 });
    } catch(e){
      step('classificationError', { message: e.message });
      classified = sections; // fallback
    }

    let structured;
    try {
      structured = buildStructuredReport(classified, { sourceId: bronzeId, sourceFile: bronzeId ? `${bronzeId}.pdf` : null });
      step('reportBuilt', { summary: !!structured?.summary, goals: structured?.goals?.length || 0, bmps: structured?.bmps?.length || 0 });
    } catch(e){
      step('reportBuildError', { message: e.message, stack: e.stack?.split('\n').slice(0,4) });
      console.error('[process] buildStructuredReport error:', e);
      return res.status(500).json({ error: 'buildStructuredReport failed', diag });
    }

    if (originalName && structured?.metadata) {
      structured.metadata.originalName = originalName;
    }

    if (!structured || !structured.summary) {
      step('missingSummary');
      return res.status(500).json({ error: 'Failed to build structured report (no summary)', diag });
    }

    // Presence marking
    try {
      const sourceCorpus = (workingText || '').toLowerCase();
      function markPresence(collection, fields) {
        if(!Array.isArray(collection)) return;
        collection.forEach(item => {
          const composite = fields.map(f => (item[f] || '').toString().toLowerCase()).join(' ');
          item._present = composite.length ? sourceCorpus.includes((item.title || item.name || item.description || item.metric || item.activity || '').toLowerCase()) : false;
        });
      }
      markPresence(structured.goals, ['title']);
      markPresence(structured.bmps, ['name']);
      markPresence(structured.implementation, ['description']);
      markPresence(structured.monitoring, ['metric']);
      markPresence(structured.outreach, ['activity']);
      structured.metadata = structured.metadata || {};
      structured.metadata.presence = {
        goals: (structured.goals||[]).filter(g => g._present).length,
        bmps: (structured.bmps||[]).filter(b => b._present).length,
        implementation: (structured.implementation||[]).filter(i => i._present).length,
        monitoring: (structured.monitoring||[]).filter(m => m._present).length,
        outreach: (structured.outreach||[]).filter(o => o._present).length
      };
      step('presenceCalculated');
    } catch(e){ step('presenceError', { message: e.message }); }

    // Write silver output
    try {
      const silverId = bronzeId || structured.metadata?.sourceId || Date.now().toString();
      structured = { ...structured, id: silverId };
      const silverDir = path.join(process.cwd(), 'data', 'silver');
      if(!fs.existsSync(silverDir)){
        await fs.promises.mkdir(silverDir, { recursive: true });
        step('silverDirCreated', { silverDir });
      }
      const silverPath = path.join(silverDir, `${silverId}.json`);
      await fs.promises.writeFile(silverPath, JSON.stringify(structured, null, 2));
      step('silverWritten', { silverPath });
    } catch(e){
      step('silverWriteError', { message: e.message });
    }

    step('done', { ms: Date.now() - t0 });
    res.json(structured);
  } catch (err) {
    console.error('[process] unexpected error', err);
    return res.status(500).json({ error: err.message || 'Server Error', stack: err.stack?.split('\n').slice(0,5), diagHint: 'See server logs for full trace' });
  }
});

export default router;
