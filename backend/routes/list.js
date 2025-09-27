import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

router.get('/', async (req, res, next) => {
  try {
  // process.cwd() already points at backend/ when server is started there.
  // Previous code duplicated 'backend/backend'. Adjust to single data root.
  const dir = path.join(process.cwd(), 'data', 'silver');
    const files = (await fs.promises.readdir(dir)).filter(f => f.endsWith('.json'));
    const items = [];
    for (const f of files) {
      try {
        const json = JSON.parse(await fs.promises.readFile(path.join(dir, f), 'utf-8'));
        const id = path.basename(f, '.json');
        const originalName = json?.metadata?.originalName;
        const displayName = originalName ? path.basename(originalName, path.extname(originalName)) : id;
        items.push({ id, displayName, summary: json.summary, generatedAt: json.generatedAt });
      } catch (_) { /* skip file */ }
    }
    res.json({ reports: items });
  } catch (e) {
    next(e);
  }
});

export default router;
