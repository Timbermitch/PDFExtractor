import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

function safeReadJSON(p){
  try { if(fs.existsSync(p)) return JSON.parse(fs.readFileSync(p,'utf8')); } catch {/* ignore */}
  return null;
}

router.get('/coverage', (_req,res) => {
  const p = path.join(process.cwd(),'backend','data','coverage','mdeq_coverage.json');
  const data = safeReadJSON(p);
  if(!data) return res.status(404).json({ error: 'coverage summary not found' });
  res.json({ coverage: data });
});

router.get('/validation', (_req,res) => {
  const p = path.join(process.cwd(),'backend','data','validation','mdeq_corpus_summary.json');
  const data = safeReadJSON(p);
  if(!data) return res.status(404).json({ error: 'validation summary not found' });
  res.json({ validation: data });
});

export default router;
