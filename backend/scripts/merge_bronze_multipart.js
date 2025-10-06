#!/usr/bin/env node
/**
 * Merge multipart bronze JSON fragments (name-1.json, name-2.json ...) into a single
 * unified bronze JSON with full rawText, preserving original metadata.
 *
 * Output is written to backend/data/bronze_merged/<slug>.json
 * Originals are left untouched. A manifest of merges is written to
 * backend/data/validation/bronze_merge_manifest.json
 */
import fs from 'fs';
import path from 'path';

const bronzeDir = path.join(process.cwd(), 'backend', 'data', 'bronze');
const outDir = path.join(process.cwd(), 'backend', 'data', 'bronze_merged');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

const files = fs.readdirSync(bronzeDir).filter(f => f.endsWith('.json'));

function base(slug){
  return slug.replace(/-\d+\.json$/, '').replace(/\.json$/, '');
}

// Group parts
const groups = new Map();
for (const f of files) {
  const b = base(f);
  if (!groups.has(b)) groups.set(b, []);
  groups.get(b).push(f);
}

const manifest = [];
for (const [slug, parts] of groups.entries()) {
  // Only merge if multiple part files present with numeric suffixes
  const numericParts = parts.filter(p => /-\d+\.json$/.test(p));
  if (numericParts.length === 0) continue;
  // Sort by numeric suffix
  numericParts.sort((a,b) => {
    const na = parseInt(a.match(/-(\d+)\.json$/)[1], 10);
    const nb = parseInt(b.match(/-(\d+)\.json$/)[1], 10);
    return na - nb;
  });
  let combinedText = '';
  let totalLen = 0;
  let originalName = null;
  let pageCount = 0;
  const partMeta = [];
  for (const p of numericParts) {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(bronzeDir, p), 'utf-8'));
      const text = raw.rawText || raw.text || raw.partText || raw.content || raw.body || raw.fullText || raw.textContent || '';
      combinedText += (combinedText ? '\n\n' : '') + text;
      totalLen += text.length;
      if (!originalName && raw.metadata?.originalName) originalName = raw.metadata.originalName;
      if (raw.metadata?.pageCount) pageCount += raw.metadata.pageCount; // crude sum
      partMeta.push({ file: p, length: text.length });
    } catch (e) {
      console.warn('[merge-warn] Failed to read part', p, e.message);
    }
  }
  if (!combinedText) continue;
  const out = {
    id: slug,
    rawText: combinedText,
    metadata: {
      id: slug,
      originalName: originalName || slug + '.pdf',
      mergedFrom: numericParts,
      pageCount: pageCount || undefined,
      mergedAt: new Date().toISOString(),
      length: totalLen
    }
  };
  fs.writeFileSync(path.join(outDir, slug + '.json'), JSON.stringify(out, null, 2));
  manifest.push({ slug, parts: numericParts.length, totalLen, partMeta });
  console.log('[merged]', slug, 'parts=', numericParts.length, 'len=', totalLen);
}

const validationDir = path.join(process.cwd(), 'backend', 'data', 'validation');
if (!fs.existsSync(validationDir)) fs.mkdirSync(validationDir, { recursive: true });
fs.writeFileSync(path.join(validationDir, 'bronze_merge_manifest.json'), JSON.stringify(manifest, null, 2));
console.log('\nWrote merge manifest to data/validation/bronze_merge_manifest.json');
