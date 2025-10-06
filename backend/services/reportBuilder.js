// Transforms sectioned text into ExtractedReport structure with richer heuristics (v3 enhanced).
// This file now delegates advanced extraction to enhancedExtractors.js while preserving
// backward field names for compatibility.

import { extractGoals, extractBMPs, extractActivities, inferStatus, POLLUTANT_TERMS } from './enhancedExtractors.js';
import { filterBMPs } from './bmpFilters.js';
import { parseCostTablesWithPatterns } from './patterns/costTablePatterns.js';
import fs from 'fs';
import path from 'path';

// Basic utility fallbacks retained for legacy parsing of some sections.
function inferAudience(line) {
  if (/public|community/i.test(line)) return 'Community';
  if (/school|student/i.test(line)) return 'Education';
  return 'General';
}

function parseMonitoring(lines = []) {
  return lines.map((line, idx) => ({ id:`M${idx+1}`, metric: line.trim(), value: null, unit: null, source: line }));
}

// Wrapper to optionally post-filter BMPs if environment flag BMP_FILTER=1 is set later in buildStructuredReport.
function maybeFilterBMPs(bmps){
  try {
    if(process.env.BMP_FILTER === '1'){
      const { filtered, rejected } = filterBMPs(bmps);
      // Attach diagnostics for downstream dashboards
      return { bmps: filtered.map((b,i)=> ({ ...b, id:`B${i+1}` })), bmpRejected: rejected };
    }
  } catch(e){ /* swallow filter errors to avoid breaking extraction */ }
  return { bmps, bmpRejected: [] };
}
function parseOutreach(lines = []) {
  return lines.map((line, idx) => ({ id:`O${idx+1}`, activity: line.trim(), audience: inferAudience(line), source: line }));
}
function parseGeography(lines = []) {
  return lines.map((line, idx) => ({ id:`GA${idx+1}`, area: line.trim(), source: line }));
}
export function parseCostTable(sections){
  let bmpCostTable = null;
  let bmpCostTableNormalized = null;
  const bmpCostTables = [];
  const bmpCostTablesNormalized = [];
  try {
    let allLines = Object.values(sections).filter(Array.isArray).flat();
    // If multi-funding header not present in sectionized lines but exists in raw unsectioned text (Coldwater case), attempt raw augmentation
    if(!allLines.some(l=> /Practice\s+Producer\s+NRCS\s+(EPA-?MDEQ|EPA\s*MDEQ)\s+Total/i.test(l))){
      // Try to load rawText from synthetic merged bronze file if present alongside sectionization (heuristic: environment may pass RAW_TEXT env var later)
      try {
        if(globalThis.__RAW_WHOLE_TEXT__){
          const rawLines = globalThis.__RAW_WHOLE_TEXT__.split(/\r?\n/);
          const headerIdx = rawLines.findIndex(l=> /Practice\s+Producer\s+NRCS\s+(EPA-?MDEQ|EPA\s*MDEQ)\s+Total/i.test(l));
          if(headerIdx !== -1){
            // append a slice around header for pattern parsing
            const slice = rawLines.slice(Math.max(0,headerIdx-1), headerIdx+25);
            allLines = allLines.concat(slice);
          }
        }
      } catch(e){ /* silent */ }
    }
    if(!allLines.length) return { bmpCostTable, bmpCostTableNormalized, bmpCostTables, bmpCostTablesNormalized };
    const tableStarts = [];
    // Pattern-based detection pass (adds to legacy detection to preserve coverage)
    // Provide rawLines fallback: attempt to locate in sections.Geography raw sentinel else skip
    let rawLinesArg = null;
    if(globalThis.__RAW_WHOLE_TEXT__){
      rawLinesArg = globalThis.__RAW_WHOLE_TEXT__.split(/\r?\n/);
    }
    const patternParsed = parseCostTablesWithPatterns(allLines, rawLinesArg);
    if(patternParsed.length){
      patternParsed.forEach(p => {
        bmpCostTables.push({ id: p.id, title: p.title, table: p.table, patternId: p.normalized?.patternId, patternConfidence: p.normalized?.patternConfidence });
        bmpCostTablesNormalized.push({ id: p.id, title: p.title, ...p.normalized });
      });
      // Merge multiple implementation_plan_coded_budget tables into one consolidated logical table
      const implTables = bmpCostTablesNormalized.filter(t=>t.patternId==='implementation_plan_coded_budget');
      if(implTables.length > 1){
        const mergedKey = 'implementation_plan_coded_budget_merged';
        const seenCodes = new Map();
        const mergedRows = [];
        let totalReportedAggregate = 0;
        let totalComputedAggregate = 0;
        implTables.forEach(t => {
          (t.rows||[]).forEach(r => {
            const codeKey = (r.code||r.Code||'')+ '|' + (r.section||r.Section||'');
            const existing = seenCodes.get(codeKey);
            if(existing){
              // If duplicate code/section, sum amounts
              const add = (val)=> (typeof val === 'number' && !Number.isNaN(val)) ? val : 0;
              existing.totalCost = add(existing.totalCost) + add(r.totalCost);
            } else {
              // normalize shape
              mergedRows.push({ ...r });
              seenCodes.set(codeKey, mergedRows[mergedRows.length-1]);
            }
          });
          if(typeof t.totalReported === 'number') totalReportedAggregate += t.totalReported;
          if(typeof t.totalComputed === 'number') totalComputedAggregate += t.totalComputed;
        });
        const mergedNormalized = {
          id: mergedKey,
          title: 'Implementation Plan Budget (Merged)',
          patternId: 'implementation_plan_coded_budget',
            patternConfidence: 0.72,
          rows: mergedRows,
          totalReported: totalReportedAggregate || null,
          totalComputed: totalComputedAggregate || null,
          discrepancy: (totalReportedAggregate && totalComputedAggregate) ? (totalReportedAggregate - totalComputedAggregate) : null
        };
        // Remove originals from both arrays and insert merged canonical table
        for(let i=bmpCostTables.length-1;i>=0;i--){ if(bmpCostTables[i].patternId==='implementation_plan_coded_budget') bmpCostTables.splice(i,1); }
        for(let i=bmpCostTablesNormalized.length-1;i>=0;i--){ if(bmpCostTablesNormalized[i].patternId==='implementation_plan_coded_budget') bmpCostTablesNormalized.splice(i,1); }
        bmpCostTables.push({ id: mergedKey, title: mergedNormalized.title, table: { columns:['Code','Description','Amount','Section'], rows: mergedRows, total: mergedNormalized.totalReported }, patternId: 'implementation_plan_coded_budget', patternConfidence: 0.72 });
        bmpCostTablesNormalized.push(mergedNormalized);
      }
    }
    allLines.forEach((l,i) => {
      if(/^\s*Cost Estimate:\s*Full Project Implementation/i.test(l)) tableStarts.push({ index:i, kind:'full_project', title:l.trim() });
      else if(/^\s*Cost Estimate:\s*Phase 1 Implementation/i.test(l)) tableStarts.push({ index:i, kind:'phase1', title:l.trim() });
      else if(/Activity.*Size.*Amount.*Estimated Cost.*Landowner Match/i.test(l)) {
        tableStarts.push({ index:i, kind:'activity_match', title:l.trim() });
      }
      else if(/^Practice\s*$/i.test(l)){ // Steele Bayou style multi-line header
        // Look ahead a few lines for Unit Cost and Total Cost tokens
        const lookahead = allLines.slice(i, i+6).join(' ');
        if(/Unit Cost/i.test(lookahead) && /Total Cost/i.test(lookahead)){
          tableStarts.push({ index:i, kind:'practice_costs', title:'Projected Costs for Agricultural BMPs'});
        }
      }
      else if(/Table.*Agricultural.*Best Management Practice/i.test(l)){ // Steele Bayou table header
        // Look ahead for Practice, Unit Cost, Total Cost pattern
        const lookahead = allLines.slice(i, i+10).join(' ');
        if(/Practice.*Unit Cost.*Total Cost/i.test(lookahead)){
          tableStarts.push({ index:i, kind:'practice_costs', title:l.trim()});
        }
      }
      else if(/Table.*Funded.*319.*Project.*Budget.*BMPs/i.test(l)){ // Bell Creek format
        tableStarts.push({ index:i, kind:'bell_creek_bmps', title:l.trim()});
      }
      else if(/Table.*Technical Assistance/i.test(l)){ // Bell Creek technical assistance
        tableStarts.push({ index:i, kind:'tech_assistance', title:l.trim()});
      }
      else if(/Practice\s+Area Affected\s+BMP Cost\s+BMP Total/i.test(l)){ // Bell Creek header line
        tableStarts.push({ index:i, kind:'bell_creek_bmps', title:'Bell Creek BMP Budget'});
      }
      else if(/BMPs\s*Amount\s*Estimated Cost/i.test(l)){ // Upper Piney Creek Phase 1
        tableStarts.push({ index:i, kind:'phase1_bmps', title:'Phase 1 Implementation BMPs'});
      }
      else if(/Code\s+Practice\s+Units\s+Cost.*Estimated.*Units.*Total/i.test(l)){ // Booths Creek format
        tableStarts.push({ index:i, kind:'booths_creek_bmps', title:'BMP Cost Estimates'});
      }
      else if(/Provided below is an estimate of project BMP costs/i.test(l)){ // Booths Creek introduction
        // Look ahead for the actual table header
        for(let j = i+1; j < Math.min(i+10, allLines.length); j++){
          if(/Code\s+Practice\s+Units\s+Cost/i.test(allLines[j])){
            tableStarts.push({ index:j, kind:'booths_creek_bmps', title:'BMP Cost Estimates'});
            break;
          }
        }
      }
    });
    if(!tableStarts.length && !bmpCostTables.length){
      // legacy single-table fallback (look for any cost estimate)
      const idx = allLines.findIndex(l=>/cost estimate/i.test(l));
      if(idx===-1) return { bmpCostTable, bmpCostTableNormalized, bmpCostTables, bmpCostTablesNormalized };
      tableStarts.push({ index: idx, kind:'generic', title: allLines[idx].trim() });
    }
    function parseWindow(startIdx, kind){
      if(kind === 'activity_match') {
        // Dry Creek style: header is separate from data, search all lines for BMP rows
        const rows = [];
        let reportedTotal = null, reportedMatchTotal = null;
        
        // Look for BMP data patterns in all lines (not just after header)
        // Format: "BMPname quantity unit @ $cost/unit $totalCost $matchCost"
        const merged = allLines.filter(line => {
          if(!line || !line.trim()) return false;
          // Must contain dollar signs and typical BMP patterns
          return /\$[0-9]/.test(line) && (
            /\b(Fencing|Water Facilities|Heavy Use Areas|Stream Crossings|Ponds|Sediment Basins|Nutrient Management|Critical Area Planting|Establishment|Forage|Biomass|Education|Monitoring|Project Management)\b/i.test(line)
          );
        });
        const headerCells = ['Activity','Size/Amount','Estimated Cost','Landowner Match'];
        merged.forEach((rawLine, lineIndex) => {
          if(!rawLine) return;
          if(/Total Estimated Project Cost/i.test(rawLine)){
            const dollars = [...rawLine.matchAll(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/g)].map(m=>m[0]);
            if(dollars[0]) reportedTotal = parseFloat(dollars[0].replace(/[$,]/g,''));
            if(dollars[1]) reportedMatchTotal = parseFloat(dollars[1].replace(/[$,]/g,''));
            return;
          }
          const line = rawLine.trim();
          if(/^BMPs$/i.test(line)) return;
          if(!/\$[0-9]/.test(line)) return; // must contain at least one dollar
          // Regex: left part + 1 or 2 cost columns
          const costRegex = /(.*?)(\$[0-9][0-9,]*(?:\.[0-9]{2})?)(?:\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?))?\s*$/;
          const m = line.match(costRegex);
          if(!m) return;
          let left = m[1].trim();
          const estCost = m[2];
          const matchCost = m[3] ? '$'+m[3].replace(/^\$/,'') : null;
          // Split left into (optional bullet indentation / activity name) and size/amount
          left = left.replace(/^[-•]+\s*/,'');
          // Size part begins at first quantity or N/A or digit followed by unit or @
          const sizeIdx = left.search(/(\b[0-9][0-9,]*\b.*@|\b[0-9][0-9,]*\b|N\/A)/);
          let name = left;
          let sizePart = '';
          if(sizeIdx !== -1){
            name = left.slice(0,sizeIdx).trim();
            sizePart = left.slice(sizeIdx).trim();
          }
          name = name.replace(/^BMPs\s*/i,'').replace(/:+$/,'').trim();
          if(!name) return;
          rows.push({ Activity: name, 'Size/Amount': sizePart, 'Estimated Cost': estCost, 'Landowner Match': matchCost });
        });
        if(!rows.length) return null;
        // Normalize
        const normRows = [];
        let sumEst = 0, sumMatch = 0;
        const moneyRegex = /\$[0-9,.]+/;
        function canonicalizeUnit(u){ if(!u) return null; const raw=u.toLowerCase().replace(/\.$/,''); const map={ 'each':'each','ea':'each','ac':'acre','acre':'acre','acres':'acre','ft':'ft','feet':'ft','foot':'ft','lf':'linear_ft','linft':'linear_ft','linear':'linear_ft','linearft':'linear_ft','sqft':'sq_ft','sq.ft':'sq_ft','sq':'sq_ft','sq_ft':'sq_ft','sq.ft.':'sq_ft','yd':'yd','yds':'yd','cuyd':'cu_yd','cy':'cu_yd','cu.yd':'cu_yd','gal':'gal','gals':'gal','gallon':'gal','gallons':'gal'}; return map[raw]||raw.replace(/[^a-z0-9_]/g,''); }
        rows.forEach(r => {
          const name = r.Activity;
          const sizeText = r['Size/Amount']||'';
          const est = r['Estimated Cost'];
          const matchVal = r['Landowner Match'];
          let quantity=null, unit=null, unitCost=null, totalCost=null, landownerMatch=null;
          if(est){ const num = parseFloat(est.replace(/[$,]/g,'')); if(!Number.isNaN(num)){ totalCost = num; sumEst += num; } }
          if(matchVal){ const num = parseFloat(matchVal.replace(/[$,]/g,'')); if(!Number.isNaN(num)){ landownerMatch = num; sumMatch += num; } }
          const atPart = sizeText.split('@')[1];
          if(atPart){ const unitCostMatch = atPart.match(/\$[0-9,.]+/); if(unitCostMatch){ const uc=parseFloat(unitCostMatch[0].replace(/[$,]/g,'')); if(!Number.isNaN(uc)) unitCost=uc; } }
          const beforeAt = sizeText.split('@')[0];
          if(beforeAt){ const qtyMatch = beforeAt.match(/([0-9][0-9,]*(?:\.[0-9]+)?)/); if(qtyMatch){ quantity=parseFloat(qtyMatch[1].replace(/,/g,'')); const remainder = beforeAt.slice(qtyMatch.index + qtyMatch[1].length).trim(); const unitTok = remainder.split(/\s+/).filter(Boolean)[0]; if(unitTok) unit = unitTok.replace(/\.$/,''); } }
          if(quantity!=null && unitCost!=null && (totalCost==null || totalCost===0)) totalCost = quantity * unitCost;
          const unitCanonical = canonicalizeUnit(unit);
          normRows.push({ name, rawSize:sizeText, rawCost:est, quantity, unit:unitCanonical, unitRaw:unit, unitCost, totalCost, landownerMatch });
        });
        const discrepancy = (reportedTotal!=null ? reportedTotal - sumEst : null);
        const matchDiscrepancy = (reportedMatchTotal!=null ? reportedMatchTotal - sumMatch : null);
        return {
          table: { columns: ['Activity','Size/Amount','Estimated Cost','Landowner Match'], rows, total: reportedTotal, landownerMatchTotal: reportedMatchTotal },
          normalized: { rows: normRows, totalReported: reportedTotal, totalComputed: sumEst, landownerMatchReported: reportedMatchTotal, landownerMatchComputed: sumMatch, discrepancy, matchDiscrepancy }
        };
      }
      if(kind === 'practice_costs') {
        const window = allLines.slice(startIdx, startIdx+80);
        // Merge potential multi-line names (e.g., Water Diversion Pads /(feet) ...)
        const rows = [];
        let reportedTotal = null;
        // Find index where header ends: skip lines until we see one that contains a dollar OR word after header tokens
        let j = 0;
        // Consume header lines (Practice, Unit Cost..., Number of Units Total Cost etc.)
        while(j < window.length && !/\$[0-9]/.test(window[j])) j++;
        // Now parse until we hit 'Low DO' or blank + next non-cost section or end
        const collected = [];
        for(; j < window.length; j++){
          let line = window[j];
            if(!line){ collected.push(line); continue; }
            if(/Low DO\/Organic/i.test(line)) break;
            if(/^Participants/i.test(line)) break;
            // capture total which may be split across lines ("Total" then dollar on later line)
            if(/^Total\s*$/i.test(line.trim())){
              // search forward for first dollar
              for(let k=j+1;k<window.length;k++){ const dl = window[k]; if(/\$[0-9]/.test(dl)){ const m=dl.match(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/); if(m){ reportedTotal=parseFloat(m[0].replace(/[$,]/g,'')); } break;} }
              break;
            }
            collected.push(line);
        }
        // Pre-merge: if a line has no dollars and next line starts with '(' or contains a $ treat as continuation
        const merged = [];
        for(let i2=0;i2<collected.length;i2++){
          let line = collected[i2];
          if(!line) continue;
          if(!/\$[0-9]/.test(line) && collected[i2+1] && /\$[0-9]/.test(collected[i2+1])){
            line = line + ' ' + collected[i2+1].trim();
            i2++;
          }
          merged.push(line);
        }
        const rowRe = /^(.*?)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s+([0-9][0-9,]*)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/;
        merged.forEach(raw => {
          const m = raw.match(rowRe);
          if(!m) return;
          let name = m[1].trim().replace(/\s{2,}/g,' ');
          if(/\(feet\)$/i.test(name) && !/feet\)/i.test(name)) name += ' (feet)';
          const unitCost = m[2];
            const qty = m[3];
          const total = m[4];
          rows.push({ 'Practice': name, 'Unit Cost w/Installation': '$'+unitCost.replace(/^\$/,''), 'Number of Units': qty, 'Total Cost': '$'+total.replace(/^\$/,'') });
        });
        if(!rows.length) return null;
        // Normalize
        const normRows = [];
        let computed = 0;
        rows.forEach(r => {
          const name = r['Practice'];
          const unitCost = parseFloat(r['Unit Cost w/Installation'].replace(/[$,]/g,''));
          const quantity = parseFloat(r['Number of Units'].replace(/,/g,''));
          const totalCost = parseFloat(r['Total Cost'].replace(/[$,]/g,''));
          if(!Number.isNaN(totalCost)) computed += totalCost;
          normRows.push({ name, quantity: Number.isNaN(quantity)? null: quantity, unit:null, unitRaw:null, unitCost: Number.isNaN(unitCost)? null: unitCost, totalCost: Number.isNaN(totalCost)? null: totalCost, rawSize: quantity!=null? quantity+' units': '', rawCost: r['Total Cost'] });
        });
        return {
          table: { columns:['Practice','Unit Cost w/Installation','Number of Units','Total Cost'], rows, total: reportedTotal },
          normalized: { rows: normRows, totalReported: reportedTotal, totalComputed: computed, discrepancy: (reportedTotal!=null? reportedTotal - computed : null) }
        };
      }
      if(kind === 'bell_creek_bmps') {
        const window = allLines.slice(startIdx, startIdx+40);
        const rows = [];
        let reportedTotal = null;
        // Find header: Practice Area Affected BMP Cost BMP Total
        let j = 0;
        while(j < window.length && !/Practice\s+Area Affected\s+BMP Cost\s+BMP Total/i.test(window[j])) j++;
        j++; // skip header
        // Parse until "Total" line or next section
        for(; j < window.length; j++){
          const line = window[j];
          if(!line?.trim()) continue;
          if(/^Total\s*$/i.test(line.trim())){
            // Look for total amount on next line
            for(let k=j+1; k<window.length; k++){
              const dl = window[k];
              if(/\$[0-9]/.test(dl)){
                const m = dl.match(/\$([0-9][0-9,]*(?:\.[0-9]{2})?)/);
                if(m) reportedTotal = parseFloat(m[1].replace(/,/g,''));
                break;
              }
            }
            break;
          }
          if(/Table\s*8\.2|Technical Assistance/i.test(line)) break;
          // Bell Creek format: Practice Area_Affected BMP_Cost BMP_Total
          // Example: "Streambank and Shoreline Protection 2,500 feet $69.17/ft $172,904"
          // Handle cases with spaces like "$10,000/ ea"
          const m = line.match(/^(.*?)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+(feet|acres|structures|each)\s+\$([0-9][0-9,]*(?:\.[0-9]+)?)\s*(?:\/\s*\w+)?\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/);
          if(m){
            const name = m[1].trim();
            const quantity = m[2].replace(/,/g,'');
            const unit = m[3];
            const unitCost = m[4].replace(/,/g,'');
            const total = m[5].replace(/,/g,'');
            rows.push({ 'Practice': name, 'Area Affected': quantity + ' ' + unit, 'BMP Cost': '$' + unitCost + '/' + (unit === 'feet' ? 'ft' : unit === 'acres' ? 'ac' : unit === 'structures' ? 'ea' : unit === 'each' ? 'ea' : unit), 'BMP Total': '$'+total });
          }
        }
        if(!rows.length) return null;
        // Normalize
        const normRows = [];
        let computed = 0;
        rows.forEach(r => {
          const name = r['Practice'];
          const areaText = r['Area Affected'] || '';
          const quantity = parseFloat(areaText.replace(/[^0-9.]/g,''));
          const costText = r['BMP Cost'] || '';
          const unitCostMatch = costText.match(/\$([0-9][0-9,]*(?:\.[0-9]+)?)/);
          const unitCost = unitCostMatch ? parseFloat(unitCostMatch[1].replace(/,/g,'')) : null;
          const totalCost = parseFloat(r['BMP Total'].replace(/[$,]/g,''));
          if(!Number.isNaN(totalCost)) computed += totalCost;
          const unit = areaText.includes('feet') ? 'ft' : areaText.includes('acres') ? 'ac' : areaText.includes('each') ? 'each' : areaText.includes('structures') ? 'structures' : null;
          normRows.push({ name, quantity: Number.isNaN(quantity)? null: quantity, unit, unitRaw: unit, unitCost: Number.isNaN(unitCost)? null: unitCost, totalCost: Number.isNaN(totalCost)? null: totalCost, rawSize: areaText, rawCost: r['BMP Total'] });
        });

        return {
          table: { columns:['Practice','Area Affected','BMP Cost','BMP Total'], rows, total: reportedTotal },
          normalized: { rows: normRows, totalReported: reportedTotal, totalComputed: computed, discrepancy: (reportedTotal!=null? reportedTotal - computed : null) }
        };
      }
      if(kind === 'tech_assistance') {
        const window = allLines.slice(startIdx, startIdx+20);
        const rows = [];
        let reportedTotal = null;
        // Simple Item | Cost format
        let j = 0;
        while(j < window.length && !/Item\s+Cost/i.test(window[j])) j++;
        j++; // skip header
        for(; j < window.length; j++){
          const line = window[j];
          if(!line?.trim()) continue;
          if(/^Total\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)/i.test(line)){
            const m = line.match(/\$([0-9][0-9,]*(?:\.[0-9]{2})?)/);
            if(m) reportedTotal = parseFloat(m[1].replace(/,/g,''));
            break;
          }
          const m = line.match(/^(.*?)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/);
          if(m){
            rows.push({ 'Item': m[1].trim(), 'Cost': '$'+m[2] });
          }
        }
        if(!rows.length) return null;
        const normRows = [];
        let computed = 0;
        rows.forEach(r => {
          const name = r['Item'];
          const totalCost = parseFloat(r['Cost'].replace(/[$,]/g,''));
          if(!Number.isNaN(totalCost)) computed += totalCost;
          normRows.push({ name, quantity: null, unit: null, unitRaw: null, unitCost: null, totalCost: Number.isNaN(totalCost)? null: totalCost, rawSize: 'N/A', rawCost: r['Cost'] });
        });
        return {
          table: { columns:['Item','Cost'], rows, total: reportedTotal },
          normalized: { rows: normRows, totalReported: reportedTotal, totalComputed: computed, discrepancy: (reportedTotal!=null? reportedTotal - computed : null) }
        };
      }
      if(kind === 'phase1_bmps') {
        const window = allLines.slice(startIdx, startIdx+30);
        const rows = [];
        let reportedTotal = null;
        // Find header: BMPs Amount Estimated Cost
        let j = 0;
        while(j < window.length && !/BMPs\s*Amount\s*Estimated Cost/i.test(window[j])) j++;
        j++; // skip header
        for(; j < window.length; j++){
          const line = window[j];
          if(!line?.trim()) continue;
          if(/^Total.*\$([0-9][0-9,]*(?:\.[0-9]{2})?)/i.test(line)){
            const m = line.match(/\$([0-9][0-9,]*(?:\.[0-9]{2})?)/);
            if(m) reportedTotal = parseFloat(m[1].replace(/,/g,''));
            break;
          }
          if(/Technical Assistance|Education and Outreach|Monitoring|Project Management/i.test(line)) break;
          // Upper Piney format: BMP_Name [space] Amount Unit [space] Estimated_Cost
          // Example: "Grade Stabilization Structure (med. Flow/med. Fill) 25 each $235,550"
          const m = line.match(/^(.*?)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+(each|ac|cy|ft|acres)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/);
          if(m){
            const name = m[1].trim();
            const quantity = m[2].replace(/,/g,'');
            const unitText = m[3]; 
            const total = m[4].replace(/,/g,'');
            rows.push({ 'BMPs': name, 'Amount': quantity + ' ' + unitText, 'Estimated Cost': '$'+total });
          }
        }
        if(!rows.length) return null;
        // Normalize
        const normRows = [];
        let computed = 0;
        rows.forEach(r => {
          const name = r['BMPs'];
          const amountText = r['Amount'] || '';
          const quantity = parseFloat(amountText.replace(/[^0-9.]/g,''));
          const unit = amountText.includes('each') ? 'each' : amountText.includes('ac') ? 'ac' : amountText.includes('cy') ? 'cy' : amountText.split(' ').pop();
          const totalCost = parseFloat(r['Estimated Cost'].replace(/[$,]/g,''));
          if(!Number.isNaN(totalCost)) computed += totalCost;
          const unitCost = (!Number.isNaN(quantity) && quantity > 0 && !Number.isNaN(totalCost)) ? totalCost / quantity : null;
          normRows.push({ name, quantity: Number.isNaN(quantity)? null: quantity, unit, unitRaw: unit, unitCost, totalCost: Number.isNaN(totalCost)? null: totalCost, rawSize: amountText, rawCost: r['Estimated Cost'] });
        });
        return {
          table: { columns:['BMPs','Amount','Estimated Cost'], rows, total: reportedTotal },
          normalized: { rows: normRows, totalReported: reportedTotal, totalComputed: computed, discrepancy: (reportedTotal!=null? reportedTotal - computed : null) }
        };
      }
      if(kind === 'booths_creek_bmps') {
        const window = allLines.slice(startIdx, startIdx+50);
        const rows = [];
        let reportedTotal = null;
        // Find header: Code Practice Units Cost Estimated Units Total
        let j = 0;
        while(j < window.length && !/Code\s+Practice\s+Units\s+Cost/i.test(window[j])) j++;
        j++; // skip header
        for(; j < window.length; j++){
          const line = window[j];
          if(!line?.trim()) continue;
          if(/^Total\s*\$([0-9][0-9,]*(?:\.[0-9]{2})?)/i.test(line)){
            const m = line.match(/\$([0-9][0-9,]*(?:\.[0-9]{2})?)/);
            if(m) reportedTotal = parseFloat(m[1].replace(/,/g,''));
            break;
          }
          // Stop at next section indicators
          if(/In addition to these costs|Element|Activity.*Estimated Cost/i.test(line)) break;
          
          // Booths Creek format: "Code Practice Units Cost EstimatedUnits Total"
          // Example: "314 Brush Management ac $44.70            500  $22,350.00"
          const m = line.match(/^([0-9]+)\s+(.*?)\s+(ac|ft|ea|each|cuyd|sqft|gal|no)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s+([0-9][0-9,]*(?:\.[0-9]+)?)\s+\$([0-9][0-9,]*(?:\.[0-9]{2})?)\s*$/);
          if(m){
            const code = m[1];
            const practice = m[2].trim();
            const unit = m[3];
            const unitCost = m[4];
            const estimatedUnits = m[5];
            const total = m[6];
            rows.push({ 
              'Code': code, 
              'Practice': practice, 
              'Units': unit, 
              'Cost': '$'+unitCost, 
              'Estimated Units': estimatedUnits, 
              'Total': '$'+total 
            });
          }
        }
        if(!rows.length) return null;
        // Normalize
        const normRows = [];
        let computed = 0;
        rows.forEach(r => {
          const name = r['Practice'];
          const code = r['Code'];
          const unitText = r['Units'];
          const unitCost = parseFloat(r['Cost'].replace(/[$,]/g,''));
          const quantity = parseFloat(r['Estimated Units'].replace(/,/g,''));
          const totalCost = parseFloat(r['Total'].replace(/[$,]/g,''));
          if(!Number.isNaN(totalCost)) computed += totalCost;
          
          // Canonicalize unit
          function canonicalizeUnit(u){ 
            if(!u) return null; 
            const raw=u.toLowerCase().replace(/\.$/,''); 
            const map={ 
              'each':'each','ea':'each','ac':'acre','acre':'acre','acres':'acre',
              'ft':'ft','feet':'ft','foot':'ft','lf':'linear_ft',
              'cuyd':'cu_yd','cy':'cu_yd','sqft':'sq_ft','gal':'gal','no':'each'
            }; 
            return map[raw]||raw.replace(/[^a-z0-9_]/g,''); 
          }
          
          const unit = canonicalizeUnit(unitText);
          normRows.push({ 
            name: `${code} - ${name}`, 
            quantity: Number.isNaN(quantity)? null: quantity, 
            unit, 
            unitRaw: unitText, 
            unitCost: Number.isNaN(unitCost)? null: unitCost, 
            totalCost: Number.isNaN(totalCost)? null: totalCost, 
            rawSize: quantity + ' ' + unitText, 
            rawCost: r['Total'] 
          });
        });
        return {
          table: { columns:['Code','Practice','Units','Cost','Estimated Units','Total'], rows, total: reportedTotal },
          normalized: { rows: normRows, totalReported: reportedTotal, totalComputed: computed, discrepancy: (reportedTotal!=null? reportedTotal - computed : null) }
        };
      }
      const window = allLines.slice(startIdx, startIdx+110);
      // identify header and total boundaries
      const headerIdx = window.findIndex(l => /BMPs\*/i.test(l) && /Size\/Amount/i.test(l));
      const totalIdxRel = window.findIndex(l => /Total Estimated (Phase 1 )?Cost/i.test(l));
      const totalIdx = totalIdxRel === -1 ? -1 : totalIdxRel;
      const headerCells = ['BMP','Size/Amount','Estimated Cost'];
      const rows = [];
      let reportedTotal = null;
      const searchEnd = totalIdx !== -1 ? totalIdx : window.length;
      for(let j = (headerIdx!==-1? headerIdx+1:1); j < window.length; j++){
        const line = window[j];
        if(!line) continue;
        if(/^Element\s+[a-i]:/i.test(line)) break;
        if(/Cost Estimate:/i.test(line) && j>3) break; // next table start
        if(/Total Estimated (Phase 1 )?Cost/i.test(line)){
          const m = line.match(/\$[0-9,]+(\.[0-9]{2})?/);
          if(m){ const num = parseFloat(m[0].replace(/[$,]/g,'')); if(!Number.isNaN(num)) reportedTotal = num; }
          break; // stop after total line
        }
        const raw = line.trim();
        if(!/\$/i.test(raw)) continue; // must contain cost
        // Basic extraction similar to previous logic
        const moneyMatches = [...raw.matchAll(/\$[0-9][0-9,]*(?:\.[0-9]{2})?/g)].map(m=>m[0]);
        if(!moneyMatches.length) continue;
        const lastMoney = moneyMatches[moneyMatches.length-1];
        const lastIdx = raw.lastIndexOf(lastMoney);
        let left = raw.slice(0,lastIdx).trim();
        let cost = lastMoney;
        left = left.replace(new RegExp(lastMoney.replace(/[$]/g,'\\$')+'$'),'').trim();
        let name = left;
        let sizeAmount='';
        const sizeBoundary = left.search(/(\b[0-9][0-9,]*\b|N\/A|@)/i);
        if(sizeBoundary !== -1){
          name = left.slice(0,sizeBoundary).trim();
          sizeAmount = left.slice(sizeBoundary).trim();
        }
        name = name.replace(/\*+$/,'').trim();
        if(!name || /^Total Estimated/i.test(name)) continue;
        // narrative guard
        if(name.split(/\s+/).length > 10 && !/@/.test(sizeAmount) && !/\b[0-9]/.test(sizeAmount)) continue;
        rows.push({ 'BMP': name, 'Size/Amount': sizeAmount, 'Estimated Cost': cost });
      }
      if(!rows.length) return null;
      // dedupe
      const seen = new Set();
      const cleaned = [];
      rows.forEach(r => { const key = r.BMP.toLowerCase(); if(seen.has(key)) return; seen.add(key); cleaned.push(r); });
      // Normalization
      const normRows = [];
      let computedTotal = 0;
      const moneyRegex = /\$[0-9,.]+/;
      function canonicalizeUnit(u){
        if(!u) return null;
        const raw = u.toLowerCase().replace(/\.$/,'');
        const map = { 'each':'each','ea':'each','ac':'acre','acre':'acre','acres':'acre','ft':'ft','feet':'ft','foot':'ft','lf':'linear_ft','linft':'linear_ft','linear':'linear_ft','linearft':'linear_ft','sqft':'sq_ft','sq.ft':'sq_ft','sq':'sq_ft','sq_ft':'sq_ft','sq.ft.':'sq_ft','yd':'yd','yds':'yd','cuyd':'cu_yd','cy':'cu_yd','cu.yd':'cu_yd','gal':'gal','gals':'gal','gallon':'gal','gallons':'gal','mgd':'mgd','mg/l':'mg_per_l','mg\u002fl':'mg_per_l','tpy':'tpy'};
        return map[raw] || raw.replace(/[^a-z0-9_]/g,'');
      }
      cleaned.forEach(r => {
        const name = r.BMP;
        const sizeText = r['Size/Amount']||'';
        const costText = r['Estimated Cost']||'';
        let quantity=null, unit=null, unitCost=null, totalCost=null;
        const totalMatchRow = (costText.match(moneyRegex)||[]).at(0);
        if(totalMatchRow){ const num = parseFloat(totalMatchRow.replace(/[$,]/g,'')); if(!Number.isNaN(num)) totalCost = num; }
        const atPart = sizeText.split('@')[1];
        if(atPart){ const unitCostMatch = atPart.match(/\$[0-9,.]+/); if(unitCostMatch){ const uc = parseFloat(unitCostMatch[0].replace(/[$,]/g,'')); if(!Number.isNaN(uc)) unitCost = uc; } }
        const beforeAt = sizeText.split('@')[0];
        if(beforeAt){ const qtyMatch = beforeAt.match(/([0-9][0-9,]*(?:\.[0-9]+)?)/); if(qtyMatch){ quantity = parseFloat(qtyMatch[1].replace(/,/g,'')); const remainder = beforeAt.slice(qtyMatch.index + qtyMatch[1].length).trim(); const unitTok = remainder.split(/\s+/).filter(Boolean).filter(t=>!/^(each|@)$/i.test(t))[0]; if(unitTok) unit = unitTok.replace(/\.$/,''); } }
        if(quantity!=null && unitCost!=null && (totalCost==null || totalCost===0)) totalCost = quantity * unitCost;
        if(totalCost!=null) computedTotal += totalCost;
        const unitCanonical = canonicalizeUnit(unit);
        normRows.push({ name, rawSize:sizeText, rawCost:costText, quantity, unit:unitCanonical, unitRaw:unit, unitCost, totalCost });
      });
      const discrepancy = (reportedTotal!=null && computedTotal) ? (reportedTotal - computedTotal) : null;
      return {
        table: { columns: ['BMP','Size/Amount','Estimated Cost'], rows: cleaned, total: reportedTotal },
        normalized: { rows: normRows, totalReported: reportedTotal, totalComputed: computedTotal || null, discrepancy }
      };
    }
    tableStarts.forEach(start => {
      const parsed = parseWindow(start.index, start.kind);
      if(parsed){
        const id = start.kind === 'full_project' ? 'full_project_implementation' : (start.kind === 'phase1' ? 'phase1_implementation' : 'cost_table');
        // Deduplicate: skip if a pattern-based table with same column signature already present
        const newColsSig = (parsed.table?.columns||[]).join('|').toLowerCase();
        const exists = bmpCostTables.some(t => (t.table?.columns||[]).join('|').toLowerCase() === newColsSig && t.title === start.title);
        if(!exists){
          // Assign synthetic patternId & confidence for legacy heuristics so they surface in metadata
          const patternIdMap = {
            'bell_creek_bmps':'bell_creek_format',
            'phase1_bmps':'phase1_bmps_format',
            'booths_creek_bmps':'booths_creek_format',
            'practice_costs':'practice_costs_format',
            'activity_match':'activity_match_format',
            'full_project':'full_project_estimate',
            'phase1':'phase1_estimate',
            'tech_assistance':'tech_assistance_format'
          };
          const confidenceMap = {
            'bell_creek_bmps':0.85,
            'phase1_bmps':0.8,
            'booths_creek_bmps':0.85,
            'practice_costs':0.75,
            'activity_match':0.7,
            'full_project':0.65,
            'phase1':0.65,
            'tech_assistance':0.6
          };
          const patternId = patternIdMap[start.kind] || null;
          const patternConfidence = confidenceMap[start.kind] || (patternId?0.5:null);
          bmpCostTables.push({ id, title: start.title, table: parsed.table, patternId, patternConfidence });
          bmpCostTablesNormalized.push({ id, title: start.title, patternId, patternConfidence, ...parsed.normalized });
        }
      }
    });
    if(bmpCostTables.length){
      // Choose legacy single table as the full project if present else first
      const primary = bmpCostTables.find(t=>t.id==='full_project_implementation') || bmpCostTables[0];
      const primaryNorm = bmpCostTablesNormalized.find(t=>t.id===primary.id) || bmpCostTablesNormalized[0];
      bmpCostTable = primary;
      bmpCostTableNormalized = primaryNorm;
    }
  } catch(err){ /* swallow */ }
  return { bmpCostTable, bmpCostTableNormalized, bmpCostTables, bmpCostTablesNormalized };
}
// (legacy single-table parse block removed in refactor above)

