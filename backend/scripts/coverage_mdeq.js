#!/usr/bin/env node
/**
 * Coverage report for MDEQ watershed plan corpus.
 * Scans:
 *   data/raw/mdeq/*.pdf           (raw downloads)
 *   backend/data/bronze/*.json    (bronze slices)
 *   backend/data/silver/*.json    (silver structured reports)
 * A bronze presence is "true" if at least one slice file exists whose name starts with the slug.
 * A silver presence is "true" if a silver json exists whose name starts with the slug.
 * Slug derivation: lowercase, underscores/spaces -> hyphens, non-alnum trimmed/collapsed.
 *
 * Output: backend/data/coverage/mdeq_coverage.json
 */
import fs from 'fs';
import path from 'path';

const RAW_DIR = path.join(process.cwd(), 'data', 'raw', 'mdeq');
const BRONZE_DIR = path.join(process.cwd(), 'backend', 'data', 'bronze');
const SILVER_DIR = path.join(process.cwd(), 'backend', 'data', 'silver');
const OUT_DIR = path.join(process.cwd(), 'backend', 'data', 'coverage');

function slugifyPdfName(name) {
  // Remove extension
  const base = name.replace(/\.pdf$/i, '');
  return base
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function collectBaseSlices(dir) {
  if (!fs.existsSync(dir)) return { files: [], bases: [] };
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
  const bases = new Set();
  for (const f of files) {
    const withoutExt = f.replace(/\.json$/,'');
    // Strip a single trailing -digits ONLY (slice index), leaving other hyphens intact
    const base = withoutExt.replace(/-\d+$/,'');
    bases.add(base);
  }
  return { files, bases: [...bases] };
}

async function main() {
  await fs.promises.mkdir(OUT_DIR, { recursive: true });
  if (!fs.existsSync(RAW_DIR)) {
    console.error('Raw directory missing:', RAW_DIR);
    process.exit(1);
  }
  const rawPdfs = fs.readdirSync(RAW_DIR).filter(f => f.toLowerCase().endsWith('.pdf'));
  const { bases: bronzeBases } = collectBaseSlices(BRONZE_DIR);
  const { bases: silverBases } = collectBaseSlices(SILVER_DIR);

  const rows = [];
  for (const pdf of rawPdfs) {
    const slug = slugifyPdfName(pdf);
    const hasBronze = bronzeBases.includes(slug) || bronzeBases.some(b => b === slug || slug.startsWith(b) || b.startsWith(slug));
    const hasSilver = silverBases.includes(slug) || silverBases.some(b => b === slug || b.startsWith(slug) || slug.startsWith(b));
    rows.push({ pdf, slug, hasBronze, hasSilver });
  }

  const total = rows.length;
  const bronzeCount = rows.filter(r => r.hasBronze).length;
  const silverCount = rows.filter(r => r.hasSilver).length;
  const missingBronze = rows.filter(r => !r.hasBronze).map(r => r.slug);
  const missingSilver = rows.filter(r => r.hasBronze && !r.hasSilver).map(r => r.slug);

  const summary = {
    generatedAt: new Date().toISOString(),
    totals: { raw: total, bronze: bronzeCount, silver: silverCount },
    pctBronze: total ? +(bronzeCount / total * 100).toFixed(1) : 0,
    pctSilver: total ? +(silverCount / total * 100).toFixed(1) : 0,
    missingBronze,
    missingSilver,
    rows
  };

  const outPath = path.join(OUT_DIR, 'mdeq_coverage.json');
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`[coverage] raw=${total} bronze=${bronzeCount} (${summary.pctBronze}%) silver=${silverCount} (${summary.pctSilver}%)`);
  console.log(`[coverage] missing bronze=${missingBronze.length} missing silver=${missingSilver.length}`);

  if (process.argv.includes('--print')) {
    for (const r of rows) {
      console.log(`${r.hasBronze ? 'B' : '-'}${r.hasSilver ? 'S' : '-'}  ${r.slug}`);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
