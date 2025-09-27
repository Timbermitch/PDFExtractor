# PDF Extraction Tool — Medallion Architecture Demo

A technical assessment implementation that ingests PDFs, extracts raw text (Bronze), normalizes & structures domain entities (Silver), and provides export-ready datasets & visualizations (Gold).

## Overview

| Layer | Purpose | This Project | Enterprise (Azure + Databricks Mapping) |
|-------|---------|--------------|-------------------------------------------|
| Bronze | Raw immutable ingestion | PDF bytes + raw extracted text stored as JSON in `backend/data/bronze/` | ADLS Gen2 landing zone, Databricks Auto Loader streaming ingestion into raw Delta tables |
| Silver | Cleansed & conformed schema | Regex + LLM classification -> `ExtractedReport` objects in `backend/data/silver/` | Delta Live Tables (DLT) transforming raw to curated Delta tables with expectations (quality gates) |
| Gold | Analytics-ready + BI serving | Aggregated / export endpoints -> JSON / CSV in `backend/data/gold/` | Databricks SQL endpoints, Power BI semantic models / dashboards |

## Features
Core pipeline (Bronze → Silver → Gold):
1. Upload & Ingest (Bronze)
  - Multipart PDF upload (in‑memory) → raw text extracted with `pdf-parse`.
  - Stored as JSON: `{ id, originalName, rawText, extractedAt }` in `backend/data/bronze/`.
  - ID is a slug derived from the original filename (collision‑safe) for human readability.
2. Structuring (Silver)
  - Regex + heuristic parsing for sections: Goals, BMPs, Implementation, Monitoring, Outreach, Geography.
  - Enriched extraction: numeric quantity parsing (value + unit), target vs achieved parsing inside implementation lines, goal targetValue + unit inference, BMP keyword detection, status inference.
  - Presence guard: every extracted entity retains original source line for future false‑positive auditing.
  - Summary statistics: goal status distribution, BMP category counts, completion rates, activity & metric totals.
3. Serving (Gold)
  - On-demand export as JSON or CSV; artifacts persisted under `backend/data/gold/`.

Additional capabilities:
- Optional OpenAI classification (if `OPENAI_API_KEY` is set) to categorize previously uncategorized lines (gracefully skipped if absent).
- Listing endpoint returns processed report summaries with original display name.
- Deletion endpoints (single & bulk) remove Bronze/Silver/Gold artifacts consistently.
- Evaluation / accuracy framework (precision, recall, F1, numeric value tolerance) with threshold gating.
- React + TypeScript dashboard: tabbed interface (Summary, Goals, BMPs, Implementation, Monitoring, Outreach, Geography, Charts) with Recharts visualizations (goal status donut, BMP categories donut, target vs achieved bar, monitoring metrics bar).

Planned (future) enhancements are tracked in the Extensibility Roadmap; everything above is implemented.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health probe |
| POST | `/upload` | Accepts PDF (`file` field). Returns `{ id, rawText, metadata }` (Bronze). `id` is filename slug. |
| POST | `/process` | Body: `{ id?: string, rawText?: string }` -> builds structured report, writes Silver JSON. |
| GET | `/reports` | List processed report summaries (id, displayName, summary metrics). |
| DELETE | `/reports/:id` | Delete all artifacts (bronze/silver/gold) for a single report id. |
| DELETE | `/reports` | Bulk purge (bronze/silver/gold). Use cautiously. |
| GET | `/export/:id?format=json|csv` | Export specific report (persists to Gold). Default format `json`. |

Notes:
- If `rawText` is provided directly to `/process`, the pipeline can run without a prior `/upload` (useful for testing). Provide `id` to link to an existing Bronze record; otherwise a transient process occurs.
- Deletion endpoints are idempotent; missing artifacts are skipped.

### Example Flow
1. `POST /upload` (multipart) => `{ id: "watershed-plan-2024", ... }` (Bronze created).
2. `POST /process` body `{ id: "watershed-plan-2024" }` → Silver JSON at `data/silver/watershed-plan-2024.json`.
3. `GET /reports` → list shows displayName derived from original filename.
4. `GET /export/watershed-plan-2024?format=csv` → CSV persisted to `data/gold/` and streamed to client.
5. (Optional) `DELETE /reports/watershed-plan-2024` → cleans bronze/silver/gold for that report.

## Data Schema (`ExtractedReport`)
Evolves as heuristics improve (backwards-compatible additions). Current shape:
```ts
interface ExtractedReportSummary {
  totalGoals: number;
  totalBMPs: number;
  completionRate: number;      // fraction 0..1
  totalActivities: number;     // implementation entries
  totalMetrics: number;        // monitoring entries
  goalStatus: {
    completed: number;
    inProgress: number;
    planned: number;
    pctCompleted: number;
    pctInProgress: number;
    pctPlanned: number;
  };
  bmpCategories: Record<string, number>; // counts by inferred category
}

interface Goal {
  id: string;
  title: string;
  status: 'completed' | 'in_progress' | 'planned';
  targetValue?: number | null; // parsed numeric target if present
  unit?: string | null;        // associated unit (e.g., 'acres', '%')
  source?: string;             // original line
}

interface BMP {
  id: string;
  name: string;
  category: string;            // heuristic inference (Erosion Control, Stormwater, General)
  keyword?: string | null;     // matched keyword phrase
  source?: string;             // original line
}

interface ImplementationActivity {
  id: string;
  description: string;
  date: string | null;         // coarse year → YYYY-01-01
  target?: number | null;      // parsed from "Target:" segment
  achieved?: number | null;    // parsed from "Achieved:" segment
  source?: string;
}

interface MonitoringMetric {
  id: string;
  metric: string;              // full cleaned line
  value: number | null;        // first numeric quantity
  unit?: string | null;        // parsed unit (mg/L, acres, %, etc.)
  source?: string;
}

interface OutreachActivity { id: string; activity: string; audience: string; source?: string; }
interface GeographicArea { id: string; area: string; source?: string; }

interface ExtractedReport {
  id: string | null;           // slug id (filename-derived) or null if transient
  summary: ExtractedReportSummary;
  goals: Goal[];
  bmps: BMP[];
  implementation: ImplementationActivity[];
  monitoring: MonitoringMetric[];
  outreach: OutreachActivity[];
  geographicAreas: GeographicArea[];
  generatedAt: string;         // ISO timestamp
  metadata?: { sourceId?: string; sourceFile?: string };
}
```

