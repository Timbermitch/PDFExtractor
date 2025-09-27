export interface ExtractedReportSummary {
  totalGoals: number;
  totalBMPs: number;
  completionRate: number;
}

export interface ReportListItem {
  id: string;
  summary: ExtractedReportSummary;
  generatedAt: string;
}

export interface Goal { id: string; title: string; status: 'completed' | 'in_progress' | 'planned'; }
export interface BMP { id: string; name: string; category: string; }
export interface ImplementationActivity { id: string; description: string; date: string | null; }
export interface MonitoringMetric { id: string; metric: string; value: number | null; }
export interface OutreachActivity { id: string; activity: string; audience: string; }
export interface GeographicArea { id: string; area: string; }

export interface ExtractedReport {
  id?: string; // optional until ensured backend supplies id in silver JSON
  summary: ExtractedReportSummary;
  goals: Goal[];
  bmps: BMP[];
  implementation: ImplementationActivity[];
  monitoring: MonitoringMetric[];
  outreach: OutreachActivity[];
  geographicAreas: GeographicArea[];
  generatedAt: string;
  metadata?: { sourceId?: string; sourceFile?: string };
}