function finalizeReport(goals, sections, sourceId, sourceFile, fallbackGoalHeuristicUsed=false, costArtifacts){
  const { bmpCostTable, bmpCostTableNormalized, bmpCostTables, bmpCostTablesNormalized } = costArtifacts || {};
  let bmps = extractBMPs(sections.BMPs || []);
  let bmpFallbackApplied = false;
  // --- BMP Fallbacks ---------------------------------------------------------
  // 1. Cost table derived BMPs (from all parsed tables)
  const costTablesForInjection = (bmpCostTables && bmpCostTables.length) ? bmpCostTables : (bmpCostTable ? [bmpCostTable] : []);
  costTablesForInjection.forEach(ct => {
    if (!(ct && Array.isArray(ct.rows))) return;
    const existingLower = new Set(bmps.map(b=>b.name.toLowerCase()));
    const skipRe = /^(total|technical assistance|education and outreach|monitoring|project management)$/i;
    ct.rows.forEach(r => {
      const rawName = r[ct.columns[0]];
      if(!rawName) return;
      let name = rawName.replace(/\*+$/,'').trim();
      if(!name) return;
      // Filter trivial header tokens like 'BMPs*'
      if(/^bmps\*?$/i.test(name)) return;
      if(skipRe.test(name)) return;
      const lower = name.toLowerCase();
      if(existingLower.has(lower)) return;
      bmps.push({ id:`B${bmps.length+1}`, name, category:'General', keyword:null, quantity:null, unit:null, verb:null, confidence:0.32, source:`cost_table_row:${ct.id}:${name}` });
      existingLower.add(lower);
    });
    // Completeness check: if we parsed N cost rows and have < N BMPs referencing cost_table_row, attempt to add any missed rows
    const costRowNames = ct.rows.map(r=> (r[ct.columns[0]]||'').replace(/\*+$/,'').trim()).filter(Boolean)
      .filter(n=>!/^bmps\*?$/i.test(n) && !skipRe.test(n));
    const injectedSet = new Set(bmps.filter(b=>/cost_table_row:/.test(b.source||'')).map(b=>b.name.toLowerCase()));
    costRowNames.forEach(n => { const lower = n.toLowerCase(); if(!injectedSet.has(lower)){ bmps.push({ id:`B${bmps.length+1}`, name:n, category:'General', keyword:null, quantity:null, unit:null, verb:null, confidence:0.28, source:`cost_table_row_late:${n}` }); injectedSet.add(lower);} });
  });
  // 2. Summary dollar-line patterns e.g. "Ag BMP $3,803,456" or "Fisheries Management $185,148" outside tables
  //    We look across all section lines when BMP section sparse.
  if (bmps.length < 3) {
    const allSectionLines = Object.values(sections).flat().filter(l=>typeof l === 'string');
    const dollarLineRe = /^([A-Z][A-Za-z &/]+?)\s+\$[0-9,]{3,}(?:\.[0-9]{2})?$/;
    const existingLower = new Set(bmps.map(b=>b.name.toLowerCase()));
    allSectionLines.forEach(line => {
      const m = line.trim().match(dollarLineRe);
      if(!m) return;
      const name = m[1].trim();
      if (/^total$/i.test(name)) return;
      const lowerName = name.toLowerCase();
      if (existingLower.has(lowerName)) {
        // If already from cost table, promote confidence and append source tag
        const existing = bmps.find(b=>b.name.toLowerCase()===lowerName);
        if (existing) {
          existing.confidence = Math.min(0.9, Math.max(existing.confidence||0.3, 0.55));
          if (!/summary_line:/.test(existing.source||'')) {
            existing.source = (existing.source ? existing.source + '|' : '') + `summary_line:${line.trim()}`;
          }
        }
        return;
      }
      // Basic category inference for these summary lines
      let category = 'General';
      if (/aquatic|fisher/i.test(name)) category = 'Aquatic';
      if (/ag\s*bmp|agric|crop/i.test(name)) category = 'Agriculture';
      if (/noxious|invasive/i.test(name)) category = 'Invasive Species';
      bmps.push({ id:`B${bmps.length+1}`, name, category, keyword:null, quantity:null, unit:null, verb:null, confidence:0.25, source:`summary_line:${line.trim()}` });
      existingLower.add(name.toLowerCase());
    });
  }
  // Optional post-filter pass (env controlled)
  let bmpRejected = [];
  if(process.env.BMP_FILTER === '1'){
    try {
      const { filtered, rejected } = filterBMPs(bmps);
      bmps = filtered.map((b,i)=> ({ ...b, id:`B${i+1}` }));
      bmpRejected = rejected;
    } catch(e){ /* swallow filter errors */ }
  }
  // Confidence promotion: if an injected BMP has both cost_table_row and summary_line sources now, ensure confidence >=0.6
  bmps.forEach(b => {
    if(/cost_table_row:/.test(b.source||'') && /summary_line:/.test(b.source||'')){
      b.confidence = Math.max(b.confidence||0, 0.6);
    }
  });
  // --- Name Cleanup: strip trailing quantity/@/cost fragments when raw cost table lines leaked into BMP extraction ---
  function stripCostTail(name){
    if(!name) return name;
    if(!/[\$@]/.test(name) && !/\d/.test(name)) return name; // likely already clean
    // Capture leading phrase before a quantity + unit + optional @ or first standalone cost token
    const m = name.match(/^(.*?)(?:\s+\d[\d,]*(?:\.[0-9]+)?\s*(?:ac|acre|acres|ft|feet|ea|es|lf|yd|yds|cy|cuyd|sq\.?ft\.?|ac\.|ft\.|ea\.)\b.*|\s+@\s*\$|\s+\$[0-9])/i);
    if(m && m[1]){
      const cleaned = m[1].trim().replace(/[,:;]+$/,'').trim();
      if(cleaned && cleaned.length >= 2) return cleaned; // avoid over-trimming to empty
    }
    return name;
  }
  let anyStripped = false;
  bmps.forEach(b => {
    const original = b.name;
    const cleaned = stripCostTail(original);
    if(cleaned !== original){
      b.originalName = original;
      b.name = cleaned;
      b.source = (b.source ? b.source+'|' : '') + 'name_cost_tail_trim';
      anyStripped = true;
    }
  });
  if(anyStripped){
    // Deduplicate resulting names (keep first occurrence, drop later duplicates with lower confidence)
    const seen = new Set();
    const dedup = [];
    bmps.forEach(b => {
      const k = (b.name||'').toLowerCase();
      if(!k) return;
      if(seen.has(k)) return;
      seen.add(k);
      dedup.push(b);
    });
    bmps = dedup;
  }
  // Re-sequence BMP IDs after possible injections
  bmps.forEach((b,i)=> b.id = `B${i+1}`);
  // Bronze rawText fallback: if still zero BMPs and no explicit BMP section lines, attempt to mine bronze narrative lists
  if(bmps.length === 0 && (!sections.BMPs || sections.BMPs.length === 0) && sourceId){
    try {
      let bronzePath = path.join(process.cwd(), 'backend', 'data', 'bronze', `${sourceId}.json`);
      if(!fs.existsSync(bronzePath)){
        const alt = path.join(process.cwd(), 'data', 'bronze', `${sourceId}.json`);
        if(fs.existsSync(alt)) bronzePath = alt;
      }
      if(fs.existsSync(bronzePath)){
        const rawJson = JSON.parse(fs.readFileSync(bronzePath,'utf8'));
        const raw = rawJson?.rawText || '';
        if(raw){
          // Look for anchor phrases introducing BMP enumerations
          const anchorRe = /(These\s+BMPs\s+include[^\n]*:|These\s+BMPs\s+will[^\n]*:|The\s+BMPs\s+include[^\n]*:)/i;
          const m = raw.match(anchorRe);
          if(m){
            const startIdx = m.index + m[0].length;
            // Slice forward up to 1200 chars to capture bullet / list region
            const slice = raw.slice(startIdx, startIdx + 1200);
            // Split into lines, capture bullet style entries beginning with •, -, *, or capitalized phrases ending with comma
            const lines = slice.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
            const collected = [];
            for(const line of lines){
              if(/^\s*(?:[•\-*]\s+)?[A-Z][A-Za-z0-9 /&()'-]{2,}$/.test(line.replace(/[,;:.]+$/,''))){
                const name = line.replace(/^([•\-*]\s+)/,'').replace(/[,;:.]+$/,'').trim();
                if(/^(Total|Summary)$/i.test(name)) break;
                if(name.split(/\s+/).length > 12) continue; // avoid long narrative spillover
                collected.push(name);
                continue;
              }
              // Stop when we hit a blank line or a paragraph sentence (period in middle) after having collected some
              if(collected.length && /\./.test(line)) break;
              if(collected.length && line === '') break;
            }
            if(collected.length){
              const seen = new Set();
              collected.forEach(n=>{ const lower=n.toLowerCase(); if(seen.has(lower)) return; seen.add(lower); bmps.push({ id:`B${bmps.length+1}`, name:n, category:'General', keyword:null, quantity:null, unit:null, verb:null, confidence:0.22, source:'bronze_fallback:list' }); });
              bmpFallbackApplied = true;
            }
          }
        }
      }
    } catch(e){ /* swallow bmp fallback */ }
  }
  if(bmpFallbackApplied){
    // Re-sequence after fallback injection
    bmps.forEach((b,i)=> b.id = `B${i+1}`);
  }
  // (Cost table already parsed upstream; nothing to do here now)
  const activities = extractActivities(sections.Implementation || sections.Activities || []);
  const implementation = activities.map(a => ({ id: a.id.replace(/^A/,'I'), description: a.description, date: a.dueYear ? `${a.dueYear}-01-01` : null, target: null, achieved: null, source: a.source }));
  // Inline fallbacks in case helper functions are unexpectedly undefined at runtime
  const monitoring = (typeof parseMonitoring === 'function')
    ? parseMonitoring(sections.Monitoring || [])
    : (sections.Monitoring || []).map((line, idx) => ({ id:`M${idx+1}`, metric: line.trim(), value:null, unit:null, source: line }));
  const outreach = (typeof parseOutreach === 'function')
    ? parseOutreach(sections.Outreach || [])
    : (sections.Outreach || []).map((line, idx) => ({ id:`O${idx+1}`, activity: line.trim(), audience: inferAudience(line), source: line }));
  const geographicAreas = (typeof parseGeography === 'function')
    ? parseGeography(sections.Geography || [])
    : (sections.Geography || []).map((line, idx) => ({ id:`GA${idx+1}`, area: line.trim(), source: line }));
  const goalCompleted = goals.filter(g=>g.status==='completed').length;
  const goalInProgress = goals.filter(g=>g.status==='in_progress').length;
  const goalPlanned = goals.filter(g=>g.status==='planned').length;
  const avgGoalConfidence = goals.length ? (goals.reduce((s,g)=>s+(g.confidence||0),0)/goals.length) : 0;
  const bmpCategoryCounts = (() => { const c={}; bmps.forEach(b=>{ c[b.category]=(c[b.category]||0)+1; }); return c; })();
  const summary = {
    totalGoals: goals.length,
    totalBMPs: bmps.length,
    totalActivities: activities.length,
    primaryGoals: goals.filter(g=>g.isPrimary).length,
    completionRate: goals.length ? goalCompleted / goals.length : 0,
    totalMetrics: monitoring.length,
    goalStatus: {
      completed: goalCompleted,
      inProgress: goalInProgress,
      planned: goalPlanned,
      pctCompleted: goals.length ? goalCompleted/goals.length : 0,
      pctInProgress: goals.length ? goalInProgress/goals.length : 0,
      pctPlanned: goals.length ? goalPlanned/goals.length : 0
    },
    bmpCategories: bmpCategoryCounts,
    avgGoalConfidence,
    strongGoals: goals.filter(g=> (g.confidence||0) >= 0.7).length
  };
  return {
    id: sourceId || null,
    summary,
    goals,
    mainGoals: goals.filter(g=>g.isPrimary),
    bmps,
    bmpRejected: bmpRejected.length ? bmpRejected : undefined,
  bmpCostTable,
  bmpCostTableNormalized,
  bmpCostTables: bmpCostTables || null,
  bmpCostTablesNormalized: bmpCostTablesNormalized || null,
    activities,
    implementation,
    monitoring,
    outreach,
    geographicAreas,
    generatedAt: new Date().toISOString(),
    metadata: { 
      sourceId, 
      sourceFile, 
      enrichmentVersion: 3, 
      fallbackGoalHeuristicUsed,
      bmpFallbackApplied,
      costPatternsDetected: Array.isArray(bmpCostTablesNormalized) ? bmpCostTablesNormalized.filter(t=>t?.patternId).map(t=>({ id: t.patternId, title: t.title, confidence: t.patternConfidence || null, totalReported: t.totalReported ?? null, totalComputed: t.totalComputed ?? null })) : []
    }
  };
}

export function buildStructuredReport(sections, options = {}) {
  const { sourceId = null, sourceFile = null } = options;

  // --- Deterministic bronze rawText slice for primary goal (pre-extractor) ---
  // Simple, robust approach: locate 'The ultimate goal' in bronze rawText and slice through the
  // first occurrence of 'watershed.' irrespective of intermediate periods. This precedes all
  // heuristic extraction so persistent truncation (Dry Creek) is resolved early.
  let precomputedGoals = null;
  if (sourceId) {
    try {
      let bronzePath = path.join(process.cwd(), 'backend', 'data', 'bronze', `${sourceId}.json`);
      if(!fs.existsSync(bronzePath)) {
        // Fallback to root-level data/bronze if running scripts from backend/ directory changes CWD assumptions
        const alt = path.join(process.cwd(), 'data', 'bronze', `${sourceId}.json`);
        if (fs.existsSync(alt)) bronzePath = alt;
      }
      if (fs.existsSync(bronzePath)) {
        const rawJson = JSON.parse(fs.readFileSync(bronzePath,'utf8'));
        if (rawJson && typeof rawJson.rawText === 'string') {
          const raw = rawJson.rawText;
          const lower = raw.toLowerCase();
          const start = lower.indexOf('the ultimate goal is to bring about');
          if (start !== -1) {
            // Allow up to 1500 chars to be safe.
            const slice = raw.slice(start, start + 1500);
            const lowerSlice = slice.toLowerCase();
            const endPos = lowerSlice.indexOf('watershed.');
            if (endPos !== -1) {
              let sentence = slice.slice(0, endPos + 'watershed.'.length);
              // Normalize encodings & whitespace
              sentence = sentence
                .replace(/[“”]/g,'"')
                .replace(/â€œ|â|ΓÇ£/g,'"')
                .replace(/â€|ΓÇ¥/g,'"')
                .replace(/â€™|ΓÇÖ/gi,"'")
                .replace(/â€“|â€”|ΓÇô/g,'-')
                .replace(/\s+/g,' ') // collapse whitespace
                .trim();
              if(/goal/i.test(sentence) && /watershed\.$/i.test(sentence)) {
                precomputedGoals = [{
                  id: 'G1',
                  title: sentence,
                  status: inferStatus(sentence),
                  pollutant: (sentence.match(POLLUTANT_TERMS)||[])[1]?.toLowerCase()||null,
                  parameter: (sentence.match(POLLUTANT_TERMS)||[])[1]?.toLowerCase()||null,
                  reductionPercent: null,
                  baselineValue: null,
                  baselineUnit: null,
                  targetValue: null,
                  targetUnit: null,
                  achievedValue: null,
                  achievedUnit: null,
                  loadReductionValue: null,
                  loadReductionUnit: null,
                  deadline: null,
                  deadlineYear: null,
                  baselineYear: null,
                  achievedYear: null,
                  targetYear: null,
                  responsible: null,
                  source: sentence,
                  confidence: 0.95,
                  isPrimary: true,
                  primaryReason: 'bronze_direct_slice',
                  description: sentence,
                  originalSentence: sentence,
                  shortTitle: sentence.length <= 140 ? sentence : sentence.split(/\s+/).slice(0,14).join(' ') + '…'
                }];
              }
            }
          }
        }
      }
    } catch(e){ /* swallow */ }
  }

  // Primary enhanced extraction from declared sections
  // Dry Creek (and similar) issue: the "ultimate goal" sentence is split across sections
  // with only the first fragment (ending in 'use of') landing inside the Goals section and
  // the continuation ("\"best management practices\" that will improve water quality ... watershed.")
  // appearing under Outreach / Education style sections. To allow the extractor's existing
  // multiline join + overrides to operate, we opportunistically append candidate continuation
  // lines from other sections when we detect this specific truncated pattern.
  // Parse cost table artifacts once up front (independent of goal path)
  const costArtifacts = parseCostTable(sections);

  if (precomputedGoals) {
    // Skip heuristic extraction entirely if we have deterministic slice.
    return finalizeReport(precomputedGoals, sections, sourceId, sourceFile, false, costArtifacts);
  }
  let goalSourceLines = sections.Goals ? [...sections.Goals] : [];
  const hasTruncatedUltimate = goalSourceLines.some(l => /The ultimate goal is to bring about/i.test(l) && /use of$/i.test(l.trim()));
  if (hasTruncatedUltimate) {
    // Escalate: supply ALL section lines so enhancedExtractors can run window/override logic.
    const allLines = Object.values(sections).filter(Array.isArray).flat();
    if (allLines.length) {
      goalSourceLines = [...goalSourceLines, ...allLines];
      const seen = new Set();
      goalSourceLines = goalSourceLines.filter(l => { if(seen.has(l)) return false; seen.add(l); return true; });
    }
  }
  // Pre-extractor deterministic Dry Creek streaming reconstruction if still truncated.
  if (hasTruncatedUltimate) {
    const allRaw = Object.values(sections).filter(Array.isArray).flat().join('\n');
    const norm = allRaw
      .replace(/[“”]/g,'"')
      .replace(/â€œ|â/g,'"')
      .replace(/â€/g,'"')
      .replace(/â€™/g,"'")
      .replace(/\s+/g,' ');
    const startIdx = norm.toLowerCase().indexOf('the ultimate goal is to bring about');
    if(startIdx !== -1){
      const window = norm.slice(startIdx, startIdx+600); // sentence well within 600 chars
      // Find end at first 'watershed.' after 'quality of life'
      const endMatch = window.match(/quality of life in the watershed\./i) || window.match(/watershed\./i);
      if(endMatch){
        const endPos = window.toLowerCase().indexOf(endMatch[0].toLowerCase()) + endMatch[0].length;
        let sentence = window.slice(0,endPos).trim();
        if(/best management practices/i.test(sentence) && /overall quality of life/i.test(sentence)){
          // Feed directly as sole goal line for extractor (it will early-return via override or treat as single).
          goalSourceLines.push(sentence);
        }
      }
    }
  }
  const goals = extractGoals(goalSourceLines);
  // Simple rawText streaming fallback (user-requested heuristic): if we still have a single truncated
  // goal ending in 'use of' then load the bronze rawText (if available) and capture the full sentence.
  if (goals.length === 1 && /use of$/i.test(goals[0].title) && sourceId) {
    try {
      const bronzePath = path.join(process.cwd(), 'backend', 'data', 'bronze', `${sourceId}.json`);
      if (fs.existsSync(bronzePath)) {
        const rawJson = JSON.parse(fs.readFileSync(bronzePath,'utf8'));
        if (rawJson && rawJson.rawText) {
          const raw = rawJson.rawText.replace(/\r/g,'');
          // Locate first line containing 'goal' (case-insensitive)
          const lower = raw.toLowerCase();
          let idx = lower.indexOf('the ultimate goal');
          if (idx === -1) idx = lower.indexOf('overall goal');
          if (idx === -1) idx = lower.indexOf('primary goal');
          if (idx === -1) idx = lower.indexOf(' goal ');
          if (idx !== -1) {
            const slice = raw.slice(idx, idx + 1000); // up to 1000 chars as per user guidance
            // Collapse internal whitespace for easier period detection but keep a clean version
            const sentenceMatch = slice.match(/^[\s\S]*?\./);
            if (sentenceMatch) {
              let sentence = sentenceMatch[0]
                .replace(/[“”]/g,'"')
                .replace(/â€œ|â/g,'"')
                .replace(/â€/g,'"')
                .replace(/â€™/g,"'")
                .replace(/\s+/g,' ')
                .trim();
              // Sanity: must still contain 'goal'
              if (/goal/i.test(sentence) && /watershed\./i.test(sentence)) {
                goals[0].title = sentence;
                goals[0].source = sentence;
                goals[0].description = sentence;
                goals[0].originalSentence = sentence;
                goals[0].shortTitle = sentence.length <= 140 ? sentence : sentence.split(/\s+/).slice(0,14).join(' ') + '…';
                goals[0].confidence = Math.max(goals[0].confidence||0.5, 0.85);
                goals[0].primaryReason = goals[0].primaryReason || 'raw_stream_fallback';
                goals[0].isPrimary = true;
              }
            }
          }
        }
      }
    } catch(err) {
      // swallow; fallback is best-effort
    }
  }
  const bmps = extractBMPs(sections.BMPs || []);
  const activities = extractActivities(sections.Implementation || sections.Activities || []);

  // --- Granular BMP Category Mapping (post primary + fallback extraction) ----
  function categorizeBMPName(name){
    const n = name.toLowerCase();
    // Ordered checks from most specific to broad
    if(/cover\s+crops?/.test(n)) return 'Cover Crops';
    if(/grassed\s+waterway/.test(n)) return 'Erosion Control';
    if(/sediment basin|sedimentation basin|grade stabilization|terraces?|diversions?/.test(n)) return 'Structural Erosion';
    if(/pond\b|stormwater pond|detention|retention/.test(n)) return 'Stormwater';
    if(/streambank|shoreline|bank stabilization|riprap|revetment/.test(n)) return 'Streambank Stabilization';
    if(/heavy use area protection|livestock|tank\/trough|trough|watering facility/.test(n)) return 'Livestock Management';
    if(/fencing/.test(n)) return 'Fencing';
    if(/forage.*biomass planting|biomass planting|forage planting/.test(n)) return 'Forage & Biomass';
    if(/aquatic|fisheries? management|fish habitat/.test(n)) return 'Aquatic Habitat';
    if(/invasive|noxious/.test(n)) return 'Invasive Species';
    if(/ag\s*bmp|agric|agriculture/.test(n)) return 'Agriculture';
    return null; // keep existing or General
  }
  bmps.forEach(b => {
    const mapped = categorizeBMPName(b.name||'');
    if(mapped && mapped !== b.category){
      b.category = mapped;
      b.confidence = Math.min(0.95, (b.confidence||0.3)+0.1);
      b.source = (b.source? b.source+'|' : '') + 'category_refine';
    }
  });

  // --- Fallback Goal Heuristic -------------------------------------------------
  // Some PDFs embed explicit goal statements in other sections (e.g. Monitoring)
  // without a distinct Goals section. If we found zero goals, scan other section
  // lines for those beginning with or containing 'Goal:' and attempt extraction.
  let fallbackGoalHeuristicUsed = false;
  if (goals.length === 0) {
    const candidateSections = ['Monitoring','Implementation','Activities','BMPs','Outreach'];
    const candidateLines = [];
    candidateSections.forEach(sec => {
      (sections[sec] || []).forEach(line => {
        if (/^\s*goal[:\-]/i.test(line) || /\bgoal:/i.test(line)) {
          candidateLines.push(line);
        }
      });
    });
    if (candidateLines.length) {
      const fbGoals = extractGoals(candidateLines);
      if (fbGoals.length) {
        fbGoals.forEach(g => goals.push(g));
        fallbackGoalHeuristicUsed = true;
      }
    }
    // Secondary broader pass: any sentence containing the token 'goal' (e.g. 'ultimate goal is ...')
    if (goals.length === 0) {
      const broadCandidates = [];
      const allSections = Object.keys(sections);
      allSections.forEach(sec => {
        (sections[sec] || []).forEach(line => {
          if (/goal/i.test(line)) {
            // split into sentences to isolate the goal clause
            const sentences = line.split(/(?<=[.!?])\s+/).filter(Boolean);
            sentences.forEach(s => { if (/goal/i.test(s)) broadCandidates.push(s.trim()); });
          }
        });
      });
      if (broadCandidates.length) {
        const broadGoals = extractGoals(broadCandidates);
        if (broadGoals.length) {
          broadGoals.forEach(g => goals.push(g));
          fallbackGoalHeuristicUsed = true;
        }
      }
    }
    // Tertiary pass: scan uncategorized lines for semantic goal phrases without the literal 'goal:' anchor
    if (goals.length === 0 && Array.isArray(sections.uncategorized)) {
      const semanticPatterns = /(ultimate goal|overall goal|primary objective|main objective|intended outcome|mission is to)/i;
      const semanticLines = [];
      (sections.uncategorized || []).forEach(line => {
        if (semanticPatterns.test(line)) {
          const sentences = line.split(/(?<=[.!?])\s+/).filter(Boolean);
          sentences.forEach(s=>{ if(semanticPatterns.test(s)) semanticLines.push(s.trim()); });
        }
      });
      if (semanticLines.length) {
        const semGoals = extractGoals(semanticLines);
        if (semGoals.length) {
          semGoals.forEach(g=>goals.push(g));
          fallbackGoalHeuristicUsed = true;
        }
      }
    }
  }
  // -----------------------------------------------------------------------------
  // Post-processing: enrich goals with description (prefer extended fullParagraph from extractor) & concise shortTitle
  if(goals.length){
    const allSectionLines = Object.values(sections).flat();
    goals.forEach(g => {
      const originalSentence = g.title; // keep as single-sentence canonical fragment
      const extended = g.fullParagraph && g.fullParagraph.length > originalSentence.length ? g.fullParagraph : originalSentence;
      g.description = extended;
      g.originalSentence = originalSentence;
      // Starter sanitation
      const starterRegex = /(The ultimate goal|The overall goal|The primary objective|Our goal|The goal|The objective)/i;
      if(!starterRegex.test(g.description.slice(0,160))){
        const match = g.description.match(starterRegex);
        if(match && match.index > 0){
          g.description = g.description.slice(match.index).trim();
        }
      }
      g.description = g.description.replace(/^as,\s+/i,'').replace(/^as\s+/i,'');
      // shortTitle purely from original sentence for stability
      const baseShort = originalSentence.length <= 140 ? originalSentence : originalSentence.split(/\s+/).slice(0,14).join(' ') + '…';
      if(baseShort && baseShort.length){
        g.shortTitle = baseShort;
      }
    });
  }

  // Legacy implementation field retained (alias of activities for now)
  const implementation = activities.map(a => ({ id: a.id.replace(/^A/,'I'), description: a.description, date: a.dueYear ? `${a.dueYear}-01-01` : null, target: null, achieved: null, source: a.source }));

  const monitoring = parseMonitoring(sections.Monitoring || []);
  const outreach = parseOutreach(sections.Outreach || []);
  const geographicAreas = parseGeography(sections.Geography || []);

  const goalCompleted = goals.filter(g=>g.status==='completed').length;
  const goalInProgress = goals.filter(g=>g.status==='in_progress').length;
  const goalPlanned = goals.filter(g=>g.status==='planned').length;
  const avgGoalConfidence = goals.length ? (goals.reduce((s,g)=>s+(g.confidence||0),0)/goals.length) : 0;

  const bmpCategoryCounts = (() => { const c={}; bmps.forEach(b=>{ c[b.category]=(c[b.category]||0)+1; }); return c; })();

  const summary = {
    totalGoals: goals.length,
    totalBMPs: bmps.length,
    totalActivities: activities.length,
    primaryGoals: goals.filter(g=>g.isPrimary).length,
    completionRate: goals.length ? goalCompleted / goals.length : 0,
    totalMetrics: monitoring.length,
    goalStatus: {
      completed: goalCompleted,
      inProgress: goalInProgress,
      planned: goalPlanned,
      pctCompleted: goals.length ? goalCompleted/goals.length : 0,
      pctInProgress: goals.length ? goalInProgress/goals.length : 0,
      pctPlanned: goals.length ? goalPlanned/goals.length : 0
    },
    bmpCategories: bmpCategoryCounts,
    avgGoalConfidence,
    strongGoals: goals.filter(g=> (g.confidence||0) >= 0.7).length
  };

  return finalizeReport(goals, sections, sourceId, sourceFile, fallbackGoalHeuristicUsed, costArtifacts);
}
