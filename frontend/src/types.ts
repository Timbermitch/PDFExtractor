export interface ExtractedReportSummary {
  totalGoals: number;
  totalBMPs: number;
  completionRate: number;
  totalActivities?: number;
  totalMetrics?: number;
  avgGoalConfidence?: number;
  strongGoals?: number; // goals with confidence >= 0.7
  goalStatus?: {
    completed: number;
    inProgress: number;
    planned: number;
    pctCompleted: number;
    pctInProgress: number;
    pctPlanned: number;
  };
  bmpCategories?: Record<string, number>;
}

export interface ReportListItem {
  id: string;
  displayName?: string;
  summary: ExtractedReportSummary;
  generatedAt: string;
  // Optional aggregated cost summary provided by backend list route
  costSummary?: {
    tables: number;
    totalReported: number | null;
    totalComputed: number | null;
    discrepancy: number | null;
  } | null;
}

export interface Goal {
  id: string;
  title: string;
  shortTitle?: string; // optional condensed form
  description?: string; // full paragraph description if available
  status: 'completed' | 'in_progress' | 'planned';
  targetValue?: number | null;
  targetUnit?: string | null; // new explicit field (backward alias of unit)
  unit?: string | null;
  baselineValue?: number | null;
  baselineUnit?: string | null;
  achievedValue?: number | null;
  achievedUnit?: string | null;
  reductionPercent?: number | null; // percent numeric 0-100
  parameter?: string | null;        // legacy alias of pollutant
  pollutant?: string | null;        // explicit pollutant (same as parameter if present)
  loadReductionValue?: number | null;
  loadReductionUnit?: string | null;
  responsible?: string | null;      // responsible party text
  deadline?: string | null;         // ISO inferred end-of-year date
  baselineYear?: string | null;
  achievedYear?: string | null;
  targetYear?: string | null;
  source?: string;                  // original line
  confidence?: number;              // heuristic scoring 0-1
}
export interface BMP { id: string; name: string; category: string; keyword?: string | null; quantity?: number | null; unit?: string | null; verb?: string | null; confidence?: number; source?: string; }
export interface ImplementationActivity { id: string; description: string; date: string | null; target?: number | null; achieved?: number | null; source?: string; }
export interface Activity { id: string; description: string; verb?: string | null; object?: string | null; frequency?: string | null; dueYear?: string | null; responsible?: string | null; costValue?: number | null; costUnit?: string | null; confidence?: number; source?: string; }
export interface MonitoringMetric { id: string; metric: string; value: number | null; unit?: string | null; source?: string; }
export interface OutreachActivity { id: string; activity: string; audience: string; }
export interface GeographicArea { id: string; area: string; }

export interface ExtractedReport {
  id?: string; // optional until ensured backend supplies id in silver JSON
  summary: ExtractedReportSummary;
  goals: Goal[];
  bmps: BMP[];
  bmpCostTable?: { columns: string[]; rows: Record<string,string>[]; total?: number | null } | null;
  bmpCostTotal?: number | null;
  bmpCostTableNormalized?: {
  rows: { name: string; rawSize: string; rawCost: string; quantity: number|null; unit: string|null; unitRaw?: string|null; unitCost: number|null; totalCost: number|null }[];
  // unitRaw (original textual unit) will appear if canonicalization changed the value
  // Augment row type to optionally include unitRaw without breaking existing usage
    totalReported?: number | null;
    totalComputed?: number | null;
    discrepancy?: number | null;
  } | null;
  // Multi-table support (new)
  bmpCostTables?: {
    id: string;
    title: string;
    table?: { columns: string[]; rows: Record<string,string>[]; total?: number | null };
  }[];
  bmpCostTablesNormalized?: {
    id: string;
    title: string;
    rows: { name: string; rawSize: string; rawCost: string; quantity: number|null; unit: string|null; unitRaw?: string|null; unitCost: number|null; totalCost: number|null; landownerMatch?: number|null; producerContribution?: number|null; nrcsContribution?: number|null; otherContribution?: number|null; fundingPctProducer?: number|null; fundingPctNRCS?: number|null; fundingPctOther?: number|null }[];
    totalReported?: number | null;
    totalComputed?: number | null;
    discrepancy?: number | null;
    landownerMatchReported?: number | null;
    landownerMatchComputed?: number | null;
    matchDiscrepancy?: number | null;
    // New pattern metadata (multi pattern support)
    patternId?: string; // e.g., 'multi_funding_source_costs', 'implementation_plan_coded_budget'
    patternConfidence?: number; // heuristic confidence from backend
    // Funding allocation specific computed sums (for multi_funding_source_costs)
    producerComputed?: number | null;
    nrcsComputed?: number | null;
    otherComputed?: number | null; // EPA-MDEQ / other combined bucket
  }[];
  activities?: Activity[]; // new enhanced array
  implementation: ImplementationActivity[];
  monitoring: MonitoringMetric[];
  outreach: OutreachActivity[];
  geographicAreas: GeographicArea[];
  generatedAt: string;
  metadata?: { sourceId?: string; sourceFile?: string; enrichmentVersion?: number };
}

// Backward compatibility helpers
export function ensureSummary(report: ExtractedReport): ExtractedReportSummary {
  const s = report.summary || ({} as any);
  // Recompute goalStatus if missing
  if (!s.goalStatus && report.goals) {
    const total = report.goals.length || 0;
    const completed = report.goals.filter(g=>g.status==='completed').length;
    const inProgress = report.goals.filter(g=>g.status==='in_progress').length;
    const planned = report.goals.filter(g=>g.status==='planned').length;
    s.goalStatus = {
      completed,
      inProgress,
      planned,
      pctCompleted: total? completed/total: 0,
      pctInProgress: total? inProgress/total: 0,
      pctPlanned: total? planned/total: 0
    };
  }
  if (!s.bmpCategories && report.bmps) {
    const counts: Record<string, number> = {};
    report.bmps.forEach(b=>{ counts[b.category||'Unknown'] = (counts[b.category||'Unknown']||0)+1; });
    s.bmpCategories = counts;
  }
  if (s.totalGoals == null) s.totalGoals = report.goals?.length || 0;
  if (s.totalBMPs == null) s.totalBMPs = report.bmps?.length || 0;
  if (s.totalActivities == null) s.totalActivities = report.implementation?.length || 0;
  // Use enhanced activities array if present
  if (report.activities && report.activities.length && (!s.totalActivities || s.totalActivities < report.activities.length)) {
    s.totalActivities = report.activities.length;
  }
  if (s.avgGoalConfidence == null && report.goals?.length) {
    s.avgGoalConfidence = report.goals.reduce((acc,g)=>acc+(g.confidence||0),0)/report.goals.length;
  }
  if (s.strongGoals == null && report.goals?.length) {
    s.strongGoals = report.goals.filter(g=> (g.confidence||0) >= 0.7).length;
  }
  if (s.totalMetrics == null) s.totalMetrics = report.monitoring?.length || 0;
  if (s.completionRate == null && s.totalGoals) {
    s.completionRate = s.goalStatus? s.goalStatus.pctCompleted : (report.goals.filter(g=>g.status==='completed').length / s.totalGoals);
  }
  return s as ExtractedReportSummary;
}
