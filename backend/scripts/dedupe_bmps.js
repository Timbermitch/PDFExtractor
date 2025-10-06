#!/usr/bin/env node
/**
 * Dedupe BMP names across all silver reports by canonical form.
 * Canonicalization rules:
 *  - Lowercase
 *  - Trim
 *  - Collapse whitespace
 *  - Remove trailing punctuation
 *  - Singularize naive plural (strip trailing 's' if length>4 and resulting token still >3 chars)
 *  - Remove duplicate parentheses spacing
 * Keeps the FIRST occurrence (highest existing confidence if sources differ) and drops later duplicates.
 */
import fs from 'fs';
import path from 'path';

const SILVER_DIR = path.join(process.cwd(), 'backend', 'data', 'silver');

function canon(name){
  if(!name) return '';
  let n = name.toLowerCase().trim();
  n = n.replace(/\s+/g,' ');
  n = n.replace(/[,:;]+$/,'');
  // remove parenthetical duplicates of units like (ft) (feet)
  n = n.replace(/\((feet|ft)\)/g,'(ft)');
  // naive plural trim
  if(/^[a-z0-9 \-()\/]{4,}$/.test(n) && n.endsWith('s') && n.length > 4){
    const singular = n.slice(0,-1);
    if(singular.length > 3) n = singular;
  }
  return n;
}

async function main(){
  const files = fs.readdirSync(SILVER_DIR).filter(f=>f.endsWith('.json'));
  let reportsUpdated=0, removed=0;
  for(const f of files){
    const full = path.join(SILVER_DIR,f);
    const json = JSON.parse(fs.readFileSync(full,'utf8'));
    if(!Array.isArray(json.bmps) || json.bmps.length < 2) continue;
    const seen = new Map(); // canon -> bmp index to keep
    const keep = [];
    json.bmps.forEach(b => {
      const c = canon(b.name);
      if(!c){ return; }
      if(!seen.has(c)){
        seen.set(c, b);
        keep.push(b);
      } else {
        // Preserve higher confidence if duplicate encountered
        const existing = seen.get(c);
        if((b.confidence||0) > (existing.confidence||0)){
            // replace existing in keep array
            const idx = keep.indexOf(existing);
            if(idx !== -1) keep[idx] = b;
            seen.set(c,b);
        }
        removed++;
      }
    });
    if(removed){
      // Re-sequence IDs
      keep.forEach((b,i) => b.id = `B${i+1}`);
      json.bmps = keep;
      json.metadata = json.metadata || {};
      json.metadata.bmpDedupApplied = true;
      fs.writeFileSync(full, JSON.stringify(json,null,2));
      reportsUpdated++;
      console.log(`[bmp-dedupe] ${json.id||f} removedDuplicates=${removed}`);
    }
  }
  console.log(`[done] bmp dedupe complete reportsUpdated=${reportsUpdated} duplicatesRemoved=${removed}`);
}

main().catch(e=>{ console.error(e); process.exit(1); });