All array entries retain `source` for traceability & future false-positive auditing. Presence flags can be layered in later by referencing original bronze text.

## Accuracy & Validation
The evaluation framework lives in `backend/validation/`.

Script: `node backend/validation/evaluate.js [--report <id>]`

It will:
1. Load each `*.gold.json` file in `backend/validation/gold/`.
2. Load matching Silver JSON (`data/silver/<id>.json`).
3. Normalize strings (case, punctuation) and compute per-category: precision, recall, F1.
4. Compute numeric metric value + unit matching (tolerant to relative error via `METRIC_VALUE_TOLERANCE`).
5. Produce a timestamped JSON summary in `backend/validation/results/` and log a human-readable overview.

Default recall thresholds (override via env):
```
GOAL_MIN=0.9
BMP_MIN=0.9
ACTIVITY_MIN=0.9
METRIC_MIN=0.9
METRIC_VALUE_TOLERANCE=0.01
```

Example:
```bash
node backend/validation/evaluate.js --report watershed-plan-2024
```

Gold file example (only include arrays you want scored):
```jsonc
{
  "reportId": "watershed-plan-2024",
  "goals": ["Reduce sediment by 30%"],
  "bmps": ["Rain garden"],
  "activities": ["Install sediment trap"],
  "metrics": ["Sediment load 250 mg/L"]
}
```

If a category is omitted in gold it is skipped (not penalized). Add this step to CI to prevent regressions.

## Environment Variables
Create `backend/.env` from `.env.example`:
```
OPENAI_API_KEY=sk-...        # optional
PORT=4000
NODE_ENV=development
LOG_LEVEL=info
# Accuracy thresholds (optional overrides)
GOAL_MIN=0.9
BMP_MIN=0.9
ACTIVITY_MIN=0.9
METRIC_MIN=0.9
METRIC_VALUE_TOLERANCE=0.01
```
If `OPENAI_API_KEY` is absent the classification stage is skipped.

## Local Development
```bash
cd backend
npm install
npm run dev
```
Upload test using curl (example on PowerShell use backticks or ^ for line continuation):
```bash
curl -F "file=@sample.pdf" http://localhost:4000/upload
```
Then process:
```bash
curl -X POST http://localhost:4000/process -H "Content-Type: application/json" -d '{"id":"<returned-id>"}'
```
Export CSV:
```bash
curl -L "http://localhost:4000/export/<returned-id>?format=csv" -o report.csv
```

## Enterprise Mapping (Azure + Databricks)
| Concept | Demo Implementation | Enterprise Implementation |
|---------|---------------------|---------------------------|
| Ingestion | Express `/upload` storing JSON | ADLS Gen2 + Auto Loader streaming ingestion |
| Orchestration | Manual API sequence | Azure Data Factory / Synapse pipelines triggering DLT |
| Transformation | Node regex + optional LLM | Delta Live Tables w/ Expectations + MLflow models |
| Classification | OpenAI API (on-demand) | Azure OpenAI / Databricks Model Serving (governed) |
| Storage | JSON files (bronze/silver/gold) | Delta Lake tables with Unity Catalog governance |
| Quality | Validation script (accuracy thresholds) | DLT expectations, Great Expectations, automated lineage |
| Serving | CSV/JSON export endpoints | Databricks SQL endpoints + Power BI dashboards |
| Governance | Minimal metadata | Microsoft Purview + Unity Catalog lineage & data classification |

## Extensibility Roadmap
- Add authentication & role-based access (JWT / Entra ID in enterprise).
- Implement advanced NLP pipeline (entity extraction, dedupe) via spaCy / transformers.
- Add streaming ingestion watch folder.
- Introduce unit tests (Jest) & integration tests with mocked OpenAI.
- Containerize (Docker) and add GitHub Actions CI.
- Deploy backend (Railway / Render) & frontend (Vercel) with environment-specific configs.

## Frontend
Implemented in `frontend/` (React + TypeScript, light Tailwind usage + custom CSS):

Tabs:
- Summary (key counts, completion %, goal status distribution, BMP category counts)
- Goals, BMPs, Implementation, Monitoring, Outreach, Geography (scrollable data tables/lists)
- Charts (Recharts visualizations: goal status donut, BMP categories donut, target vs achieved bar, monitoring metrics bar)

Workflow UI:
1. Upload (drag/drop or file select) → shows raw text preview.
2. Process → triggers `/process` and displays structured dashboard.
3. Export → CSV/JSON request to backend.
4. Delete (single or bulk) → cleans artifacts and refreshes list.

Each list item displays the human-friendly `displayName` (original file base name) plus summary statistics.

## Medallion Value
Separating raw vs curated vs serving layers reduces reprocessing risk, enables schema evolution, and aligns compute cost with data refinement stage. This demo compresses that lifecycle into a clear, inspectable file hierarchy.

## License
MIT (adjust as needed).
