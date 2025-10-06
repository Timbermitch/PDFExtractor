#!/usr/bin/env node
/**
 * Fetch all Mississippi watershed plan PDFs from the MDEQ index page.
 * Saves them under data/raw/mdeq/<sanitizedFilename>.pdf
 * Skips files that already exist (size > 0).
 */
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { JSDOM } from 'jsdom';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INDEX_URL = 'https://www.mdeq.ms.gov/wp-content/uploads/SurfaceWaterBasinMgtNonPointSourceBranch/Watershed_Plans/MS_Watershed_Plans.htm';

async function main() {
  const html = await (await fetch(INDEX_URL)).text();
  const dom = new JSDOM(html);
  const links = [...dom.window.document.querySelectorAll('a')];
  const pdfHrefs = links.map(a => a.href).filter(h => h && h.toLowerCase().endsWith('.pdf'));
  const unique = [...new Set(pdfHrefs)];
  console.log(`[info] found ${unique.length} PDF links`);
  const outDir = path.join(process.cwd(), 'data', 'raw', 'mdeq');
  await fs.promises.mkdir(outDir, { recursive: true });
  for (const url of unique) {
    const filename = path.basename(new URL(url).pathname);
    const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, '_');
    const outPath = path.join(outDir, safeName);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
      console.log(`[skip] ${safeName} exists`);
      continue;
    }
    try {
      console.log(`[fetch] ${url}`);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      await fs.promises.writeFile(outPath, Buffer.from(buf));
      console.log(`[saved] ${safeName} ${(buf.byteLength/1024).toFixed(1)} KB`);
    } catch (e) {
      console.error(`[error] ${url} ->`, e.message);
    }
  }
  console.log('[done] fetch complete');
}

main().catch(e => { console.error(e); process.exit(1); });
