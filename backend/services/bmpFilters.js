// Heuristic BMP filtering utilities (non-destructive: returns filtered + rejected arrays)
// Activated via env flag BMP_FILTER=1 when integrated.

const ACTION_KEYWORDS = /(install|construct|stabilize|restore|plant|exclude|fence|retrofit|diversion|sediment|basin|buffer|pond|weir|seeding|tillage|cover crop|nutrient management|wetland|bioswale|rain garden|grassed waterway|filter strip|critical area planting|manager|implementation|monitor)/i;
const START_DISCARD = /^(total( estimated)? cost|budget|the budget|september|october|november|december|january|february|march|april|may|june|july|august|q[1-4]\b|\d{1,2}\/\d{1,2}\/\d{2,4})/i;
const COST_ONLY = /^(total|amount|estimated cost|cost estimate|total estimated cost)$/i;
const SCHEDULE_FRAGMENT = /months? \d+\s*-\s*\d+$/i;
const PHASE_TOKEN = /\b(phase|year)\s*\d{1,2}\b/i;
const TIME_RANGE = /\b(20\d{2}\s*-\s*20\d{2})\b/;
const PERCENT_TOKEN = /\b\d{1,3}%\b/;
const VERBISH = /(install|construct|stabilize|plant|exclude|fence|retrofit|implement|upgrade|repair|replace)/i;

export function filterBMPs(bmps){
  const filtered = [];
  const rejected = [];
  for(const b of bmps){
    const nameRaw = (b.name||'').trim();
    const lower = nameRaw.toLowerCase();
    const tokens = lower.split(/\s+/).filter(Boolean);
    const tokenCount = tokens.length;
    const actionLike = ACTION_KEYWORDS.test(lower) || VERBISH.test(lower);
    const flags = {
      startsBad: START_DISCARD.test(lower),
      scheduleFragment: SCHEDULE_FRAGMENT.test(lower),
      costContext: (COST_ONLY.test(lower) || (/\b(cost|budget|amount|estimated|dollars?)\b/i.test(lower) && !actionLike)),
      numericPunctHeavy: (nameRaw.replace(/[a-z]/gi,'').length / Math.max(1,nameRaw.length)) > 0.65,
      tooShort: tokenCount < 2,
      tooLong: tokenCount > 30 && !actionLike,
      looksHeader: /^[A-Z ]{6,}$/.test(nameRaw) && !actionLike,
      phaseToken: PHASE_TOKEN.test(lower),
      timeRange: TIME_RANGE.test(lower),
      percentToken: PERCENT_TOKEN.test(lower)
    };
    // Derived categories
    flags.metaOnly = (flags.phaseToken || flags.timeRange) && !actionLike && tokenCount < 8;
    flags.metricsOnly = flags.percentToken && !actionLike && tokenCount < 6;

    const reject = Object.values(flags).some(Boolean) && !actionLike && !(flags.percentToken && actionLike);

    if(reject){
      const reasons = classifyReasons(flags);
      const confidence = scoreConfidence(flags, actionLike, tokenCount);
      rejected.push({ ...b, rejectReasons: reasons, rejectPrimary: reasons[0], rejectFlags: flags, confidence });
    } else {
      filtered.push({ ...b, filterConfidence: scoreRetentionConfidence(nameRaw, actionLike, tokenCount) });
    }
  }
  return { filtered, rejected };
}

function classifyReasons(f){
  const reasons = [];
  if(f.startsBad) reasons.push('starts_bad_token');
  if(f.scheduleFragment) reasons.push('schedule_fragment');
  if(f.costContext) reasons.push('cost_context');
  if(f.numericPunctHeavy) reasons.push('numeric_punct_heavy');
  if(f.tooShort) reasons.push('too_short');
  if(f.tooLong) reasons.push('too_long');
  if(f.looksHeader) reasons.push('header_case');
  if(f.phaseToken) reasons.push('phase_token');
  if(f.timeRange) reasons.push('time_range');
  if(f.metaOnly) reasons.push('meta_only');
  if(f.metricsOnly) reasons.push('metrics_only');
  if(!reasons.length) reasons.push('generic');
  return reasons;
}

function scoreConfidence(flags, actionLike, tokenCount){
  let score = 0;
  if(flags.startsBad) score += 2.5;
  if(flags.costContext) score += 2;
  if(flags.scheduleFragment) score += 1.5;
  if(flags.numericPunctHeavy) score += 1.2;
  if(flags.looksHeader) score += 1.2;
  if(flags.tooShort) score += 1.5;
  if(flags.tooLong) score += 1.0;
  if(flags.phaseToken) score += 0.8;
  if(flags.timeRange) score += 0.8;
  if(flags.metaOnly) score += 0.7;
  if(flags.metricsOnly) score += 0.7;
  if(actionLike) score -= 1.0; // penalize rejecting something action-like
  // Normalize
  return Number(Math.max(0, Math.min(10, score)).toFixed(2));
}

function scoreRetentionConfidence(text, actionLike, tokenCount){
  let score = 3;
  if(actionLike) score += 3;
  if(tokenCount >= 3 && tokenCount <= 14) score += 2;
  if(/\b(fencing|structure|stabilization|planting|weir|basin|buffer|wetland|diversion|waterway|seeding)\b/i.test(text)) score += 1.5;
  return Number(Math.max(0, Math.min(10, score)).toFixed(2));
}
