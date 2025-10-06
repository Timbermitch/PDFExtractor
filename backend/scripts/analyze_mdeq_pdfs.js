#!/usr/bin/env node
/**
 * Analyze downloaded MDEQ PDFs: extract raw text, derive candidate table headers & classify cost table patterns.
 * Outputs a JSON summary file per PDF under data/interim/mdeq/<name>.analysis.json
 */
import fs from 'fs';
import path from 'path';
import { extractText } from '../services/pdfText.js';

const RAW_DIR = path.join(process.cwd(), 'data', 'raw', 'mdeq');
const OUT_DIR = path.join(process.cwd(), 'data', 'interim', 'mdeq');

const COST_CUES = [
  'code practice units cost',
  'practice units cost',
  'practice cost',
  'estimated cost',
  'unit cost',
  'landowner match',
  'local match',
  'total cost',
  'cost share',
  'project cost'
];

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  const files = (await fs.promises.readdir(RAW_DIR)).filter(f => f.toLowerCase().endsWith('.pdf'));
  console.log(`[info] analyzing ${files.length} PDFs`);
  for (const f of files) {
    const pdfPath = path.join(RAW_DIR, f);
    const base = f.replace(/\.pdf$/i,'');
    const outPath = path.join(OUT_DIR, base + '.analysis.json');
    if (fs.existsSync(outPath)) {
      console.log(`[skip] analysis exists ${f}`);
      continue;
    }
    try {
      const buf = await fs.promises.readFile(pdfPath);
      const data = await extractText(buf);
      const text = data.text || '';
      const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
      const headerCandidates = [];
      for (let i=0;i<lines.length;i++) {
        const line = lines[i];
        const lower = line.toLowerCase();
        if (COST_CUES.some(c => lower.includes(c))) {
          headerCandidates.push({ index: i, line });
        }
      }
      const snippetWindow = 5;
      const snippets = headerCandidates.map(h => ({
        header: h.line,
        context: lines.slice(Math.max(0, h.index - snippetWindow), h.index + snippetWindow + 1)
      }));
      const summary = {
        file: f,
        pages: data.numpages,
        words: text.split(/\s+/).length,
        headerCandidates: headerCandidates.length,
        snippets
      };
      await fs.promises.writeFile(outPath, JSON.stringify(summary, null, 2));
      console.log(`[ok] ${f} headers=${headerCandidates.length}`);
    } catch (e) {
      console.error(`[error] ${f} ->`, e.message);
    }
  }
  console.log('[done] analysis complete');
}

main().catch(e => { console.error(e); process.exit(1); });
