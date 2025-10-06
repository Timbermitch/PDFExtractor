// Pattern-based cost table parsing registry.
// Each pattern exports: id, headerTest(line, allLines, index) -> boolean, parse(allLines, startIndex) -> { table, normalized }
// The parse return shape mirrors legacy parseWindow() output so integration is low-risk.

function moneyToNumber(str){
  if(!str) return null; const m = str.match(/\$?([0-9][0-9,]*(?:\.[0-9]{2})?)/); if(!m) return null; const n = parseFloat(m[1].replace(/,/g,'')); return Number.isNaN(n)? null: n; }

// Shared unit canonicalizer (minimal subset; legacy retains full map inside reportBuilder)
function canonicalizeUnit(u){ if(!u) return null; const raw=u.toLowerCase().replace(/\.$/,''); const map={ 'each':'each','ea':'each','ac':'acre','acre':'acre','acres':'acre','ft':'ft','feet':'ft','cuyd':'cu_yd','cy':'cu_yd','sqft':'sq_ft','gal':'gal','no':'each'}; return map[raw]||raw.replace(/[^a-z0-9_]/g,''); }

const patterns = [
  {
    id: 'sparse_inline_costs',
    description: 'Dispersed lines each containing a single $ amount within a limited window (non-contiguous narrative costs)',
    headerTest: (line, all, i) => {
      // Qualify candidate lines: contains exactly one $ amount and some alphabetic text before it
      if(!/\$[0-9]/.test(line)) return false;
      const dollarMatches = line.match(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/g);
      if(!dollarMatches || dollarMatches.length !== 1) return false;
      if(!/[A-Za-z]{3,}/.test(line)) return false;
      // Sliding window density: in next 60 lines (including this) count distinct lines meeting same rule (allow sparse gaps)
      let count=0; let scanned=0; for(let k=i; k<all.length && scanned<70; k++, scanned++){ const L=all[k]; if(!L) continue; const m=L.match(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/g); if(m && m.length===1 && /[A-Za-z]{3,}/.test(L)) count++; }
      return count >= 5; // require at least 5 within window
    },
    parse: (allLines, startIndex) => {
      // Collect up to 120 lines forward, gather qualifying dollar lines until a hard break (2 consecutive blanks) or 120 lines
      const rows=[]; let blanks=0; let end=startIndex; const maxSpan= startIndex+140; for(let i=startIndex; i<allLines.length && i<maxSpan; i++){ const L=allLines[i]; if(!L){ blanks++; if(blanks>=2) break; else continue; } else blanks=0; const dollarMatches=L.match(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/g); if(dollarMatches && dollarMatches.length===1 && /[A-Za-z]{3,}/.test(L)){ // split name vs cost at last dollar
          const m=L.match(/^(.*?)(\$[0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/); if(m){ const name=m[1].trim().replace(/[:•\-]+\s*$/,''); const cost=m[2]; if(name){ rows.push({ Item:name, Cost:cost, Raw:L }); end=i; } }
        }
      }
      if(rows.length < 5) return null;
      let sum=0; const norm=rows.map(r=>{ const val=moneyToNumber(r.Cost); if(val!=null) sum+=val; return { name:r.Item, totalCost:val, rawCost:r.Cost }; });
      return { table:{ columns:['Item','Cost'], rows: rows.map(r=>({ Item:r.Item, Cost:r.Cost })), total:null }, normalized:{ rows:norm, totalReported:null, totalComputed:sum, discrepancy:null, patternId:'sparse_inline_costs', patternConfidence:0.45 }, dollarLineIndices: rows.map(r=> allLines.indexOf(r.Raw)) };
    }
  },
  {
    id: 'narrative_cost_block',
    description: 'Fallback explicit: contiguous list of 4+ lines ending in dollar amounts without recognizable header',
    headerTest: (line, all, i) => {
      // Trigger if line ends with dollar and previous line not already a header captured, and we see density ahead
      if(!/\$[0-9]/.test(line)) return false;
      // Reject if line matches known headers tokens to avoid duplication
      if(/Practice\s+Producer\s+NRCS|Activity\s+Size|Practice\s+Average\s+Unit/i.test(line)) return false;
      // Look ahead gather up to 10 contiguous lines with dollars
      let count=0; for(let k=i;k<i+12 && k<all.length;k++){ const l=all[k]; if(!l || /^\s*$/.test(l)) break; if(/\$[0-9]/.test(l)) count++; else break; }
      return count >= 4;
    },
    parse: (allLines, startIndex) => {
      const rows=[]; let j=startIndex; for(; j<allLines.length && j<startIndex+40; j++){ const l=allLines[j]; if(!l || /^\s*$/.test(l)) break; if(!/\$[0-9]/.test(l)) break; // stop block at first non-dollar line
        // Extract last dollar amount as cost, name is everything before it
        const m = l.match(/^(.*?)(\$[0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/); if(!m) continue; const name=m[1].trim().replace(/[\-•]+\s*/,''); const cost=m[2]; if(!name) continue; rows.push({ Item: name, Cost: cost }); }
      if(rows.length < 4) return null; let sum=0; const norm = rows.map(r=>{ const val = moneyToNumber(r.Cost); if(val!=null) sum+=val; return { name: r.Item, totalCost: val, rawCost: r.Cost }; });
      return { table:{ columns:['Item','Cost'], rows, total: null }, normalized:{ rows: norm, totalReported: null, totalComputed: sum, discrepancy: null, patternId:'narrative_cost_block', patternConfidence:0.55 }, dollarLineIndices: rows.map((_,idx)=> startIndex + idx) };
    }
  },
  {
    id: 'coded_activity_budget_loose',
    description: 'Loose coded activity budget lines (A1., B12., etc.) without explicit header',
    headerTest: (line, all, i) => {
      // Trigger on a code line with trailing dollar amount, ensure density ahead
      const codeRe = /^(?:\*?)([A-Z]{1,2}[0-9]{1,3})\.[\s\-]+.*?\$[0-9][0-9,]*(?:\.[0-9]{2})?/;
      if(!codeRe.test(line)) return false;
      let aheadCount = 0; const slice = all.slice(i+1, i+15);
      slice.forEach(l=>{ if(codeRe.test(l)) aheadCount++; });
      return aheadCount >= 2; // require at least 2 more coded lines with dollars
    },
    parse: (allLines, startIndex) => {
      const codeRe = /^(?:\*?)([A-Z]{1,2}[0-9]{1,3})\.[\s\-]+(.+?)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)(?:\s+\(.*?\))?\s*$/;
      const window = allLines.slice(startIndex, startIndex+160);
      const rows = []; let j=0; let section=null; let grandTotal = 0;
      for(; j<window.length; j++){
        const raw = window[j]; if(!raw) break;
        if(/^(Goal|Objective|Section|Table)\b/i.test(raw)) break; // stop at new section
        if(/^Subtotal:/i.test(raw)) { // capture subtotals but don't treat as row
          const mSub = raw.match(/Subtotal:\s*\$([0-9][0-9,]*(?:\.[0-9]{2})?)/i); if(mSub){ grandTotal += parseFloat(mSub[1].replace(/,/g,'')); } continue; }
        const m = raw.match(codeRe);
        if(m){
          const code = m[1];
          const desc = m[2].trim();
          const amountNum = parseFloat(m[3].replace(/,/g,''));
          rows.push({ Code: code, Description: desc, Amount: '$'+m[3], Section: section });
          if(!Number.isNaN(amountNum)) grandTotal += amountNum;
          continue;
        } else {
          // allow short continuation descriptor lines (no dollar) immediately after a coded line
          if(rows.length && /^(?:\(|for\b|to\b|and\b)/i.test(raw.trim()) && !/\$[0-9]/.test(raw)) {
            rows[rows.length-1].Description += ' ' + raw.trim();
            continue;
          }
          // If we already collected a decent block and line no longer matches, end.
          if(rows.length >= 5) break;
          // Otherwise keep scanning in case of sparse noise
        }
      }
      if(rows.length < 5) return null; // heuristic threshold to avoid noise
      const normRows = rows.map(r=>({ name: r.Code + ' ' + r.Description, code: r.Code, section: r.Section, totalCost: moneyToNumber(r.Amount), rawCost: r.Amount }));
      const totalComputed = normRows.reduce((a,b)=> a + (b.totalCost||0), 0);
      return { table:{ columns:['Code','Description','Amount','Section'], rows, total: grandTotal || null }, normalized:{ rows: normRows, totalReported: grandTotal || null, totalComputed, discrepancy: (grandTotal? grandTotal - totalComputed: null), patternId:'coded_activity_budget_loose', patternConfidence:0.68 }, dollarLineIndices: rows.map((_,idx)=> startIndex + idx) };
    }
  },
  {
    id: 'practice_unit_cost_range',
    description: 'Practice | Unit Cost (may be range) | Number of Units | Total Cost (may be range)',
    headerTest: (line, all, i) => {
      if(/Practice\s+Unit\s+Cost/i.test(line) && /Number\s+of\s+Units/i.test(line) && /Total\s+Cost/i.test(line)) return true;
      // Fallback: detect first data row and at least 2 more within next 15 lines
      const rowRe = /^(.*?)\s+\$[0-9][0-9,]*(?:\.[0-9]{2})?(?:\s*-\s*\$[0-9][0-9,]*(?:\.[0-9]{2})?)?\s+[0-9][0-9,].*?\s+\$[0-9][0-9,]*(?:\.[0-9]{2})?/;
      if(!rowRe.test(line)) return false;
      const slice = all.slice(i+1, i+16);
      let count=0; slice.forEach(l=>{ if(rowRe.test(l)) count++; });
      return count>=2; // current + at least 2 others
    },
    parse: (allLines, startIndex) => {
      const window = allLines.slice(startIndex+1, startIndex+120);
      const rows = []; let reportedTotalMin=null, reportedTotalMax=null; let j=0;
      const rowRe = /^(.*?)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)(?:\s*-\s*\$([0-9][0-9,]*(?:\.[0-9]{2})?))?\s+([0-9][0-9,]*(?:\s*(?:ac|acre|acres|ft|feet|mi|machines?|hrs?|hours?|units?|basins?|ac|ea))?(?:\s*x\s*[0-9][0-9,]*\s*ft)?)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)(?:\s*-\s*\$([0-9][0-9,]*(?:\.[0-9]{2})?))?\s*$/i;
      for(; j<window.length; j++){
        const raw = window[j]; if(!raw) break;
        if(/^Total/i.test(raw.trim()) || /^TOTAL/i.test(raw.trim())){ // attempt to capture reported total range
          const dollars = [...raw.matchAll(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/g)].map(m=>m[0]);
            if(dollars.length){ const nums=dollars.map(d=>parseFloat(d.replace(/[$,]/g,''))).sort((a,b)=>a-b); reportedTotalMin = nums[0]; reportedTotalMax = nums[nums.length-1]; }
          break;
        }
        if(/Table\s+\d+|Goal|Objective/i.test(raw)) break; // bail on next section
        // Continuation lines that begin with $ (extra unit cost line for same practice)
        if(/^\$[0-9]/.test(raw.trim()) && rows.length){ rows[rows.length-1].continuation = (rows[rows.length-1].continuation||[]).concat([raw.trim()]); continue; }
        const m = raw.match(rowRe);
        if(m){
          const practice = m[1].trim();
          const unitMin = parseFloat(m[2].replace(/,/g,''));
          const unitMax = m[3]? parseFloat(m[3].replace(/,/g,'')) : unitMin;
          const unitsRaw = m[4].trim();
          const totalMin = parseFloat(m[5].replace(/,/g,''));
          const totalMax = m[6]? parseFloat(m[6].replace(/,/g,'')) : totalMin;
          rows.push({ Practice: practice, UnitCostRaw: m[2] + (m[3]? (' - '+m[3]): ''), Units: unitsRaw, TotalCostRaw: m[5] + (m[6]? (' - '+m[6]): '') , unitMin, unitMax, totalMin, totalMax });
        }
      }
      if(!rows.length) return null;
      const normRows = rows.map(r=>{ const qtyMatch = r.Units.match(/([0-9][0-9,]*)/); const quantity = qtyMatch? parseFloat(qtyMatch[1].replace(/,/g,'')) : null; const unitTok = r.Units.replace(/^[0-9][0-9,]*/,'').trim().split(/\s+/)[0]||null; const unit = unitTok? canonicalizeUnit(unitTok): null; const totalCost = (r.totalMin + r.totalMax)/2; return { name: r.Practice, quantity, unit, unitRaw: unitTok||null, unitCost: (r.unitMin && r.unitMax)? (r.unitMin + r.unitMax)/2 : r.unitMin, totalCost, rawSize: r.Units, rawCost: r.TotalCostRaw, unitCostMin: r.unitMin, unitCostMax: r.unitMax, totalCostMin: r.totalMin, totalCostMax: r.totalMax }; });
      const totalReported = (reportedTotalMin!=null && reportedTotalMax!=null) ? (reportedTotalMin+reportedTotalMax)/2 : null;
      const totalComputed = normRows.reduce((a,b)=> a + (b.totalCost||0), 0) || null;
      return { table:{ columns:['Practice','Unit Cost','Number of Units','Total Cost'], rows: rows.map(r=>({ Practice:r.Practice, 'Unit Cost': r.UnitCostRaw, 'Number of Units': r.Units, 'Total Cost': r.TotalCostRaw })), total: totalReported }, normalized:{ rows: normRows, totalReported, totalComputed, discrepancy: (totalReported!=null && totalComputed!=null)? (totalReported - totalComputed): null, patternId:'practice_unit_cost_range', patternConfidence:0.78 }, dollarLineIndices: rows.map((_,idx)=> startIndex + 1 + idx) };
    }
  },
  {
    id: 'activity_unit_cost_range',
    description: 'Activity | Unit cost* (range) | Number of units | Total cost (range)',
    headerTest: (line, all, i)=> {
      if(/Activity\s+Unit\s+cost/i.test(line) && /Number\s+of\s+units/i.test(line) && /Total\s+cost/i.test(line)) return true;
      const rowRe = /^(.*?)\s+\$[0-9][0-9,]*(?:\.[0-9]{2})?(?:\s*-\s*\$[0-9][0-9,]*(?:\.[0-9]{2})?)?\s+[0-9][0-9,].*?\s+\$[0-9][0-9,]*(?:\.[0-9]{2})?/;
      if(!rowRe.test(line)) return false;
      const slice = all.slice(i+1, i+15);
      let count=0; slice.forEach(l=>{ if(rowRe.test(l)) count++; });
      return count>=2;
    },
    parse: (allLines, startIndex) => {
      const window = allLines.slice(startIndex+1, startIndex+100);
      const rows=[]; let reportedTotal=null; const rowRe=/^(.*?)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)(?:\s*-\s*\$([0-9][0-9,]*(?:\.[0-9]{2})?))?\s+([0-9][0-9,]*(?:\s*(?:ac|acre|acres|ft|feet|mi|units?|ea|feet))?(?:\s*x\s*[0-9][0-9,]*\s*ft)?)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)(?:\s*-\s*\$([0-9][0-9,]*(?:\.[0-9]{2})?))?\s*$/i;
      for(let i=0;i<window.length;i++){
        const raw=window[i]; if(!raw) break; if(/TOTAL/i.test(raw.trim())){ const d=[...raw.matchAll(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/g)].map(m=>parseFloat(m[0].replace(/[$,]/g,''))); if(d.length){ reportedTotal = d.reduce((a,b)=>a+b,0)/d.length; } break; }
        if(/Table\s+\d+|Goal|Objective/i.test(raw)) break;
        const m=raw.match(rowRe); if(m){ const act=m[1].trim(); const unitMin=parseFloat(m[2].replace(/,/g,'')); const unitMax=m[3]? parseFloat(m[3].replace(/,/g,'')) : unitMin; const unitsRaw=m[4].trim(); const totMin=parseFloat(m[5].replace(/,/g,'')); const totMax=m[6]? parseFloat(m[6].replace(/,/g,'')) : totMin; rows.push({ Activity: act, UnitCostRaw: m[2]+(m[3]?(' - '+m[3]):''), Units: unitsRaw, TotalCostRaw: m[5]+(m[6]?(' - '+m[6]):''), unitMin, unitMax, totMin, totMax }); }
      }
      if(!rows.length) return null;
      const normRows = rows.map(r=>{ const qtyMatch=r.Units.match(/([0-9][0-9,]*)/); const quantity=qtyMatch? parseFloat(qtyMatch[1].replace(/,/g,'')):null; const unitTok=r.Units.replace(/^[0-9][0-9,]*/,'').trim().split(/\s+/)[0]||null; const unit = unitTok? canonicalizeUnit(unitTok):null; const totalCost = (r.totMin + r.totMax)/2; return { name:r.Activity, quantity, unit, unitRaw:unitTok||null, unitCost: (r.unitMin + r.unitMax)/2, totalCost, rawSize:r.Units, rawCost:r.TotalCostRaw, unitCostMin:r.unitMin, unitCostMax:r.unitMax, totalCostMin:r.totMin, totalCostMax:r.totMax }; });
      const totalComputed = normRows.reduce((a,b)=> a + (b.totalCost||0), 0) || null;
      return { table:{ columns:['Activity','Unit cost*','Number of units','Total cost'], rows: rows.map(r=>({ Activity:r.Activity, 'Unit cost*': r.UnitCostRaw, 'Number of units': r.Units, 'Total cost': r.TotalCostRaw })), total: reportedTotal }, normalized:{ rows: normRows, totalReported: reportedTotal, totalComputed, discrepancy: (reportedTotal!=null && totalComputed!=null)? (reportedTotal - totalComputed): null, patternId:'activity_unit_cost_range', patternConfidence:0.75 }, dollarLineIndices: rows.map((_,idx)=> startIndex + 1 + idx) };
    }
  },
  {
    id: 'practice_unit_nrcs_costs',
    description: 'Practice | Average Unit NRCS Cost | Units | Total Cost style table (Old Fort Bayou Table 4 style)',
    headerTest: (line)=> /Practice\s+Average\s+Unit\s+NRCS\s+Cost\s+Units\s+Total\s+Cost/i.test(line),
    parse: (allLines, startIndex) => {
      const window = allLines.slice(startIndex, startIndex+50);
      const rows=[]; let reportedTotal=null;
      for(let j=1;j<window.length;j++){
        const line = window[j]; if(!line) continue;
        if(/^TOTAL/i.test(line.trim())){ // total line may have spaces before digits
          const m=line.match(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/); if(m) reportedTotal=moneyToNumber(m[0]); break;
        }
        // row example: Critical Area Planting $248.10  32 acres $7,939.20
        const m=line.match(/^(.*?)\s+\$?([0-9][0-9,]*(?:\.[0-9]{2})?)\s+([0-9][0-9,]*)\s+(acres?|acre|ft|feet|sqft|structures|each|ea|ponds?|ac)\s+\$?([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/i);
        if(m){
          const practice=m[1].trim(); const unitCost='$'+m[2].replace(/^[\$]/,''); const qty=m[3]; const unitRaw=m[4]; const total='$'+m[5].replace(/^[\$]/,'');
          rows.push({ 'Practice': practice, 'Average Unit NRCS Cost': unitCost, 'Units': `${qty} ${unitRaw}`, 'Total Cost': total });
        }
      }
      if(!rows.length) return null;
      let sum=0; const normRows = rows.map(r=>{ const unitCost=moneyToNumber(r['Average Unit NRCS Cost']); const qty=parseFloat(r.Units.replace(/[^0-9.]/g,'')); const total=moneyToNumber(r['Total Cost']); if(total!=null) sum+=total; const unitMatch=r.Units.match(/(acres?|acre|ft|feet|sqft|structures|each|ea|ponds?)/i); const unit = unitMatch? canonicalizeUnit(unitMatch[1]): null; const perUnit = (unitCost && qty)? unitCost: (qty && total)? total/qty: null; return { name:r.Practice, quantity:Number.isNaN(qty)? null: qty, unit, unitRaw:unitMatch?unitMatch[1]:null, unitCost: perUnit, totalCost: total, rawSize:r.Units, rawCost:r['Total Cost'] }; });
      return { table:{ columns:['Practice','Average Unit NRCS Cost','Units','Total Cost'], rows, total: reportedTotal }, normalized:{ rows: normRows, totalReported: reportedTotal, totalComputed: sum, discrepancy: (reportedTotal!=null? reportedTotal - sum: null), patternId:'practice_unit_nrcs_costs', patternConfidence:0.85 } };
    }
  },
  {
    id: 'multi_funding_source_costs',
    description: 'Practice funding allocation table with Producer | NRCS | EPA-MDEQ | Total columns (Coldwater River Table 9)',
    headerTest: (line)=> /Practice\s+Producer\s+NRCS\s+(EPA-?MDEQ|EPA\s*MDEQ)\s+Total/i.test(line)
       || /Projected\s+Costs.*Practice.*Producer.*NRCS.*(EPA-?MDEQ|EPA\s*MDEQ).*Total/i.test(line),
    parse: (allLines, startIndex) => {
      const window = allLines.slice(startIndex, startIndex+40);
      const rows=[]; let reportedTotal=null, producerSum=0, nrcsSum=0, otherSum=0;
        for(let j=1;j<window.length;j++){
          const line=window[j]; if(!line) continue;
          if(/Totals/i.test(line)){
            const dollars=[...line.matchAll(/\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/g)].map(m=>moneyToNumber(m[0]));
              if(dollars.length) reportedTotal = dollars[dollars.length-1];
            break; }
          // compress excessive spaces to make pattern simpler
          const normalized = line.replace(/\s{2,}/g,' ');
          const m=normalized.match(/^(.*?) \$ ?([0-9][0-9,]*(?:\.[0-9]{2})?|-) \$ ?([0-9][0-9,]*(?:\.[0-9]{2})?|-) \$ ?([0-9][0-9,]*(?:\.[0-9]{2})?|-) (?:\$ ?([0-9][0-9,]*(?:\.[0-9]{2})?))?$/);
          if(m){
            const [ , practiceRaw, prodRaw, nrcsRaw, otherRaw, totalRaw ] = m;
            const normVal = v => v==='-'? null: ('$'+v.replace(/^[\$]/,''));
            const producer = normVal(prodRaw); const nrcs = normVal(nrcsRaw); const other = normVal(otherRaw); let total = totalRaw? normVal(totalRaw): null;
            const pNum=moneyToNumber(producer); if(pNum!=null) producerSum+=pNum;
            const nNum=moneyToNumber(nrcs); if(nNum!=null) nrcsSum+=nNum;
            const oNum=moneyToNumber(other); if(oNum!=null) otherSum+=oNum;
            if(!total){ const parts=[pNum,nNum,oNum].filter(v=>v!=null); if(parts.length) total = '$'+parts.reduce((a,b)=>a+b,0).toLocaleString('en-US'); }
            rows.push({ Practice: practiceRaw.trim(), Producer: producer, NRCS: nrcs, 'EPA-MDEQ': other, Total: total });
          }
        }
      if(!rows.length) return null;
      const normRows = rows.map(r=>{ 
        const producerVal = moneyToNumber(r.Producer);
        const nrcsVal = moneyToNumber(r.NRCS);
        const otherVal = moneyToNumber(r['EPA-MDEQ']);
        const total = moneyToNumber(r.Total) || ((producerVal||0)+(nrcsVal||0)+(otherVal||0));
        const denom = total || ((producerVal||0)+(nrcsVal||0)+(otherVal||0)) || 0;
        const pct = (v)=> denom? (v||0)/denom : null;
        return { 
          name: r.Practice,
          totalCost: total,
          producerContribution: producerVal,
          nrcsContribution: nrcsVal,
          otherContribution: otherVal,
          fundingPctProducer: pct(producerVal),
          fundingPctNRCS: pct(nrcsVal),
          fundingPctOther: pct(otherVal),
          rawCost: r.Total 
        }; 
      });
      const computedGrand = normRows.reduce((a,b)=> a + (b.totalCost||0), 0);
      return { table:{ columns:['Practice','Producer','NRCS','EPA-MDEQ','Total'], rows, total: reportedTotal }, normalized:{ rows: normRows, totalReported: reportedTotal, totalComputed: computedGrand, producerComputed: producerSum, nrcsComputed: nrcsSum, otherComputed: otherSum, discrepancy: (reportedTotal!=null? reportedTotal - computedGrand: null), patternId:'multi_funding_source_costs', patternConfidence:0.83 }, dollarLineIndices: rows.map((_,idx)=> startIndex + 1 + idx) };
    }
  },
  {
    id: 'implementation_plan_coded_budget',
    description: 'Implementation plan coded lines (A1., B11, etc.) with dollars and subtotals',
    headerTest: (line)=> /WATERSHED IMPLEMENTATION PLAN – BUDGET ESTIMATES|Watershed Implementation Plan\s*$/i.test(line),
    parse: (allLines, startIndex) => {
      // capture subsequent lines until next section or too long
      const window = allLines.slice(startIndex, startIndex+300);
      const rows=[]; let currentSection=null; const sectionTotals=[]; let grandTotal=0;
      for(let j=1;j<window.length;j++){
        const line = window[j]; if(!line) continue;
        if(/^(I+\.)\s+/i.test(line)) { currentSection=line.trim(); continue; }
        if(/^Subtotal:/i.test(line)){
          const m=line.match(/Subtotal:\s*\$([0-9][0-9,]*(?:\.[0-9]{2})?)/i); if(m){ const val=moneyToNumber('$'+m[1]); sectionTotals.push({ section: currentSection, subtotal: val }); grandTotal += (val||0);} continue; }
        if(/^III\.|^Section\s+3|^VII\./i.test(line)) break; // bail on new unrelated sections
        const m=line.match(/^(?:\*?)([A-Z]{1,2}[0-9]{1,3}[A-Za-z\.]*)\s+(.+?)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)(?:\s+\*\d+)?\s*$/);
        if(m){
          const code=m[1].replace(/\.+$/,'');
          const desc=m[2].trim();
          const amount='$'+m[3];
          rows.push({ Code: code, Description: desc, Amount: amount, Section: currentSection });
        }
      }
      if(!rows.length) return null;
      const normRows = rows.map(r=>({ name: `${r.Code} ${r.Description}`, code:r.Code, section:r.Section, totalCost: moneyToNumber(r.Amount), rawCost: r.Amount }));
      const computed = normRows.reduce((a,b)=> a + (b.totalCost||0), 0);
      return { table:{ columns:['Code','Description','Amount','Section'], rows, total: grandTotal || null }, normalized:{ rows: normRows, totalReported: grandTotal || null, totalComputed: computed, discrepancy: (grandTotal? grandTotal - computed: null), patternId:'implementation_plan_coded_budget', patternConfidence:0.7 }, dollarLineIndices: rows.map((_,idx)=> startIndex + idx + 1) };
    }
  },
  {
    id: 'generic_activity_costs',
    description: 'Generic Activity / Size/Amount / Estimated Cost table without Landowner Match',
    headerTest: (line)=> /Activity\s+Size\/?Amount\s+Estimated\s+Cost/i.test(line) && !/Landowner\s+Match/i.test(line),
    parse: (allLines, startIndex) => {
      const window = allLines.slice(startIndex, startIndex+60);
      const rows = []; let reportedTotal=null; let j=1;
      for(; j<window.length; j++){
        const line = window[j]; if(!line) continue;
        if(/^Total\s+Estimated\s+Project\s+Cost/i.test(line)){ const m=line.match(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/); if(m) reportedTotal=moneyToNumber(m[0]); break; }
        if(/Element\s+[A-I]:|Technical Assistance|Education\/Outreach/i.test(line)) break;
        // Capture lines ending with dollar amount, optional trailing match dollars trimmed
        const m = line.match(/^(.*?)\s+(\$[0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/);
        if(m){
          let left = m[1].trim();
            left = left.replace(/^[-•]+\s*/, '');
            // Attempt to split size vs name using @ or pattern like "10,000ft" or digits followed by unit
            let sizePart='';
            const sizeIdx = left.search(/([0-9][0-9,]*\s*(ft|feet|ac|acre|acres|each|ea|structures|ponds?)|[0-9][0-9,]*\s*@)/i);
            let name = left;
            if(sizeIdx !== -1){ name = left.slice(0,sizeIdx).trim(); sizePart = left.slice(sizeIdx).trim(); }
            if(!name) name = left; if(!name) return; rows.push({ Activity: name, 'Size/Amount': sizePart, 'Estimated Cost': m[2] });
        }
      }
      if(!rows.length) return null;
      let sum=0; const normRows = rows.map(r=>{ const total=moneyToNumber(r['Estimated Cost']); if(total!=null) sum+=total; return { name:r.Activity, rawSize:r['Size/Amount'], rawCost:r['Estimated Cost'], quantity:null, unit:null, unitRaw:null, unitCost:null, totalCost: total }; });
      return { table:{ columns:['Activity','Size/Amount','Estimated Cost'], rows, total: reportedTotal }, normalized:{ rows: normRows, totalReported: reportedTotal, totalComputed: sum, discrepancy: (reportedTotal!=null? reportedTotal - sum: null), patternId:'generic_activity_costs', patternConfidence:0.8 } };
    }
  },
  {
    id: 'total_estimated_project_cost_block',
    description: 'Block listing with Total Estimated Project Cost & Match summary lines',
    headerTest: (line, all, i)=> /Total\s+Estimated\s+Project\s+Cost/i.test(line) && /Match/i.test(line),
    parse: (allLines, startIndex) => {
      // Walk backwards to capture preceding cost lines if they look like items
      const rows=[]; let reportedTotal=null; let reportedMatch=null;
      const totalLine = allLines[startIndex];
      const dollars = [...totalLine.matchAll(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/g)].map(m=>m[0]);
      if(dollars[0]) reportedTotal = moneyToNumber(dollars[0]);
      if(dollars[1]) reportedMatch = moneyToNumber(dollars[1]);
      for(let j=startIndex-1; j>=0 && j>startIndex-35; j--){
        const line = allLines[j]; if(!line) continue; if(/Element\s+[A-I]:/i.test(line)) break;
        if(/\$[0-9]/.test(line) && !/Total\s+Estimated\s+Project\s+Cost/i.test(line)){
          const m = line.match(/^(.*?)\s+(\$[0-9][0-9,]*(?:\.[0-9]{2})?)(?:\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?))?\s*$/);
          if(m){ rows.unshift({ Item: m[1].trim(), Cost: m[2], Match: m[3]? '$'+m[3]: null }); }
        }
      }
      if(!rows.length) return null;
      let sumCost=0,sumMatch=0; const normRows = rows.map(r=>{ const tc=moneyToNumber(r.Cost); const tm=moneyToNumber(r.Match); if(tc!=null) sumCost+=tc; if(tm!=null) sumMatch+=tm; return { name:r.Item, rawCost:r.Cost, totalCost:tc, landownerMatch:tm }; });
      return { table:{ columns:['Item','Cost','Match'], rows, total: reportedTotal, matchTotal: reportedMatch }, normalized:{ rows: normRows, totalReported: reportedTotal, totalComputed: sumCost, landownerMatchReported: reportedMatch, landownerMatchComputed: sumMatch, discrepancy: (reportedTotal!=null? reportedTotal - sumCost: null), matchDiscrepancy: (reportedMatch!=null? reportedMatch - sumMatch: null), patternId:'total_estimated_project_cost_block', patternConfidence:0.75 } };
    }
  },
  {
    id: 'booths_creek_bmps',
    description: 'Booths Creek style: Code Practice Units Cost Estimated Units Total',
    headerTest: (line)=> /Code\s+Practice\s+Units\s+Cost.*Estimated.*Units.*Total/i.test(line),
    parse: (allLines, startIndex) => {
      const window = allLines.slice(startIndex, startIndex+60);
      const rows = []; let reportedTotal=null; let j=1; // skip header row already at index 0 of window
      for(; j<window.length; j++){
        const line = window[j]; if(!line) continue;
        if(/^Total\s*\$[0-9]/i.test(line)){ const m=line.match(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/); if(m) reportedTotal=moneyToNumber(m[0]); break; }
        if(/In addition to these costs|Element\s+[A-I]:/i.test(line)) break;
        const m = line.match(/^([0-9]+)\s+(.*?)\s+(ac|ft|ea|each|cuyd|sqft|gal|no)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/);
        if(m){ rows.push({ 'Code': m[1], 'Practice': m[2].trim(), 'Units': m[3], 'Cost': '$'+m[4], 'Estimated Units': m[5], 'Total': '$'+m[6] }); }
      }
      if(!rows.length) return null;
      let computed=0; const normRows = rows.map(r => { const unitCost=moneyToNumber(r.Cost); const quantity=parseFloat(r['Estimated Units'].replace(/,/g,'')); const total=moneyToNumber(r.Total); if(total!=null) computed+=total; const unit=canonicalizeUnit(r.Units); return { name: `${r.Code} - ${r.Practice}`, quantity: Number.isNaN(quantity)? null: quantity, unit, unitRaw: r.Units, unitCost, totalCost: total, rawSize: `${r['Estimated Units']} ${r.Units}`, rawCost: r.Total }; });
      return {
        table: { columns:['Code','Practice','Units','Cost','Estimated Units','Total'], rows, total: reportedTotal },
        normalized: { rows: normRows, totalReported: reportedTotal, totalComputed: computed || null, discrepancy: (reportedTotal!=null && computed!=null)? reportedTotal-computed : null, patternId:'booths_creek_bmps', patternConfidence: 0.95 }
      };
    }
  },
  {
    id: 'phase1_bmps',
    description: 'Upper Piney Creek Phase 1 style: BMPs Amount Estimated Cost',
    headerTest: (line)=> /BMPs\s*Amount\s*Estimated Cost/i.test(line),
    parse: (allLines, startIndex) => {
      const window = allLines.slice(startIndex, startIndex+40);
      const rows=[]; let reportedTotal=null; for(let j=1;j<window.length;j++){ const line=window[j]; if(!line) continue; if(/^Total.*\$[0-9]/i.test(line)){ const m=line.match(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/); if(m) reportedTotal=moneyToNumber(m[0]); break; } if(/Technical Assistance|Education and Outreach|Monitoring|Project Management/i.test(line)) break; const m=line.match(/^(.*?)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+(each|ac|cy|ft|acres)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/); if(m){ rows.push({ 'BMPs': m[1].trim(), 'Amount': m[2]+' '+m[3], 'Estimated Cost': '$'+m[4] }); } }
      if(!rows.length) return null; let computed=0; const normRows = rows.map(r=>{ const amountText=r.Amount; const quantity=parseFloat(amountText.replace(/[^0-9.]/g,'')); const total=moneyToNumber(r['Estimated Cost']); if(total!=null) computed+=total; const unit = /each/.test(amountText)?'each': /ac/.test(amountText)?'ac': /cy/.test(amountText)?'cy': /ft/.test(amountText)?'ft': null; const unitCost = (quantity && total)? total/quantity: null; return { name: r['BMPs'], quantity: Number.isNaN(quantity)? null: quantity, unit, unitRaw: unit, unitCost, totalCost: total, rawSize: amountText, rawCost: r['Estimated Cost'] }; });
      return { table: { columns:['BMPs','Amount','Estimated Cost'], rows, total: reportedTotal }, normalized: { rows: normRows, totalReported: reportedTotal, totalComputed: computed||null, discrepancy: (reportedTotal!=null && computed!=null)? reportedTotal-computed:null, patternId:'phase1_bmps', patternConfidence: 0.9 } };
    }
  },
  {
    id: 'activity_match',
    description: 'Activity / Size / Estimated Cost / Landowner Match dispersed lines',
    headerTest: (line)=> /Activity.*Size.*Estimated Cost.*Landowner Match/i.test(line),
    parse: (allLines, startIndex) => {
      // Reuse logic concept adapted from legacy parseWindow branch
      const rows = []; let reportedTotal=null, reportedMatchTotal=null;
      const candidateLines = allLines.filter(l => l && /\$[0-9]/.test(l));
      candidateLines.forEach(rawLine => {
        if(/Total Estimated Project Cost/i.test(rawLine)){
          const dollars = [...rawLine.matchAll(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/g)].map(m=>m[0]);
          if(dollars[0]) reportedTotal = moneyToNumber(dollars[0]);
          if(dollars[1]) reportedMatchTotal = moneyToNumber(dollars[1]);
          return;
        }
        const m = rawLine.match(/(.*?)(\$[0-9][0-9,]*(?:\.[0-9]{2})?)(?:\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?))?\s*$/);
        if(!m) return; let left = m[1].trim(); const est=m[2]; const matchVal = m[3] ? '$'+m[3] : null;
        left = left.replace(/^[-•]+\s*/, '');
        const sizeIdx = left.search(/(\b[0-9][0-9,]*\b.*@|\b[0-9][0-9,]*\b|N\/A)/);
        let name = left; let sizePart='';
        if(sizeIdx !== -1){ name = left.slice(0,sizeIdx).trim(); sizePart = left.slice(sizeIdx).trim(); }
        name = name.replace(/^BMPs\s*/i,'').replace(/:+$/,'').trim();
        if(!name) return;
        rows.push({ Activity: name, 'Size/Amount': sizePart, 'Estimated Cost': est, 'Landowner Match': matchVal });
      });
      if(!rows.length) return null;
      let sumEst=0,sumMatch=0; const normRows = rows.map(r => { const est=moneyToNumber(r['Estimated Cost']); const match=moneyToNumber(r['Landowner Match']); if(est!=null) sumEst+=est; if(match!=null) sumMatch+=match; // quantity/unit heuristics skipped (varied)
        return { name: r.Activity, rawSize: r['Size/Amount'], rawCost: r['Estimated Cost'], quantity:null, unit:null, unitRaw:null, unitCost:null, totalCost: est, landownerMatch: match }; });
      return { table: { columns:['Activity','Size/Amount','Estimated Cost','Landowner Match'], rows, total: reportedTotal, landownerMatchTotal: reportedMatchTotal }, normalized: { rows: normRows, totalReported: reportedTotal, totalComputed: sumEst, landownerMatchReported: reportedMatchTotal, landownerMatchComputed: sumMatch, discrepancy: (reportedTotal!=null? reportedTotal - sumEst: null), matchDiscrepancy: (reportedMatchTotal!=null? reportedMatchTotal - sumMatch: null), patternId:'activity_match', patternConfidence:0.85 } };
    }
  },
  {
    id: 'practice_costs',
    description: 'Practice | Unit Cost | Number of Units | Total Cost table',
    headerTest: (line, all, i) => /^Practice\s*$/i.test(line) && /Unit Cost/i.test(all.slice(i, i+6).join(' ')) && /Total Cost/i.test(all.slice(i, i+6).join(' ')),
    parse: (allLines, startIndex) => {
      const window = allLines.slice(startIndex, startIndex+80);
      let j=0; while(j < window.length && !/\$[0-9]/.test(window[j])) j++;
      const collected=[]; let reportedTotal=null;
      for(; j<window.length; j++){
        const line = window[j]; if(!line) continue;
        if(/^Total\s*$/i.test(line.trim())){ for(let k=j+1;k<window.length;k++){ const dl=window[k]; const m=dl?.match(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/); if(m){ reportedTotal=moneyToNumber(m[0]); break; } } break; }
        if(/Low DO\/Organic|Participants/i.test(line)) break;
        collected.push(line);
      }
      const merged=[]; for(let i2=0;i2<collected.length;i2++){ let line=collected[i2]; if(!/\$[0-9]/.test(line) && collected[i2+1] && /\$[0-9]/.test(collected[i2+1])){ line += ' ' + collected[i2+1].trim(); i2++; } merged.push(line); }
      const rowRe = /^(.*?)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s+([0-9][0-9,]*)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/;
      const rows=[]; merged.forEach(raw => { const m=raw.match(rowRe); if(!m) return; rows.push({ 'Practice': m[1].trim(), 'Unit Cost w/Installation': '$'+m[2], 'Number of Units': m[3], 'Total Cost': '$'+m[4] }); });
      if(!rows.length) return null; let computed=0; const normRows = rows.map(r => { const unitCost=moneyToNumber(r['Unit Cost w/Installation']); const qty=parseFloat(r['Number of Units'].replace(/,/g,'')); const total=moneyToNumber(r['Total Cost']); if(total!=null) computed+=total; return { name: r['Practice'], quantity: Number.isNaN(qty)? null: qty, unit:null, unitRaw:null, unitCost, totalCost: total, rawSize: (r['Number of Units']||'')+' units', rawCost: r['Total Cost'] }; });
      return { table:{ columns:['Practice','Unit Cost w/Installation','Number of Units','Total Cost'], rows, total: reportedTotal }, normalized:{ rows: normRows, totalReported: reportedTotal, totalComputed: computed, discrepancy: (reportedTotal!=null? reportedTotal - computed: null), patternId:'practice_costs', patternConfidence:0.88 } };
    }
  },
  {
    id: 'bell_creek_bmps',
    description: 'Bell Creek Practice Area Affected BMP Cost BMP Total',
    headerTest: (line)=> /Practice\s+Area Affected\s+BMP Cost\s+BMP Total/i.test(line),
    parse: (allLines, startIndex) => {
      const window = allLines.slice(startIndex, startIndex+50);
      let j=1; const rows=[]; let reportedTotal=null;
      for(; j<window.length; j++){
        const line = window[j]; if(!line?.trim()) continue;
        if(/^Total\s*$/i.test(line.trim())){ for(let k=j+1;k<window.length;k++){ const dl=window[k]; const m=dl?.match(/\$([0-9][0-9,]*(?:\.[0-9]{2})?)/); if(m){ reportedTotal=moneyToNumber(m[0]); break; } } break; }
        if(/Technical Assistance|Table\s*8\.2/i.test(line)) break;
        const m = line.match(/^(.*?)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+(feet|acres|structures|each)\s+\$([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\/\s*\w+)?\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/);
        if(m){ rows.push({ 'Practice': m[1].trim(), 'Area Affected': m[2] + ' ' + m[3], 'BMP Cost': '$'+m[4]+'/'+(m[3]==='feet'?'ft': m[3]==='acres'?'ac': m[3]==='structures'?'ea': m[3]==='each'?'ea': m[3]), 'BMP Total': '$'+m[5] }); }
      }
      if(!rows.length) return null; let computed=0; const normRows = rows.map(r=>{ const area=r['Area Affected']; const quantity=parseFloat(area.replace(/[^0-9.]/g,'')); const costMatch=r['BMP Cost'].match(/\$([0-9][0-9,]*(?:\.[0-9]+)?)/); const unitCost=costMatch? moneyToNumber(costMatch[0]):null; const total=moneyToNumber(r['BMP Total']); if(total!=null) computed+=total; const unit = area.includes('feet')?'ft': area.includes('acres')?'ac': area.includes('structures')?'structures': area.includes('each')?'each': null; return { name: r['Practice'], quantity: Number.isNaN(quantity)? null: quantity, unit, unitRaw: unit, unitCost, totalCost: total, rawSize: area, rawCost: r['BMP Total'] }; });
      return { table:{ columns:['Practice','Area Affected','BMP Cost','BMP Total'], rows, total: reportedTotal }, normalized:{ rows: normRows, totalReported: reportedTotal, totalComputed: computed, discrepancy: (reportedTotal!=null? reportedTotal - computed: null), patternId:'bell_creek_bmps', patternConfidence:0.9 } };
    }
  },
    {
    id: 'tech_assistance',
    description: 'Technical Assistance simple Item Cost list',
    headerTest: (line)=> /Item\s+Cost/i.test(line) && /Technical Assistance/i.test(line) === false,
    parse: (allLines, startIndex) => {
      const window = allLines.slice(startIndex, startIndex+25);
      let j=1; const rows=[]; let reportedTotal=null;
      for(; j<window.length; j++){
        const line=window[j]; if(!line?.trim()) continue;
        if(/^Total\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)/i.test(line)){ const m=line.match(/\$([0-9][0-9,]*(?:\.[0-9]{2})?)/); if(m) reportedTotal=moneyToNumber(m[0]); break; }
        const m=line.match(/^(.*?)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/); if(m){ rows.push({ 'Item': m[1].trim(), 'Cost': '$'+m[2] }); }
      }
      if(!rows.length) return null; let computed=0; const normRows = rows.map(r=>{ const total=moneyToNumber(r.Cost); if(total!=null) computed+=total; return { name: r.Item, quantity:null, unit:null, unitRaw:null, unitCost:null, totalCost: total, rawSize:'N/A', rawCost: r.Cost }; });
      return { table:{ columns:['Item','Cost'], rows, total: reportedTotal }, normalized:{ rows: normRows, totalReported: reportedTotal, totalComputed: computed, discrepancy: (reportedTotal!=null? reportedTotal - computed: null), patternId:'tech_assistance', patternConfidence:0.85 } };
    }
  }
];

// Adaptive fallback pattern appended dynamically to ensure it runs last
patterns.push({
  id: 'adaptive_generic_costs',
  description: 'Adaptive fallback: captures contiguous block of lines containing item descriptions followed by dollar amounts when no specific pattern fires',
  headerTest: (line, all, idx) => {
    // Trigger if line has at least one $ amount and some letters, but not an obvious header already matched
    if(!/\$[0-9]/.test(line)) return false;
    if(/Practice\s+Average\s+Unit/i.test(line)) return false;
    if(/Producer\s+NRCS/i.test(line)) return false;
    if(/Code\s+Practice\s+Units/i.test(line)) return false;
    if(/Activity\s+Size/i.test(line)) return false;
    // Look ahead a few lines: if we can find 2+ lines with dollar amounts and similar structure, treat as block start
    const slice = all.slice(idx, idx+12);
    const moneyLines = slice.filter(l=>/\$[0-9]/.test(l));
    return moneyLines.length >= 3; // minimal density
  },
  parse: (allLines, startIndex) => {
    const window = allLines.slice(startIndex, startIndex+80);
    const rows=[]; let end=0; const dollarLineIndices=[];
    for(let j=0;j<window.length;j++){
      const line = window[j];
      if(!line){ end=j; break; }
      // Stop if we've left the cost-like block (blank line or a section header style)
      if(/^\s*$/.test(line) || /(Goal|Objective|Section|Table\s+\d+|Implementation Plan)/i.test(line)) { end=j; break; }
      // Capture lines with trailing dollar amount(s)
      if(/\$[0-9]/.test(line)){
        dollarLineIndices.push(startIndex + j);
        // Try: <name> .... $X or <name> .... $X $Y
        const m=line.match(/^(.*?)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)(?:\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?))?\s*$/);
        if(m){
          rows.push({ Item: m[1].trim(), Cost: '$'+m[2], Extra: m[3]? '$'+m[3]: null });
        } else {
          // fallback: find first dollar and treat preceding as name
          const firstDollarIdx = line.search(/\$[0-9]/);
            if(firstDollarIdx>5){
              const name=line.slice(0, firstDollarIdx).trim();
              const moneyPart=line.slice(firstDollarIdx).trim();
              const m2=moneyPart.match(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/g);
              if(name && m2){ rows.push({ Item: name, Cost: m2[0], Extra: m2[1]||null }); }
            }
        }
      } else {
        // If we have already collected some rows and encounter a non-monetary line, end block.
        if(rows.length>4){ end=j; break; }
      }
    }
    if(rows.length < 3) return null; // avoid noise
    // Compute totals
    let sum=0; const normRows = rows.map(r=>{ const val=moneyToNumber(r.Cost); if(val!=null) sum+=val; return { name:r.Item, totalCost: val, rawCost:r.Cost }; });
    return { table:{ columns:['Item','Cost','Extra?'], rows, total: null }, normalized:{ rows: normRows, totalReported: null, totalComputed: sum, discrepancy: null, patternId:'adaptive_generic_costs', patternConfidence:0.5 }, dollarLineIndices };
  }
});

