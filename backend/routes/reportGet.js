import express from 'express';
import fs from 'fs';
import path from 'path';

const router = express.Router();

// GET /report/:id -> return silver structured report JSON if exists, else 404
router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params;
    if(!id) return res.status(400).json({ error: 'id required' });
    const rebuild = /^(1|true|yes)$/i.test(String(req.query.rebuild||''));
    const silverPath = path.join(process.cwd(), 'data', 'silver', `${id}.json`);
    if(!fs.existsSync(silverPath) && !rebuild){
      return res.status(404).json({ error: 'report not found', id });
    }
    if(!rebuild){
      const json = JSON.parse(await fs.promises.readFile(silverPath, 'utf-8'));
      // Lightweight on-the-fly BMP name cleanup for legacy reports (strip quantity/@/cost tails)
      if(Array.isArray(json.bmps)){
        const stripCostTail = (name) => {
          if(!name) return name;
          if(!(/[\$@]/.test(name) || /\d/.test(name))) return name;
          const m = name.match(/^(.*?)(?:\s+\d[\d,]*(?:\.[0-9]+)?\s*(?:ac|acre|acres|ft|feet|ea|es|lf|yd|yds|cy|cuyd|sq\.?ft\.?|ac\.|ft\.|ea\.)\b.*|\s+@\s*\$|\s+\$[0-9])/i);
          if(m && m[1]){
            const cleaned = m[1].trim().replace(/[,:;]+$/,'').trim();
            if(cleaned && cleaned.length>=2) return cleaned;
          }
          return name;
        };
        const seen = new Set();
        json.bmps.forEach(b => { const cleaned = stripCostTail(b.name); if(cleaned !== b.name){ b.originalName = b.name; b.name = cleaned; b.source = (b.source? b.source+'|' : '') + 'name_cost_tail_trim_fetch'; } });
        // Deduplicate now-clean names
        const dedup = [];
        json.bmps.forEach(b => { const k=(b.name||'').toLowerCase(); if(!k) return; if(seen.has(k)) return; seen.add(k); dedup.push(b); });
        if(dedup.length !== json.bmps.length) json.bmps = dedup.map((b,i)=>({...b,id:`B${i+1}`}));
      }
      return res.json(json);
    }
    // Rebuild path: load bronze, extract sections, run buildStructuredReport, write & return
    const bronzePath = path.join(process.cwd(), 'backend', 'data', 'bronze', `${id}.json`);
    const altBronzePath = path.join(process.cwd(), 'data', 'bronze', `${id}.json`);
    const usableBronze = fs.existsSync(bronzePath) ? bronzePath : (fs.existsSync(altBronzePath) ? altBronzePath : null);
    if(!usableBronze) return res.status(404).json({ error: 'bronze source missing', id });
    const bronze = JSON.parse(await fs.promises.readFile(usableBronze,'utf-8'));
    if(!bronze.rawText) return res.status(400).json({ error: 'bronze missing rawText', id });
    const { extractSections } = await import('../services/sectionExtractor.js');
    const { buildStructuredReport } = await import('../services/reportBuilder.js');
    const sections = extractSections(bronze.rawText);
    const structured = buildStructuredReport(sections, { sourceId:id, sourceFile: bronze.metadata?.originalName||null });
    // Persist updated silver (overwrite)
    await fs.promises.mkdir(path.dirname(silverPath), { recursive: true });
    await fs.promises.writeFile(silverPath, JSON.stringify(structured,null,2),'utf-8');
    res.json({ rebuilt:true, ...structured });
  } catch (e) {
    next(e);
  }
});

export default router;
