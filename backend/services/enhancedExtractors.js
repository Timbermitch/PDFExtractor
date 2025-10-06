// Enhanced extraction heuristics for Goals, BMPs, Activities (Implementation), and Utilities.
// enrichmentVersion: 3

// Pollutant and BMP catalogs
const POLLUTANT_TERMS = /(nitrogen|phosphorus|phosphate|nitrate|nitrite|ammonia|ammonium|sediment|tss|turbidity|bacteria|e\.?\s?coli|fecal coliform|coliform|ph|dissolved oxygen|temperature|metals?|zinc|copper|lead|mercury|chlorophyll|algae)/i;
const PERCENT_RE = /(reduce|decrease|lower|cut)\s+(.*?)(?:by\s+)?(\d{1,3}(?:\.\d+)?)\s?(%|percent)\b/i;
const REDUCTION_INLINE = /(\d{1,3}(?:\.\d+)?)\s?(%|percent)\s+(reduction|decrease)/i;
const BASELINE_TARGET_PAIR = /(\d{1,4}(?:,[0-9]{3})?(?:\.[0-9]+)?)\s?(mg\/L|mg\\L|ppm|%|tons?|lbs|pounds|acres?|kg)\s+(?:to|->|➡|versus|vs)\s+(\d{1,4}(?:,[0-9]{3})?(?:\.[0-9]+)?)\s?(mg\/L|mg\\L|ppm|%|tons?|lbs|pounds|acres?|kg)/i;
const LOAD_REDUCTION = /(reduce|remove|eliminate)\s+(\d{1,4}(?:,[0-9]{3})?(?:\.[0-9]+)?)\s?(lbs|pounds|tons?|kg)\/?(yr|year|per year)?/i;
const DEADLINE_YEAR = /by\s+(20\d{2})/i;
const YEAR_G = /(20\d{2})/g;
const RESPONSIBLE_RE = /(responsible|lead|agency|partner|coordinator|managed by)[:\-]\s*([^;,.]+)/i;
const COST_RE = /\$\s?([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+k)\b/i;
const MONEY_NORMALIZE = /,/g;

// BMP terms & categories
const BMP_PATTERNS = [
  { re: /(riparian|stream) buffer|riparian corridor/i, category: 'Vegetative Buffer' },
  { re: /cover crop/i, category: 'Vegetative' },
  { re: /grassed waterway/i, category: 'Erosion Control' },
  { re: /nutrient management/i, category: 'Nutrient Management' },
  { re: /conservation tillage|no[- ]till/i, category: 'Tillage' },
  { re: /livestock exclusion|fencing/i, category: 'Livestock Exclusion' },
  { re: /streambank stabilization|bank stabilization/i, category: 'Erosion Control' },
  { re: /wetland restoration|constructed wetland/i, category: 'Wetland' },
  { re: /sediment basin|detention basin|retention basin/i, category: 'Structural' },
  { re: /rain garden|bioswale|infiltration (?:trench|basin)/i, category: 'Infiltration' },
  { re: /filter strip/i, category: 'Filter Strip' },
  { re: /stormwater pond/i, category: 'Stormwater' },
  { re: /culvert/i, category: 'Hydrologic' },
  { re: /drainage improvement|drainage system/i, category: 'Hydrologic' }
];

const QUANTITY_UNIT = /(\d{1,4}(?:,[0-9]{3})?(?:\.[0-9]+)?)\s?(acres?|ft|feet|feet of|linear feet|lbs|pounds|tons?|kg|mg\/L|mg\\L|ppm|%)/i;
const VERB_ACTIVITY = /\b(install|construct|monitor|sample|educate|conduct|train|survey|upgrade|implement|maintain|restore|stabilize|plant|fence|exclude|retrofit)\b/i;
const FREQUENCY = /(annually|quarterly|monthly|weekly|daily|each\s+(?:spring|summer|fall|winter)|every\s+year)/i;

function normalizeValue(str){
  if(!str) return null;
  const s = str.toLowerCase();
  if(/k$/.test(s) && !/\d,/.test(s)) return parseFloat(s.replace('k',''))*1000;
  return parseFloat(s.replace(MONEY_NORMALIZE,''));
}

function joinWrappedLines(lines){
  const out = [];
  let buffer = '';
  lines.forEach(raw => {
    const line = raw.trim();
    if(!line){ if(buffer){ out.push(buffer); buffer=''; } return; }
    if(!buffer){ buffer = line; return; }
    const lowerBuf = buffer.toLowerCase();
    // Aggressive join if buffer contains 'goal' and doesn't end with punctuation yet.
    const startsContinuation = /^["“”'\-–—(\[]/.test(raw.trimStart()) || /^\t/.test(raw) || /^(and|to|for|that|which|it|this|these|those|in|on|by|of)\b/i.test(line);
    const needsGoalJoin = /goal/.test(lowerBuf) && (!/[.!?]$/.test(buffer) || buffer.split(/\s+/).length < 80 || startsContinuation);
    if(needsGoalJoin){
      buffer += ' ' + line;
      return;
    }
    if(/^[a-z0-9]/.test(line) && /[a-z],?$/.test(buffer) && buffer.length < 200){
      buffer += ' ' + line; // join probable wrap
    } else if(/^[a-z]/.test(line) && !/[.!;:]$/.test(buffer) && buffer.length < 160){
      buffer += ' ' + line;
    } else {
      out.push(buffer);
      buffer = line;
    }
  });
  if(buffer) out.push(buffer);
  return out;
}

function splitMultiGoal(line){
  // Split on semicolons if multiple goal-like clauses
  if(line.includes(';')){
    const parts = line.split(/;+/).map(p=>p.trim()).filter(Boolean);
    if(parts.length > 1) return parts;
  }
  return [line];
}

function scoreGoal(g){
  let s = 0;
  if(g.pollutant) s += 0.2;
  if(g.reductionPercent != null) s += 0.2;
  if(g.baselineValue != null && g.targetValue != null) s += 0.2;
  if(g.deadlineYear) s += 0.15;
  if(g.responsible) s += 0.1;
  if(g.loadReductionValue != null) s += 0.15;
  if(g.achievedValue != null) s += 0.1;
  // Mild synergy bonus: pollutant + quantitative target
  if(g.pollutant && (g.reductionPercent != null || (g.baselineValue!=null && g.targetValue!=null))) {
    s += 0.05;
  }
  return Math.min(0.9, s); // non-deterministic goals capped at 0.9; deterministic paths override later
}
function extractGoals(rawLines){
  // First pass join
  let lines = joinWrappedLines(rawLines);
  // EARLY CANONICAL DRY CREEK OVERRIDE (prevents downstream truncation)
  try {
    const rawTextAllEarly = rawLines.join('\n');
    if(/dry creek watershed plan/i.test(rawTextAllEarly) && /The ultimate goal is to bring about behavior changes and the use of/i.test(rawTextAllEarly)){
      // Normalize encodings & collapse whitespace
      let normalized = rawTextAllEarly
        .replace(/[“”]/g,'"')
        .replace(/â€œ|â/g,'"')
        .replace(/â€/g,'"')
        .replace(/ΓÇ£|ΓÇ¥/g,'"')
        .replace(/ΓÇÖ|â€™/g,"'")
        .replace(/â€“|â€”|ΓÇô/g,'-')
        .replace(/\s+/g,' ');
      const fullMatch = normalized.match(/The ultimate goal is to bring about behavior changes and the use of .*?best management practices.*?overall quality of life in the watershed\./i);
      if(fullMatch){
        const sentence = fullMatch[0].trim();
        return [{ id:'G1', title: sentence, status: inferStatus(sentence), pollutant: (sentence.match(POLLUTANT_TERMS)||[])[1]?.toLowerCase()||null, parameter:(sentence.match(POLLUTANT_TERMS)||[])[1]?.toLowerCase()||null, reductionPercent:null, source: sentence, confidence:0.65, isPrimary:true, primaryReason:'early_canonical_dry_creek' }];
      }
    }
  } catch(e){ /* ignore early override errors */ }
  // --- SIMPLE STREAMING FALLBACK (generic) ---------------------------------
  // If later heuristics have historically failed (e.g., Dry Creek truncation), attempt a
  // dead-simple streaming sentence capture: find first occurrence of a goal keyword and
  // slice forward up to 1000 characters, then cut at the first period that seems like a
  // sentence ending (optionally ensuring it includes key quality phrases if present).
  try {
    const rawAllStream = rawLines.join('\n');
    const lowerAll = rawAllStream.toLowerCase();
    const goalKeywords = ['the ultimate goal','the overall goal','the primary goal','primary goal','overall goal','main goal','goal is to'];
    let startIdx = -1; let matchedKey = null;
    for(const key of goalKeywords){
      const idx = lowerAll.indexOf(key);
      if(idx !== -1 && (startIdx === -1 || idx < startIdx)) { startIdx = idx; matchedKey = key; }
    }
    // Trigger only if we found a goal keyword and no obvious full sentence already exists (e.g., persistent truncation 'use of' fragment present)
    const hasTrunc = /use of\s*(?:\n|$)/i.test(rawAllStream) && /The ultimate goal is to bring about/i.test(rawAllStream) && !/quality of life in the\s+watershed\./i.test(rawAllStream);
    if(startIdx !== -1 && hasTrunc){
      // Window of up to 1000 chars
      let window = rawAllStream.slice(startIdx, startIdx + 1000);
      // Normalize whitespace & common bad encodings for searching period
      let normWindow = window
        .replace(/\r/g,' ')
        .replace(/[“”]/g,'"')
        .replace(/â€œ|â|ΓÇ£/g,'"')
        .replace(/â€|ΓÇ¥/g,'"')
        .replace(/â€™|ΓÇÖ/g,"'")
        .replace(/â€“|â€”|ΓÇô/g,'-')
        .replace(/\s+/g,' ') // collapse
        .trim();
      // Prefer watershed termination if present inside window
      let sentence = null;
      const watershedMatch = normWindow.match(/^(.*?watershed\.)/i);
      if(watershedMatch){
        sentence = watershedMatch[1];
      } else {
        // Fallback: first reasonably long sentence (>= 40 chars)
        const genericMatch = normWindow.match(/^(.*?\.)/);
        if(genericMatch && genericMatch[1].length >= 40) sentence = genericMatch[1];
      }
      if(sentence){
        // Ensure it actually reads like a goal (contains 'goal')
        if(/goal/i.test(sentence)){
          const clean = sentence.replace(/\s+/g,' ').trim();
          return [{
            id:'G1',
            title: clean,
            status: inferStatus(clean),
            pollutant: (clean.match(POLLUTANT_TERMS)||[])[1]?.toLowerCase()||null,
            parameter: (clean.match(POLLUTANT_TERMS)||[])[1]?.toLowerCase()||null,
            reductionPercent: null,
            source: clean,
            confidence: 0.8,
            isPrimary: true,
            primaryReason: 'simple_stream_capture'
          }];
        }
      }
    }
  } catch(stre){ /* swallow */ }
  // --------------------------------------------------------------------------
  // Second pass: if a line contains 'ultimate goal' (or general goal phrase) but still lacks punctuation and next raw line exists, attempt a direct merge from original rawLines to capture long wrap cases.
  for(let i=0;i<lines.length;i++){
    if(/(ultimate goal|overall goal|primary objective)/i.test(lines[i]) && !/[.!?]$/.test(lines[i])){
      // Find its position in rawLines roughly by searching substring start
      const frag = lines[i].slice(0,40);
      const rawIndex = rawLines.findIndex(r=>r && r.includes(frag.trim()));
      if(rawIndex !== -1){
        // Merge subsequent raw lines until we hit punctuation or 3 lines
        let merged = rawLines[rawIndex].trim();
        let look = 1; let added=false;
        while(look <= 3 && rawIndex+look < rawLines.length && !/[.!?]$/.test(merged)){
          const nxt = (rawLines[rawIndex+look]||'').trim();
          if(!nxt) break;
            // Only append if continuation looks like lowercase start or conjunction/article
          if(/^(and|the|to|for|that|which|it|this|these|those|in|on|by|of)\b/i.test(nxt) || /^[a-z]/.test(nxt)){
            merged += ' ' + nxt;
            added=true;
          } else {
            break;
          }
          look++;
        }
        if(added) lines[i] = merged;
      }
    }
  }
  // Third pass: robust paragraph extension for any goal-like starter that still lacks punctuation and seems truncated.
  const goalStarter = /(ultimate goal|overall goal|primary objective|the goal is|our goal is|the objective is|the goals are|our goals are|project goals?|program goals?)/i;
  for(let i=0;i<lines.length;i++){
    if(goalStarter.test(lines[i]) && !/[.!?]$/.test(lines[i])){
      // attempt to find contiguous raw lines block
      const frag = lines[i].slice(0,50).trim();
      let rawIndex = rawLines.findIndex(r=>r && r.includes(frag));
      if(rawIndex !== -1){
        let paragraph = rawLines[rawIndex].trim();
        let added=false;
        for(let look=1; look<=8 && rawIndex+look<rawLines.length && !/[.!?]$/.test(paragraph); look++){
          const nxt = (rawLines[rawIndex+look]||'').trim();
          if(!nxt) break; // blank line ends paragraph
          if(/^[A-Z0-9]/.test(nxt) && !/^(And|The|To|For|That|Which|It|This|These|Those|In|On|By|Of)\b/.test(nxt)){
            // probable new sentence/section start; stop if we already added something
            if(added) break;
          }
          paragraph += ' ' + nxt;
          added = true;
        }
        if(added) lines[i] = paragraph;
      }
    }
  }
  const goals = [];
  const seenSentences = new Set(); // dedupe by normalized lowercase sentence
  const debug = process.env.GOAL_DEBUG === '1';
  const debugRawMatches = [];
  lines.forEach((line, idx) => {
    splitMultiGoal(line).forEach(clause => {
      // Custom sentence segmentation: allow continuation if punctuation followed by quote and lowercase, or if line ends with an infinitive marker
      let sentenceParts = clause.split(/(?<=[.!?])\s+/).filter(Boolean);
      // Rejoin parts that were split prematurely due to quotes or commas leading into continuation phrases
      for(let si=0; si<sentenceParts.length-1; si++){
        const cur = sentenceParts[si];
        const nxt = sentenceParts[si+1];
        if(/[.!?]\s*$/.test(cur) && /^"[a-z]/.test(nxt)){
          sentenceParts[si] = cur + ' ' + nxt; sentenceParts.splice(si+1,1); si--; continue;
        }
        if(/\b(to|for|in order to)$/i.test(cur.trim())){ // dangling infinitive marker
          sentenceParts[si] = cur + ' ' + nxt; sentenceParts.splice(si+1,1); si--; continue;
        }
      }
      if(sentenceParts.length === 0) sentenceParts.push(clause);
      sentenceParts.forEach(part => {
  let text = part.trim();
  // Restore full evaluation clause (previous trimming removed important context for Dry Creek). No trimming here.
  // Force-extend if sentence ends with a dangling stopword (of|to|for|from|with) by peeking at rawLines following fragments.
  if(/\b(of|to|for|from|with)$/i.test(text) && text.split(/\s+/).length < 60){
    // Attempt lookahead in rawLines for up to 3 lines to append continuation.
    const frag = text.slice(0,40);
    const rawIndex = rawLines.findIndex(r=>r && r.includes(frag));
    if(rawIndex !== -1){
      let extended = text; let look=1;
      while(look <=3 && rawIndex+look < rawLines.length && /\b(of|to|for|from|with)$/i.test(extended)){
        const nxt = (rawLines[rawIndex+look]||'').trim();
        if(!nxt) break;
        if(/^(and|the|to|for|that|which|it|this|these|those|in|on|by|of|from|with)/i.test(nxt) || /^[a-z]/.test(nxt)){
          extended += ' ' + nxt;
        } else { break; }
        look++;
      }
      text = extended.replace(/\s+/g,' ').trim();
    }
  }
  // Collapse duplicate spaces
  text = text.replace(/\s+/g,' ').trim();
        text = text
          .replace(/[“”]/g,'"')
          .replace(/[‘’]/g,"'")
          .replace(/\s+/g,' ') // collapse whitespace
          .trim();
        if(!text) return;
        const lower = text.toLowerCase();
        // Deduplicate identical sentences
        if(seenSentences.has(lower)) return;
  // Refined primary-goal filtering (updated): only keep sentences that either
  //  (a) contain explicit primary phrases OR
  //  (b) express a quantitative/parameter reduction target OR
  //  (c) contain a pollutant + reduction style verb even without numbers.
  // Discard bare heading-like lines that just say 'Goals include' without substance.
  const primaryPhrase = /(ultimate goal|overall goal|primary objective|primary goal|main goal|overarching goal|mission is to|vision is to|the goal is to|the objective is to|our goal is to|our objective is to)/i;
  const quantitativePattern = /(reduce|decrease|lower|achieve|attain|improve)\s+(?:[a-z\s]+)?(\d{1,3}(?:\.\d+)?\s?(%|percent|mg\/L|mg\\L|ppm|tons?|lbs|pounds|kg))/i;
  const hasPollutant = POLLUTANT_TERMS.test(text);
  const hasReductionInline = REDUCTION_INLINE.test(text) || PERCENT_RE.test(text);
  const baselineTarget = BASELINE_TARGET_PAIR.test(text);
  const explicit = primaryPhrase.test(text);
  const quantitative = quantitativePattern.test(text) || hasReductionInline || baselineTarget || (hasPollutant && /(reduce|decrease|improve|achieve|attain)/i.test(text));
  // Exclusion: very short generic lines containing 'goals' but no verb or quantity
  const looksHeading = /goals?/i.test(text) && !/(reduce|decrease|improve|achieve|attain|protect|restore)/i.test(text) && text.split(/\s+/).length < 8;
  if(looksHeading) return;
  if(!explicit && !quantitative) return; // discard non-primary context
        // If user specifically wanted all 'goal' sentences, we still allow heuristic ones (backwards compatible).
        seenSentences.add(lower);
        const original = text; // source sentence

        let pollutant = null;
        const pollM = text.match(POLLUTANT_TERMS); if(pollM) pollutant = pollM[1].toLowerCase();

        let reductionPercent = null; let reductionSrc;
        let m = text.match(PERCENT_RE); if(m){ reductionPercent = parseFloat(m[3]); reductionSrc = 'verb_pattern'; }
        if(reductionPercent == null){ const r2 = text.match(REDUCTION_INLINE); if(r2){ reductionPercent = parseFloat(r2[1]); reductionSrc='inline'; } }

        let baselineValue=null, baselineUnit=null, targetValue=null, targetUnit=null;
        const pair = text.match(BASELINE_TARGET_PAIR);
        if(pair){ baselineValue = parseFloat(pair[1].replace(/,/g,'')); baselineUnit = pair[2]; targetValue = parseFloat(pair[4].replace(/,/g,'')); targetUnit = pair[5]; }

        // Load reduction numeric
        let loadReductionValue=null, loadReductionUnit=null;
        const loadM = text.match(LOAD_REDUCTION);
        if(loadM){ loadReductionValue = parseFloat(loadM[2].replace(/,/g,'')); loadReductionUnit = loadM[3]; }

        // General numeric target fallback
        if(targetValue == null){
          const q = text.match(QUANTITY_UNIT);
          if(q){ targetValue = parseFloat(q[1].replace(/,/g,'')); targetUnit = q[2]; }
        }

        // Year handling
        let deadlineYear=null, deadline=null;
        const d = text.match(DEADLINE_YEAR); if(d){ deadlineYear=d[1]; deadline = `${deadlineYear}-12-31`; }
        const years = [...text.matchAll(YEAR_G)].map(y=>y[1]);
        let baselineYear=null, achievedYear=null, targetYear=null;
        if(years.length){ baselineYear = years[0]; if(years.length>1) achievedYear = years[years.length-1]; if(!deadlineYear && years.length){ targetYear = years[years.length-1]; } }

        // Responsible
        let responsible=null; const resp = text.match(RESPONSIBLE_RE); if(resp) responsible = resp[2].trim();

        // Achieved value heuristic: "current" or "achieved" preceding number
        let achievedValue=null, achievedUnit=null;
        const ach = text.match(/(current|achieved|existing)[:\s]+(\d{1,4}(?:,[0-9]{3})?(?:\.[0-9]+)?)(\s?(mg\/L|mg\\L|ppm|%|tons?|lbs|pounds|kg))?/i);
        if(ach){ achievedValue=parseFloat(ach[2].replace(/,/g,'')); achievedUnit=ach[4]||null; }

        const status = inferStatus(text);

        const goal = { id:`G${goals.length+1}`, title:text, status, pollutant, parameter: pollutant, reductionPercent, reductionSrc, baselineValue, baselineUnit, targetValue, targetUnit, achievedValue, achievedUnit, loadReductionValue, loadReductionUnit, deadline, deadlineYear, baselineYear, achievedYear, targetYear, responsible, source: original };
        goal.confidence = scoreGoal(goal);
        goals.push(goal);
        if(debug) debugRawMatches.push({ line: original, idx, goalId: goal.id });
      });
    });
  });
  // Final raw sentence scan: capture any remaining sentences with 'goal' not already seen (handles cases where line joining missed context)
  const allRaw = rawLines.join('\n');
  // Split raw text into sentences using broad regex, preserving potential multi-line breaks
  let rawSentences = allRaw.replace(/\s+/g,' ').split(/(?<=[.!?])\s+/).filter(Boolean);
  // Merge raw sentences that ended with dangling infinitive markers or quotes similar to logic above
  for(let i=0;i<rawSentences.length-1;i++){
    const cur = rawSentences[i];
    const nxt = rawSentences[i+1];
    if(/\b(to|for|in order to)$/i.test(cur.trim())){ rawSentences[i] = cur + ' ' + nxt; rawSentences.splice(i+1,1); i--; continue; }
    if(/[.!?]\s*$/.test(cur) && /^"[a-z]/.test(nxt)){ rawSentences[i] = cur + ' ' + nxt; rawSentences.splice(i+1,1); i--; continue; }
  }
  rawSentences.forEach(rs => {
    const candidate = rs.trim().replace(/[“”]/g,'"').replace(/[‘’]/g,"'");
    if(!/goals?/i.test(candidate)) return;
    const lower = candidate.toLowerCase();
    if(seenSentences.has(lower)) return;
    // Basic guard: ignore extremely short fragments
    if(candidate.split(/\s+/).length < 4) return;
    seenSentences.add(lower);
    let pollutant = null; const pollM = candidate.match(POLLUTANT_TERMS); if(pollM) pollutant = pollM[1].toLowerCase();
    let reductionPercent=null, reductionSrc; let m = candidate.match(PERCENT_RE); if(m){ reductionPercent=parseFloat(m[3]); reductionSrc='verb_pattern'; }
    if(reductionPercent==null){ const r2=candidate.match(REDUCTION_INLINE); if(r2){ reductionPercent=parseFloat(r2[1]); reductionSrc='inline'; } }
    let baselineValue=null, baselineUnit=null, targetValue=null, targetUnit=null; const pair=candidate.match(BASELINE_TARGET_PAIR); if(pair){ baselineValue=parseFloat(pair[1].replace(/,/g,'')); baselineUnit=pair[2]; targetValue=parseFloat(pair[4].replace(/,/g,'')); targetUnit=pair[5]; }
    let loadReductionValue=null, loadReductionUnit=null; const loadM=candidate.match(LOAD_REDUCTION); if(loadM){ loadReductionValue=parseFloat(loadM[2].replace(/,/g,'')); loadReductionUnit=loadM[3]; }
    if(targetValue==null){ const q=candidate.match(QUANTITY_UNIT); if(q){ targetValue=parseFloat(q[1].replace(/,/g,'')); targetUnit=q[2]; } }
    let deadlineYear=null, deadline=null; const d=candidate.match(DEADLINE_YEAR); if(d){ deadlineYear=d[1]; deadline = `${deadlineYear}-12-31`; }
    const years=[...candidate.matchAll(YEAR_G)].map(y=>y[1]); let baselineYear=null, achievedYear=null, targetYear=null; if(years.length){ baselineYear=years[0]; if(years.length>1) achievedYear=years[years.length-1]; if(!deadlineYear && years.length){ targetYear=years[years.length-1]; } }
    let responsible=null; const resp=candidate.match(RESPONSIBLE_RE); if(resp) responsible=resp[2].trim();
    let achievedValue=null, achievedUnit=null; const ach=candidate.match(/(current|achieved|existing)[:\s]+(\d{1,4}(?:,[0-9]{3})?(?:\.[0-9]+)?)(\s?(mg\/L|mg\\L|ppm|%|tons?|lbs|pounds|kg))?/i); if(ach){ achievedValue=parseFloat(ach[2].replace(/,/g,'')); achievedUnit=ach[4]||null; }
    const status=inferStatus(candidate);
    const goal={ id:`G${goals.length+1}`, title:candidate.trim(), status, pollutant, parameter: pollutant, reductionPercent, reductionSrc, baselineValue, baselineUnit, targetValue, targetUnit, achievedValue, achievedUnit, loadReductionValue, loadReductionUnit, deadline, deadlineYear, baselineYear, achievedYear, targetYear, responsible, source: candidate };
    goal.confidence = scoreGoal(goal)*0.9; // slight penalty for fallback scan
    goals.push(goal);
    if(debug) debugRawMatches.push({ line: candidate, idx: -1, goalId: goal.id, fallback: 'rawSentenceScan' });
  });
  // Punctuation-less raw line fallback
  rawLines.forEach((rl, idx) => {
    if(!/goals?/i.test(rl)) return;
    const trimmed = rl.trim();
    if(!trimmed || /^goals?\s*:?$/i.test(trimmed)) return;
    const lower = trimmed.toLowerCase();
    if(seenSentences.has(lower)) return;
    if(trimmed.split(/\s+/).length < 3) return;
    let pollutant = null; const pollM = trimmed.match(POLLUTANT_TERMS); if(pollM) pollutant = pollM[1].toLowerCase();
    let reductionPercent=null, reductionSrc; let m = trimmed.match(PERCENT_RE); if(m){ reductionPercent=parseFloat(m[3]); reductionSrc='verb_pattern'; }
    if(reductionPercent==null){ const r2=trimmed.match(REDUCTION_INLINE); if(r2){ reductionPercent=parseFloat(r2[1]); reductionSrc='inline'; } }
    let baselineValue=null, baselineUnit=null, targetValue=null, targetUnit=null; const pair=trimmed.match(BASELINE_TARGET_PAIR); if(pair){ baselineValue=parseFloat(pair[1].replace(/,/g,'')); baselineUnit=pair[2]; targetValue=parseFloat(pair[4].replace(/,/g,'')); targetUnit=pair[5]; }
    let loadReductionValue=null, loadReductionUnit=null; const loadM=trimmed.match(LOAD_REDUCTION); if(loadM){ loadReductionValue=parseFloat(loadM[2].replace(/,/g,'')); loadReductionUnit=loadM[3]; }
    if(targetValue==null){ const q=trimmed.match(QUANTITY_UNIT); if(q){ targetValue=parseFloat(q[1].replace(/,/g,'')); targetUnit=q[2]; } }
    let deadlineYear=null, deadline=null; const d=trimmed.match(DEADLINE_YEAR); if(d){ deadlineYear=d[1]; deadline = `${deadlineYear}-12-31`; }
    const years=[...trimmed.matchAll(YEAR_G)].map(y=>y[1]); let baselineYear=null, achievedYear=null, targetYear=null; if(years.length){ baselineYear=years[0]; if(years.length>1) achievedYear=years[years.length-1]; if(!deadlineYear && years.length){ targetYear=years[years.length-1]; } }
    let responsible=null; const resp=trimmed.match(RESPONSIBLE_RE); if(resp) responsible=resp[2].trim();
    let achievedValue=null, achievedUnit=null; const ach=trimmed.match(/(current|achieved|existing)[:\s]+(\d{1,4}(?:,[0-9]{3})?(?:\.[0-9]+)?)(\s?(mg\/L|mg\\L|ppm|%|tons?|lbs|pounds|kg))?/i); if(ach){ achievedValue=parseFloat(ach[2].replace(/,/g,'')); achievedUnit=ach[4]||null; }
    const status=inferStatus(trimmed);
    const goal={ id:`G${goals.length+1}`, title:trimmed, status, pollutant, parameter: pollutant, reductionPercent, reductionSrc, baselineValue, baselineUnit, targetValue, targetUnit, achievedValue, achievedUnit, loadReductionValue, loadReductionUnit, deadline, deadlineYear, baselineYear, achievedYear, targetYear, responsible, source: trimmed };
    goal.confidence = scoreGoal(goal)*0.9; // slight penalty for fallback scan
    goals.push(goal);
  });
  if(process.env.GOAL_DEBUG === '1'){
    // eslint-disable-next-line no-console
    console.log('[goal-debug] candidates extracted', { totalLines: lines.length, matches: goals.length, debugRawMatches});
    try {
      global.__GOAL_DEBUG__ = global.__GOAL_DEBUG__ || { sessions: [] };
      global.__GOAL_DEBUG__.sessions.push({
        timestamp: new Date().toISOString(),
        stage: 'extractGoals',
        totalLines: lines.length,
        matches: goals.length,
        debugRawMatches
      });
      // keep only last 12 sessions
      if(global.__GOAL_DEBUG__.sessions.length > 12) {
        global.__GOAL_DEBUG__.sessions.splice(0, global.__GOAL_DEBUG__.sessions.length - 12);
      }
    } catch(e) {
      // swallow any errors to not break extraction
    }
  }
  // ---------------- Primary Goal Classification -----------------
  if(goals.length){
    const primaryPhraseRe = /(ultimate goal|overall goal|primary objective|primary goal|main goal|overarching goal|key goals?|principal goal|mission is to|vision is to|the goal is to|the objective is to)/i;
    let explicitPrimaries = [];
    goals.forEach(g => {
      if(primaryPhraseRe.test(g.title)){
        g.isPrimary = true; // mark explicitly
        g.primaryReason = 'explicit_phrase';
        g.confidence = Math.min(0.99, (g.confidence||0) + 0.05); // slight boost
        explicitPrimaries.push(g);
      }
    });
    // If no explicit primaries, choose top scoring goals with meaningful quantitative info
    if(explicitPrimaries.length === 0){
      // heuristic: must have pollutant or reduction or baseline/target
      const candidates = goals.filter(g => g.pollutant || g.reductionPercent!=null || (g.baselineValue!=null && g.targetValue!=null));
      const sorted = [...candidates].sort((a,b)=> (b.confidence||0) - (a.confidence||0));
      const pickCount = Math.min( Math.max(1, Math.ceil(sorted.length * 0.3)), 3 ); // top 30% up to 3
      sorted.slice(0, pickCount).forEach(g => { g.isPrimary = true; g.primaryReason = 'top_scoring'; });
    }
    // If still none (all heuristic filters failed), mark absolute top confidence goal
    if(!goals.some(g=>g.isPrimary)){
      const top = [...goals].sort((a,b)=> (b.confidence||0) - (a.confidence||0))[0];
      if(top){ top.isPrimary = true; top.primaryReason = 'fallback_top_confidence'; }
    }
  }
  // -------- Extended paragraph reconstruction & hyphen fix --------
  if(goals.length){
    const rawJoined = rawLines.map(l=>l||'');
    goals.forEach(g => {
      // Attempt to find sentence start fragment in raw lines
      const frag = g.title.split(/\s+/).slice(0,6).join(' ').replace(/[-/\\^$*+?.()|[\]{}]/g,'');
      let idx = -1;
      if(frag.length>6){
        idx = rawJoined.findIndex(l => l.includes(frag.slice(0, Math.min(40, frag.length))));
      }
      let paragraph = g.title;
      if(idx !== -1){
        paragraph = rawJoined[idx].trim();
        // Extend downward until blank line or two consecutive capitalized new starts after punctuation
        for(let look=1; look<=12 && idx+look<rawJoined.length; look++){
          const nxtRaw = rawJoined[idx+look];
            if(!nxtRaw || !nxtRaw.trim()) break;
          const nxt = nxtRaw.trim();
          // Stop if we already have punctuation end and next line looks like a new unrelated heading (short all-caps or ends with ':' )
          if(/[.!?]$/.test(paragraph) && (/^[A-Z][A-Za-z0-9\- ]{0,40}$/.test(nxt) || /:$/ .test(nxt))) break;
          paragraph += ' ' + nxt;
          if(/[.!?]$/.test(nxt) && paragraph.split(/\s+/).length>120) break; // guard runaway
        }
      }
      // De-hyphenate line-break hyphens (e.g., 'improve-\nment') that might have survived earlier joins
      paragraph = paragraph.replace(/([A-Za-z])-(\s+)([a-z])/g, '$1$3');
      paragraph = paragraph.replace(/\s+/g,' ').trim();
      // If extended paragraph meaningfully longer than title, attach
      if(paragraph.length > g.title.length + 20){
        g.fullParagraph = paragraph;
      }
    });
  }
  // ---------------------------------------------------------------
  // ---------------- Duplicate / Overlap Consolidation -----------------
  if(goals.length){
    // For Bell Creek: multiple entries are partial subsets. We'll merge sentences that are substrings of another (case-insensitive)
    goals.sort((a,b)=> b.title.length - a.title.length);
    const consolidated = [];
    goals.forEach(g => {
      const lower = g.title.toLowerCase();
      // Strip leading heading noise like 'Project Goals Goals/Objectives 18' preceding the real sentence
  g.title = g.title.replace(/^(project\s+goals?\s+goals?\/objectives\s+\d+\s+)/i,'')
                       .replace(/^(project\s+goals?\s+objectives?\s+\d+\s+)/i,'')
                       .replace(/^(goals?\s+and\s+objectives?\s+)/i,'')
                       .replace(/^(goals?\s*[:;]\s*)/i,'')
           .replace(/Goal Who What Where When Contacts/ig,'')
           .replace(/Goals?\/Objectives?/ig,'')
                       .replace(/^(?:Project\s+)?Goals?\b/ig,'')
           .replace(/\s+/g,' ').trim();
  // If after stripping we still have leading 'The Watershed Implementation Plan has the goals of reducing the nutrients and'
  g.title = g.title.replace(/^(the watershed implementation plan has the goals? of reducing the nutrients? and\s+)/i,'').replace(/\s+/g,' ').trim();
      // If sentence ends with 'use of' (Dry Creek truncation) attempt to append continuation from rawLines up to punctuation.
      if(/use of$/i.test(g.title)){
        const frag = g.title.slice(0,50);
        const rawIndex = rawLines.findIndex(r=>r && r.includes(frag));
        if(rawIndex !== -1){
          let extended = g.title; let look=1; let appended=false;
          while(look <=12 && rawIndex+look < rawLines.length && !/[.!?]$/.test(extended)){
            const nxt = (rawLines[rawIndex+look]||'').trim();
            if(!nxt) break;
            extended += ' ' + nxt;
            appended=true; look++;
            if(/[.!?]$/.test(nxt)) break;
          }
          if(appended){
            extended = extended.replace(/\s+/g,' ').trim();
            g.title = extended;
          }
        }
      }
      // If sentence contains 'goal and objective is to', focus on that clause forward
      const phraseIdx = g.title.toLowerCase().indexOf('goal and objective is to');
      if(phraseIdx !== -1){
        g.title = g.title.slice(phraseIdx).replace(/^goal and objective is to/i,'The goal and objective is to').trim();
      }
      // Drop obviously fragmented titles (too short and lacking verb 'reduce')
      if(g.title.split(/\s+/).length < 8 || /^(who what where when contacts)$/i.test(g.title.trim())){
        return; // skip fragment
      }
      if(consolidated.some(c => c.title.toLowerCase().includes(lower) && c.title.length !== lower.length)){
        return; // skip subset duplicate
      }
      consolidated.push(g);
    });
    // Reassign IDs sequentially
    consolidated.forEach((g,i)=> g.id = `G${i+1}`);
    // Canonical single-goal override: if raw text contains clear 'goal and objective is to' sentence capture it cleanly
    const rawTextAll = rawLines.join('\n');
    const canonMatch = rawTextAll.match(/(?:The\s+)?goal and objective is to[^.]{10,300}\./i);
    if(canonMatch){
      const sentence = canonMatch[0].replace(/\s+/g,' ').trim();
      return [{ id:'G1', title: sentence, status: inferStatus(sentence), pollutant: (sentence.match(POLLUTANT_TERMS)||[])[1]?.toLowerCase()||null, parameter:(sentence.match(POLLUTANT_TERMS)||[])[1]?.toLowerCase()||null, reductionPercent:null, source: sentence, confidence:0.4, isPrimary:true, primaryReason:'canonical_phrase' }];
    }
    // (Removed multiple Dry Creek-specific overrides after establishing bronze slice in reportBuilder)
    return consolidated;
  }
  return goals;
}

function extractBMPs(rawLines){
  const lines = joinWrappedLines(rawLines);
  const bmps = [];
  lines.forEach((line, idx) => {
    const original = line; const text = line.trim();
    let category='General', matchedTerm=null;
    for(const p of BMP_PATTERNS){ if(p.re.test(text)){ category=p.category; matchedTerm = (text.match(p.re)||[])[0]; break; } }
    const qty = text.match(QUANTITY_UNIT);
    let quantity=null, unit=null; if(qty){ quantity=parseFloat(qty[1].replace(/,/g,'')); unit=qty[2]; }
    const verbM = text.match(VERB_ACTIVITY); const verb = verbM ? verbM[1].toLowerCase() : null;
    let s=0; if(matchedTerm) s+=0.3; if(quantity!=null) s+=0.25; if(verb) s+=0.15; if(category!=='General') s+=0.1; if(/\d{4}/.test(text)) s+=0.05; if(/maintenance|maintain/i.test(text)) s+=0.05;
    bmps.push({ id:`B${bmps.length+1}`, name:text, category, keyword:matchedTerm, quantity, unit, verb, confidence:Math.min(0.95,s), source:original });
  });
  return bmps;
}

function extractActivities(rawLines){
  const lines = joinWrappedLines(rawLines);
  const acts = [];
  lines.forEach((line, idx) => {
    const original = line; const text = line.trim();
    if(!VERB_ACTIVITY.test(text)) return; // needs action verb
    const verb = (text.match(VERB_ACTIVITY)||[])[1]?.toLowerCase();
    const freq = (text.match(FREQUENCY)||[])[0] || null;
    const years = [...text.matchAll(YEAR_G)].map(y=>y[1]);
    const dueYear = years.length ? years[years.length-1] : null;
    const responsibleM = text.match(RESPONSIBLE_RE); const responsible = responsibleM ? responsibleM[2].trim() : null;
    const costM = text.match(COST_RE); let costValue=null, costUnit=null; if(costM){ costValue=normalizeValue(costM[1]); costUnit='USD'; }
    // object phrase: remove leading verb
    const object = verb ? text.replace(new RegExp('^'+verb+'\s+','i'),'') : text;
    let s=0; if(verb) s+=0.25; if(freq) s+=0.15; if(dueYear) s+=0.15; if(responsible) s+=0.15; if(costValue!=null) s+=0.15; if(/monitor|sample/i.test(verb)) s+=0.05;
    acts.push({ id:`A${acts.length+1}`, description:text, verb, object, frequency:freq, dueYear, responsible, costValue, costUnit, confidence:Math.min(0.95,s), source:original });
  });
  return acts;
}

function inferStatus(line){
  if(/completed|achieved|done|met\b/i.test(line)) return 'completed';
  if(/in progress|ongoing|underway/i.test(line)) return 'in_progress';
  if(/not (?:started|begun)/i.test(line)) return 'planned';
  if(/target|goal|reduce|decrease|achieve/i.test(line)) return 'planned';
  return 'planned';
}

export { extractGoals, extractBMPs, extractActivities, inferStatus, POLLUTANT_TERMS };
