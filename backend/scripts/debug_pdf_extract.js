#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { extractText } from '../services/pdfText.js';

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node debug_pdf_extract.js <PDF filename in data/raw/mdeq>');
    process.exit(1);
  }
  const pdfPath = path.join(process.cwd(), 'data', 'raw', 'mdeq', target);
  if (!fs.existsSync(pdfPath)) {
    console.error('Not found:', pdfPath);
    process.exit(1);
  }
  const buf = fs.readFileSync(pdfPath);
  console.log('[debug] size bytes=', buf.length);
  const t0 = Date.now();
  try {
    const result = await extractText(buf);
    console.log('[debug] pages=', result.numpages, 'chars=', result.text.length, 'ms=', Date.now()-t0);
    console.log('--- first 500 chars ---');
    console.log(result.text.slice(0,500));
  } catch (e) {
    console.error('[debug] extraction failed:', e.message);
    console.error(e.stack);
  }
}

main();
