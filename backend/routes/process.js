import express from 'express';
import fs from 'fs';
import path from 'path';
import { extractSections } from '../services/sectionExtractor.js';
import { classifyAmbiguous } from '../services/classifier.js';
import { buildStructuredReport } from '../services/reportBuilder.js';
import { requireBody } from '../utils/errorHandlers.js';

const router = express.Router();

router.post('/', requireBody([]), async (req, res, next) => {
  try {
    const { id, rawText } = req.body;
    let workingText = rawText;
    let bronzeId = id;

    if (!workingText && bronzeId) {
  const bronzePath = path.join(process.cwd(), 'data', 'bronze', `${bronzeId}.json`);
      if (fs.existsSync(bronzePath)) {
        const bronze = JSON.parse(await fs.promises.readFile(bronzePath, 'utf-8'));
        workingText = bronze.rawText;
      }
    }

    if (!workingText) {
      return res.status(400).json({ error: 'rawText or valid bronze id required' });
    }

    const sections = extractSections(workingText);
    const classified = await classifyAmbiguous(sections);
  let structured = buildStructuredReport(classified, { sourceId: bronzeId, sourceFile: bronzeId ? `${bronzeId}.pdf` : null });

    if (!structured || !structured.summary) {
      return res.status(500).json({ error: 'Failed to build structured report' });
    }

    const silverId = bronzeId || structured.metadata?.sourceId || Date.now().toString();
  // Ensure id is present on structured payload
  structured = { ...structured, id: silverId };
  const silverPath = path.join(process.cwd(), 'data', 'silver', `${silverId}.json`);
  await fs.promises.writeFile(silverPath, JSON.stringify(structured, null, 2));

    res.json(structured);
  } catch (err) {
    next(err);
  }
});

export default router;
