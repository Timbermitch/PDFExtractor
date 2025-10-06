#!/usr/bin/env node
/**
 * Batch bronze extraction for all raw MDEQ PDFs.
 * For each PDF in data/raw/mdeq, ensure bronze slices exist in backend/data/bronze.
 * Reuses existing single-report ingest pathway by invoking a minimal inline extractor.
 */
import fs from 'fs';
import path from 'path';
import { extractText } from '../services/pdfText.js';
import { parsePdf } from '../services/pdfParsePatched.js';

// Adjusted paths: RAW PDFs live at repoRoot/data/raw/mdeq (outside backend/)
// process.cwd() when run from backend/ points at backend, so climb one level.
const REPO_ROOT = path.resolve(process.cwd(), '..');
const RAW_DIR = path.join(REPO_ROOT, 'data', 'raw', 'mdeq');
const BRONZE_DIR = path.join(process.cwd(), 'data', 'bronze');

function slugify(name) {
  return name.replace(/\.pdf$/i,'')
    .toLowerCase()
    .replace(/[_\s]+/g,'-')
    .replace(/[^a-z0-9-]+/g,'-')
    .replace(/-+/g,'-')
    .replace(/^-|-$/g,'');
}

async function extractPdfToSlices(pdfPath, slug) {
  const buf = await fs.promises.readFile(pdfPath);
  let parsed;
  try {
    const r = await parsePdf(buf);
    parsed = { text: r.text || '', numpages: r.numpages || 0 };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[bronze] pdf-parse patched failed, falling back to pdfjs:', e.message);
    parsed = await extractText(buf);
  }
  const text = parsed.text || '';
  const maxLen = 18000; // keep consistent with prior splitting approach if any
  const baseObj = { slug, source: path.basename(pdfPath), length: text.length };
  if (text.length <= maxLen) {
    const outPath = path.join(BRONZE_DIR, `${slug}.json`);
    if (!fs.existsSync(outPath)) {
      await fs.promises.writeFile(outPath, JSON.stringify({ ...baseObj, text }, null, 2));
    }
    return 1;
  }
  let idx = 0, part = 1, count = 0;
  while (idx < text.length) {
    const slice = text.slice(idx, idx + maxLen);
    const outPath = path.join(BRONZE_DIR, `${slug}-${part}.json`);
    if (!fs.existsSync(outPath)) {
      await fs.promises.writeFile(outPath, JSON.stringify({ ...baseObj, part, text: slice }, null, 2));
    }
    idx += maxLen;
    part++; count++;
  }
  return count;
}

async function main() {
  await fs.promises.mkdir(BRONZE_DIR, { recursive: true });
  const pdfs = (await fs.promises.readdir(RAW_DIR)).filter(f => f.toLowerCase().endsWith('.pdf'));
  if(!pdfs.length){
    console.warn('[warn] No PDFs found in', RAW_DIR);
  }
  for (const pdf of pdfs) {
    const slug = slugify(pdf);
    const existing = fs.readdirSync(BRONZE_DIR).filter(f => f.startsWith(slug));
    if (existing.length) {
      console.log(`[skip] bronze exists for ${slug}`);
      continue;
    }
    try {
      console.log(`[bronze] extracting ${pdf}`);
      const slices = await extractPdfToSlices(path.join(RAW_DIR, pdf), slug);
      console.log(`[bronze] ${slug} slices=${slices}`);
    } catch (e) {
      console.error(`[error] bronze ${pdf} ->`, e.message);
    }
  }
  console.log('[done] bronze batch complete');
}

main().catch(e => { console.error(e); process.exit(1); });