export function parseCostTablesWithPatterns(allLines, rawLines){
  const results = [];
  if(!Array.isArray(allLines) || !allLines.length){
    if(Array.isArray(rawLines) && rawLines.length) allLines = rawLines; else return results;
  }
  // Merge rawLines for completeness (avoid duplicates) so funding tables outside sections are still scanned
  if(Array.isArray(rawLines) && rawLines.length){
    const seen = new Set(allLines.map(l=>l));
    rawLines.forEach(l=>{ if(l && !seen.has(l)) allLines.push(l); });
  }
  // Pre-scan for Coldwater style funding table if header not already in lines processed by patterns
  const headerIdxGlobal = allLines.findIndex(l=> /Practice\s+Producer\s+NRCS\s+(EPA-?MDEQ|EPA\s*MDEQ)\s+Total/i.test(l));
  // Normal pattern loop
  for(let i=0;i<allLines.length;i++){
    const line = allLines[i];
    for(const p of patterns){
      try {
        if(p.headerTest(line, allLines, i)){
          const parsed = p.parse(allLines, i);
          if(parsed){
            // Attempt to infer span end by scanning forward until blank line or section boundary tokens
            let endIdx = i+1;
            for(; endIdx < allLines.length && endIdx < i+120; endIdx++){
              const l = allLines[endIdx];
              if(!l || /^(Goal|Objective|Section|Table\s+\d+)/i.test(l)) break;
            }
            // Collect dollar line indices for dedupe
            const dollarLineIndices = [];
            for(let d=i; d<endIdx; d++){ if(/\$[0-9]/.test(allLines[d]||'')) dollarLineIndices.push(d); }
            results.push({ id: p.id, title: line.trim(), spanStart: i, spanEnd: endIdx, dollarLineIndices, ...parsed });
          }
        }
      } catch(e){ /* pattern parse failure tolerant */ }
    }
  }
  // If we never produced a multi_funding_source_costs but header exists globally, attempt manual parse fallback
  if(headerIdxGlobal !== -1 && !results.some(r=>r.id==='multi_funding_source_costs')){
    const window = allLines.slice(headerIdxGlobal, headerIdxGlobal+30);
    const rows=[]; let reportedTotal=null; let producerSum=0, nrcsSum=0, otherSum=0;
    for(let j=1;j<window.length;j++){
      const line = window[j]; if(!line) continue; if(/Totals/i.test(line)){ const dollars=[...line.matchAll(/\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?)/g)].map(m=>moneyToNumber(m[0])); if(dollars.length) reportedTotal = dollars[dollars.length-1]; break; }
      // Use tokenization: collapse multiple spaces to single for splitting markers, but preserve practice name which may have spaces before first $
      const firstDollar = line.indexOf('$'); if(firstDollar === -1) continue; const before = line.slice(0, firstDollar).trim(); const moneyParts = [...line.matchAll(/\$\s*([0-9][0-9,]*(?:\.[0-9]{2})?|-)/g)].map(m=>m[1]); if(moneyParts.length < 3) continue; while(moneyParts.length < 4) moneyParts.push('-'); const [prod,nrcs,other,totalMaybe] = moneyParts; const fmt=(v)=> v==='-'? null: ('$'+v.replace(/^[\$]/,'')); const producer=fmt(prod); const nrcsV=fmt(nrcs); const otherV=fmt(other); let total=fmt(totalMaybe); const pNum=moneyToNumber(producer); if(pNum!=null) producerSum+=pNum; const nNum=moneyToNumber(nrcsV); if(nNum!=null) nrcsSum+=nNum; const oNum=moneyToNumber(otherV); if(oNum!=null) otherSum+=oNum; if(!total){ const sumParts=[pNum,nNum,oNum].filter(v=>v!=null); if(sumParts.length) total='$'+sumParts.reduce((a,b)=>a+b,0).toLocaleString('en-US'); } rows.push({ Practice: before, Producer: producer, NRCS: nrcsV, 'EPA-MDEQ': otherV, Total: total });
    }
    if(rows.length){
      const normRows = rows.map(r=>{ const p=moneyToNumber(r.Producer); const n=moneyToNumber(r.NRCS); const o=moneyToNumber(r['EPA-MDEQ']); const tot=moneyToNumber(r.Total) || ((p||0)+(n||0)+(o||0)); return { name:r.Practice, totalCost: tot, producerContribution:p, nrcsContribution:n, otherContribution:o, rawCost:r.Total }; });
      const computedGrand = normRows.reduce((a,b)=> a + (b.totalCost||0),0);
      const dollarLineIndices = []; for(let off=0; off<rows.length+1; off++){ if(/\$[0-9]/.test(allLines[headerIdxGlobal+off]||'')) dollarLineIndices.push(headerIdxGlobal+off); }
      results.push({ id:'multi_funding_source_costs', title: allLines[headerIdxGlobal].trim(), spanStart: headerIdxGlobal, spanEnd: headerIdxGlobal + rows.length + 2, dollarLineIndices, table:{ columns:['Practice','Producer','NRCS','EPA-MDEQ','Total'], rows, total: reportedTotal }, normalized:{ rows: normRows, totalReported: reportedTotal, totalComputed: computedGrand, patternId:'multi_funding_source_costs', patternConfidence:0.8 } });
    }
  }
  // Dedupe: remove adaptive_generic_costs blocks fully subsumed by explicit pattern spans (approximate via line index ranges)
  const adaptive = results.filter(r=>r.id==='adaptive_generic_costs');
  if(adaptive.length){
    const explicitSpans = results.filter(r=>r.id!=='adaptive_generic_costs').map(r=>({start:r.spanStart, end:r.spanEnd, dollars:new Set(r.dollarLineIndices||[])}));
    for(let i=results.length-1;i>=0;i--){
      const r = results[i];
      if(r.id !== 'adaptive_generic_costs') continue;
      const covered = explicitSpans.some(s=> s.start <= r.spanStart && s.end >= r.spanEnd);
      if(!covered && r.dollarLineIndices && r.dollarLineIndices.length){
        // If every dollar line in adaptive block appears in some explicit table's dollar lines, drop it
        const fullyAccounted = explicitSpans.some(s=> r.dollarLineIndices.every(dl=> s.dollars.has(dl)));
        if(fullyAccounted){ results.splice(i,1); continue; }
      }
      if(covered) results.splice(i,1);
    }
  }
  return results;
}

export const registeredCostPatterns = patterns.map(p=>({ id:p.id, description:p.description }));
