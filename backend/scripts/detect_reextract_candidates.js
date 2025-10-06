#!/usr/bin/env node
/**
 * Identify bronze JSON files that are likely truncated for re-extraction.
 * Current heuristic: rawText/text length exactly 18000 OR length < 600 with numeric suffix (tiny fragment).
 * Outputs list to stdout and writes JSON to data/validation/reextract_candidates.json
 */
import fs from 'fs';
import path from 'path';

const bronzeDir = path.join(process.cwd(), 'backend', 'data', 'bronze');
if (!fs.existsSync(bronzeDir)) {
  console.error('[fatal] bronze directory not found');
  process.exit(1);
}
const files = fs.readdirSync(bronzeDir).filter(f => f.endsWith('.json'));

const candidates = [];
for (const f of files) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(bronzeDir, f), 'utf-8'));
    const text = raw.rawText || raw.text || '';
    const len = text.length;
    const tiny = /-\d+\.json$/.test(f) && len > 0 && len < 600; // very small part likely orphaned
    if (len === 18000 || tiny) {
      candidates.push({ file: f, length: len, reason: len === 18000 ? 'exact_18000_truncation' : 'tiny_fragment' });
    }
  } catch (e) {
    console.warn('[warn] parse failed', f, e.message);
  }
}

console.log('Re-extraction Candidates:');
for (const c of candidates) {
  console.log(`${c.file} length=${c.length} reason=${c.reason}`);
}

const outDir = path.join(process.cwd(), 'backend', 'data', 'validation');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'reextract_candidates.json'), JSON.stringify({ generatedAt: new Date().toISOString(), count: candidates.length, candidates }, null, 2));
console.log('\nSaved JSON to data/validation/reextract_candidates.json (count=' + candidates.length + ')');
