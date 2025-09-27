import express from 'express';
import fs from 'fs';
import path from 'path';
import { convertToCSV } from '../utils/toCSV.js';

const router = express.Router();

const ALLOWED_FORMATS = new Set(['json','csv']);

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    let { format = 'json' } = req.query;
    format = String(format).toLowerCase();
    if (!ALLOWED_FORMATS.has(format)) {
      return res.status(400).json({ error: 'Unsupported format' });
    }

  const silverPath = path.join(process.cwd(), 'data', 'silver', `${id}.json`);
    if (!fs.existsSync(silverPath)) {
      return res.status(404).json({ error: 'Report not found' });
    }

  let structured = JSON.parse(await fs.promises.readFile(silverPath, 'utf-8'));
  if (!structured.id) structured.id = id;

    if (format === 'csv') {
      const csv = convertToCSV(structured);
  const goldPath = path.join(process.cwd(), 'data', 'gold', `${id}.csv`);
      await fs.promises.writeFile(goldPath, csv);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=${id}.csv`);
      return res.send(csv);
    } else {
  const goldPath = path.join(process.cwd(), 'data', 'gold', `${id}.json`);
      await fs.promises.writeFile(goldPath, JSON.stringify(structured, null, 2));
      res.json(structured);
    }
  } catch (err) {
    next(err);
  }
});

export default router;
