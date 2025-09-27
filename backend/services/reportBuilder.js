// Transforms sectioned text into ExtractedReport structure.
// Simple heuristics now; can be enhanced with NLP.

function parseGoals(lines) {
  return lines.map((line, idx) => ({ id: `G${idx+1}`, title: line, status: inferStatus(line) }));
}

function parseBMPs(lines) {
  return lines.map((line, idx) => ({ id: `B${idx+1}`, name: line, category: inferBMPCategory(line) }));
}

function parseImplementation(lines) {
  return lines.map((line, idx) => ({ id: `I${idx+1}`, description: line, date: inferDate(line) }));
}

function parseMonitoring(lines) {
  return lines.map((line, idx) => ({ id: `M${idx+1}`, metric: line, value: inferNumeric(line) }));
}

function parseOutreach(lines) {
  return lines.map((line, idx) => ({ id: `O${idx+1}`, activity: line, audience: inferAudience(line) }));
}

function parseGeography(lines) {
  return lines.map((line, idx) => ({ id: `GA${idx+1}`, area: line }));
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
    completionRate: goals.length ? (goals.filter(g => g.status === 'completed').length / goals.length) : 0
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
