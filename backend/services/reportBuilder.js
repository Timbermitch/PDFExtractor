// Transforms sectioned text into ExtractedReport structure with richer heuristics.

// Regex catalogs
const QUANTITY_RE = /(?<![A-Z0-9])([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)(?:\s?(kg|km|miles?|acres?|ha|percent|%|gallons?|mg\/L|cfs|tons?))?/i;
const TARGET_RE = /(target|goal)[:\s]+/i;
const ACHIEVED_RE = /(achieved|actual|current)[:\s]+/i;
const BMP_KEYWORDS = /(filter strip|buffer|detention basin|rain garden|bioswale|culvert|sediment trap|silt fence|stormwater pond|constructed wetland|drainage (?:improvement|system)|infiltration (?:trench|basin))/i;
const ACTIVITY_VERBS = /\b(install(ed)?|monitor(ing|ed)?|educate(d)?|train(ed)?|survey(ed)?|upgrade(d)?|implement(ed)?|maintain(ed)?)\b/i;

function clean(line){
  return line.replace(/^[\-*\d.\)\s]+/, '').trim();
}

function parseGoals(lines) {
  const goals = [];
  lines.forEach((line, idx) => {
    const original = line;
    line = clean(line);
    // Extract measurable target if present
    let targetValue = null; let unit = null;
    const q = line.match(QUANTITY_RE);
    if (q) { targetValue = parseFloat(q[1].replace(/,/g,'')); unit = q[2] || null; }
    goals.push({ id: `G${idx+1}`, title: line, status: inferStatus(line), targetValue, unit, source: original });
  });
  return goals;
}

function parseBMPs(lines) {
  const bmps = [];
  lines.forEach((line, idx) => {
    const original = line; line = clean(line);
    let category = inferBMPCategory(line);
    // attempt to identify BMP keyword phrase
    const m = line.match(BMP_KEYWORDS);
    const keyword = m ? m[0] : null;
    bmps.push({ id: `B${idx+1}`, name: line, category, keyword, source: original });
  });
  return bmps;
}

function parseImplementation(lines) {
  const impl = [];
  lines.forEach((line, idx) => {
    const original = line; line = clean(line);
    const date = inferDate(line);
    // extract target vs achieved pattern e.g. Target: 500 acres Achieved: 420 acres
    let target = null, achieved = null;
    if (TARGET_RE.test(line) || ACHIEVED_RE.test(line)) {
      const parts = line.split(/;|\|/);
      parts.forEach(p => {
        if (TARGET_RE.test(p)) {
          const m = p.replace(TARGET_RE,'').match(QUANTITY_RE); if (m) target = parseFloat(m[1].replace(/,/g,''));
        } else if (ACHIEVED_RE.test(p)) {
          const m = p.replace(ACHIEVED_RE,'').match(QUANTITY_RE); if (m) achieved = parseFloat(m[1].replace(/,/g,''));
        }
      });
    }
    impl.push({ id: `I${idx+1}`, description: line, date, target, achieved, source: original });
  });
  return impl;
}

function parseMonitoring(lines) {
  const metrics = [];
  lines.forEach((line, idx) => {
    const original = line; line = clean(line);
    const q = line.match(QUANTITY_RE);
    let value = null, unit = null;
    if (q) { value = parseFloat(q[1].replace(/,/g,'')); unit = q[2] || null; }
    metrics.push({ id: `M${idx+1}`, metric: line, value, unit, source: original });
  });
  return metrics;
}

function parseOutreach(lines) {
  return lines.map((line, idx) => ({ id: `O${idx+1}`, activity: clean(line), audience: inferAudience(line), source: line }));
}

function parseGeography(lines) {
  return lines.map((line, idx) => ({ id: `GA${idx+1}`, area: clean(line), source: line }));
}

function inferStatus(line) {
  if (/completed|achieved|done/i.test(line)) return 'completed';
  if (/in progress|ongoing/i.test(line)) return 'in_progress';
  return 'planned';
}
function inferBMPCategory(line) {
  if (/erosion|sediment/i.test(line)) return 'Erosion Control';
  if (/stormwater|runoff/i.test(line)) return 'Stormwater';
  return 'General';
}
function inferDate(line) {
  const m = line.match(/(20\d{2})/);
  return m ? `${m[1]}-01-01` : null;
}
function inferNumeric(line) {
  const m = line.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
}
function inferAudience(line) {
  if (/public|community/i.test(line)) return 'Community';
  if (/school|student/i.test(line)) return 'Education';
  return 'General';
}

export function buildStructuredReport(sections, options = {}) {
  const { sourceId = null, sourceFile = null } = options;
  const goals = parseGoals(sections.Goals || []);
  const bmps = parseBMPs(sections.BMPs || []);
  const implementation = parseImplementation(sections.Implementation || []);
  const monitoring = parseMonitoring(sections.Monitoring || []);
  const outreach = parseOutreach(sections.Outreach || []);
  const geographicAreas = parseGeography(sections.Geography || []);

  const summary = {
    totalGoals: goals.length,
    totalBMPs: bmps.length,
    completionRate: goals.length ? (goals.filter(g => g.status === 'completed').length / goals.length) : 0,
    totalActivities: implementation.length,
    totalMetrics: monitoring.length,
    goalStatus: (() => {
      const completed = goals.filter(g=>g.status==='completed').length;
      const inProgress = goals.filter(g=>g.status==='in_progress').length;
      const planned = goals.filter(g=>g.status==='planned').length;
      return {
        completed,
        inProgress,
        planned,
        pctCompleted: goals.length ? completed/goals.length : 0,
        pctInProgress: goals.length ? inProgress/goals.length : 0,
        pctPlanned: goals.length ? planned/goals.length : 0
      };
    })(),
    bmpCategories: (() => {
      const counts = {};
      bmps.forEach(b => { counts[b.category] = (counts[b.category]||0)+1; });
      return counts;
    })()
  };

  return {
    id: sourceId || null,
    summary,
    goals,
    bmps,
    implementation,
    monitoring,
    outreach,
    geographicAreas,
    generatedAt: new Date().toISOString(),
    metadata: { sourceId, sourceFile }
  };
}
