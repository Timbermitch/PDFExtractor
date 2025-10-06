#!/usr/bin/env node
/**
 * Scan silver or bronze text for lines suggesting cost tables that were NOT captured
 * by pattern parsing (no matching patternId in costPatternsDetected).
 *
 * Usage: node scripts/audit_cost_patterns.js [silver|bronze]
 */
import fs from 'fs';
import path from 'path';

const mode = (process.argv[2] || 'silver').toLowerCase();
const dataDir = path.join(process.cwd(), 'backend', 'data', mode);
if(!fs.existsSync(dataDir)){
  console.error('[error] directory missing:', dataDir);
  process.exit(1);
}

const COST_CUE_RE = /(cost|unit cost|total cost|estimated cost|match|budget)/i;
const MONEY_RE = /\$[0-9][0-9,]{2,}(?:\.[0-9]{2})?/;

let files = fs.readdirSync(dataDir).filter(f=>f.endsWith('.json'));
let flagged = [];
files.forEach(f => {
  try {
    const full = path.join(dataDir, f);
    const json = JSON.parse(fs.readFileSync(full,'utf8'));
    const patterns = json?.metadata?.costPatternsDetected || [];
    // If we already have at least one cost pattern, skip deep scan unless user wants exhaustive view.
    // We still search for lines that look like distinct cost headers not represented.
    const rawText = json.rawText || json.metadata?.rawText || null;
    if(!rawText) return;
    const lines = rawText.split(/\r?\n/).map(l=>l.trim());
    lines.forEach((line, idx) => {
      if(!line) return;
      if(COST_CUE_RE.test(line) && MONEY_RE.test(line)){
        // Check if already covered by a pattern snippet (title match heuristic)
        const covered = patterns.some(p => (p.title||'').toLowerCase().includes(line.toLowerCase().slice(0,30)));
        if(!covered){
          flagged.push({ file:f, line: idx+1, text: line.slice(0,160) });
        }
      }
    });
  } catch(e){ /* ignore */ }
});

if(!flagged.length){
  console.log('[ok] no unmatched cost-like lines detected');
} else {
  console.log(`[warn] ${flagged.length} potential unmatched cost lines`);
  flagged.slice(0,200).forEach(r => console.log(`${r.file}:${r.line} :: ${r.text}`));
  if(flagged.length > 200) console.log('...(truncated)');
}