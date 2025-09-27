import express from 'express';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

const bronzeDir = path.join(process.cwd(), 'data', 'bronze');
const silverDir = path.join(process.cwd(), 'data', 'silver');
const goldDir = path.join(process.cwd(), 'data', 'gold');

async function tryUnlink(file) {
  try { await fs.unlink(file); return true; } catch { return false; }
}

async function deleteAllIn(dir, exts) {
  let count = 0;
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      if (!exts.length || exts.some(e => f.endsWith(e))) {
        if (await tryUnlink(path.join(dir, f))) count++;
      }
    }
  } catch { /* ignore */ }
  return count;
}

// Bulk purge: DELETE /reports
router.delete('/', async (_req, res, next) => {
  try {
    const bronze = await deleteAllIn(bronzeDir, ['.txt']);
    const silver = await deleteAllIn(silverDir, ['.json']);
    const gold = await deleteAllIn(goldDir, ['.json', '.csv']);
    res.json({ purged: { bronze, silver, gold }, total: bronze + silver + gold });
  } catch (e) {
    next(e);
  }
});

router.delete('/:id', async (req, res, next) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ error: 'Missing id' });
  try {
    const targets = [
      path.join(bronzeDir, id + '.txt'),
      path.join(silverDir, id + '.json'),
      path.join(goldDir, id + '.json'),
      path.join(goldDir, id + '.csv')
    ];
    let deleted = 0;
    for (const t of targets) {
      if (await tryUnlink(t)) deleted++;
    }
    res.json({ id, deleted });
  } catch (e) {
    next(e);
  }
});

export default router;