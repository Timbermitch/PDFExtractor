## PDFExtractor Enhancements Overview

This project now includes a modular cost table pattern registry, bulk PDF ingestion scripts, and verification utilities.

### Live Demo (Render Deployment)

Primary (Root UI / Fallback Page): https://pdf-extractor-backend.onrender.com

Health Check (JSON): https://pdf-extractor-backend.onrender.com/health

Version / Build Metadata: https://pdf-extractor-backend.onrender.com/version

Notes:
- The root URL will serve the bundled frontend if present; otherwise it shows a minimal inline fallback page with links to the API endpoints.
- If you encounter a cold start delay (Render free tier), the first request may take ~20–40 seconds to wake the service.
- Use the Version endpoint to confirm the deployed git commit (fields: gitSha, buildTime, env).


### Cost Table Enrichment Passes (Multi-Stage)
Cost extraction proceeds in layered passes to maximize recall while keeping early passes precise:
1. Inline (during initial silver build): Pattern registry (`parseCostTablesWithPatterns`) + legacy heuristics in `reportBuilder.js` capture well‑structured known formats (Booths Creek, Bell Creek, Phase 1 BMPs, Activity/Match, Practice Costs, Tech Assistance, Full / Phase 1 Implementation estimates).
2. Enrichment Pass 2 (`enrich_silver_costs.js`): Reconstructs full bronze text for already existing silvers and re-runs parsing with a broader sectionization plus an ALL-lines fallback to capture tables missed due to section boundary segmentation.
3. Enrichment Pass 3 (`enrich_silver_costs_pass3.js`): Aggressive loose cluster scan for reports still lacking any cost tables. Detects consecutive dollar‑bearing line clusters, infers minimal columns, and normalizes them under a synthetic patternId `aggressive_loose_cluster` (lower confidence 0.55–0.60). Guardrails exclude tiny or highly repetitive clusters to reduce noise.

Post-pass validation (see Metrics section) reports pattern usage, coverage (% of reports with ≥1 cost table), and discrepancy buckets. Consumers may optionally filter out low‑confidence synthetic clusters (patternId `aggressive_loose_cluster`) if a high‑precision portfolio total is required.

### Key Scripts (run from `backend/` directory)

| Script | Purpose |
|--------|---------|
| `node scripts/fetch_mdeq_pdfs.js` | Download all watershed plan PDFs from MDEQ index. |
| `node scripts/analyze_mdeq_pdfs.js` | Extract candidate cost header contexts for pattern discovery. |
| `npm run cost:audit` | Find cost-like lines that did not map to a known pattern. |
| `npm run cost:verify` | Validate each table's computed vs reported totals (5% tolerance). |
| `npm run cost:summary` | Aggregate total reported/computed dollars grouped by pattern. |


### Cost Table Snapshot Regression

To guard against unintended changes in parsed cost tables, a snapshot mechanism captures a compact signature of each report's normalized cost tables.

Scripts:
- `npm run cost:snapshot` (from backend directory) – compare current extraction to saved snapshots.
- `npm run cost:snapshot -- --update` – rebuild snapshots after intentional parser changes.

Snapshot storage: `backend/test/fixtures/costTables/*.json`

Snapshot schema (per report):
```
{
  "reportId": "<id>",
  "tables": [
    {
      "id": "table identifier",
      "title": "Original title or null",
      "patternId": "pattern id or null",
      "rowCount": 12,
      "totalReported": 123456,
      "totalComputed": 123450,
      "hash": "sha1...",
      "rowHashes": { "nameHash": "sha1...", "totalHash": "sha1..." }
    }
  ],
  "combinedHash": "sha1 of all table hashes"
}
```

Failure cases reported on compare:
- Added / Removed tables
- Row count changes
- Total reported / computed changes
- Row name set hash changes
- Combined hash difference (aggregate integrity indicator)

Workflow:
1. Run `npm run cost:snapshot` after changes.
2. If diffs are expected (intentional parser updates), re-run with `--update` and commit new fixture files.
3. If diffs are unexpected, investigate before committing.

Integrating with CI: Add a CI step executing the snapshot command (without `--update`) to fail builds on unexpected extraction deltas.

Tolerance: Snapshot hash diff is strict; if you need tolerance logic (e.g., allow small numeric drift) extend `snapshot_cost_tables.js` to compare totals within a threshold before flagging.

### Adaptive Generic Cost Pattern

When a PDF does not match any specific registered cost table pattern, the system now attempts a final fallback: `adaptive_generic_costs`.

Heuristic criteria:
- Line containing at least one dollar amount ($123...)
- Local window (up to 12 lines) has >= 3 lines with dollar amounts
- Excludes known header signatures (e.g., Producer/NRCS, Code Practice Units, Activity Size/Amount)

Captured block rules:
- Scans forward up to 80 lines until blank or a section-like header (Goal, Objective, Section, Table, Implementation Plan) appears.
- Accepts lines of form `<text> ... $X` or `<text> ... $X $Y` (stores second amount as `Extra` but does not normalize it yet).
- Requires at least 3 cost rows to minimize noise.

Normalization output:
```
patternId: adaptive_generic_costs
rows: [{ name, totalCost, rawCost }]
totalComputed: sum of parsed primary dollar amounts
patternConfidence: 0.50 (baseline heuristic)
```

Limitations & Next Steps:
- Does not infer units, match columns, or landowner contributions.
- Ignores potential secondary `Extra` amounts in total computation.
- Could incorporate column inference (frequency analysis of trailing tokens) in future.
- Consider ML classification of blocks before inclusion to reduce false positives.

### Cost Coverage Audit (MDEQ Subset)

Purpose: Quantify how many processed Silver reports currently contain at least one normalized cost table, identify reliance on fallback/adaptive parsing, and flag possible truncation artifacts.

Script (run inside `backend/`):
```
npm run cost:coverageAudit -- --json audit_cost_coverage.json
```
Or directly:
```
node scripts/audit_mdeq_cost_coverage.js --json audit_cost_coverage.json
```

Output:
1. Console summary (counts + percentage coverage)
2. Optional JSON file (when `--json <path>` provided) containing:
```
{
  "summary": {
    "totalReports": number,
    "withCost": number,
    "withoutCost": number,
    "coveragePct": 0..1,
    "withAdaptive": number,
    "suspectedTrunc": number,
    "timestamp": ISO8601
  },
  "reports": [
     { id, hasCost, adaptive, tableCount, adaptiveCount, bronzeLen, segmentCount, suspectedTrunc }
  ]
}
```

Exit Code Policy:
- Returns exit code 1 if more than 10% of reports are missing cost tables OR any truncation indicators are detected; else 0. This allows CI gating.

Heuristics:
- Truncation suspicion currently based on presence of legacy segmentation markers (e.g., `18000` length boundary tokens or `TRUNCATED_SEGMENT_MARKER`).
- Adaptive fallback counted when `patternId === 'adaptive_generic_costs'` appears in any table's normalized metadata.

Typical Remediation Flow for Missing Cost Coverage:
1. Inspect bronze JSON for one missing report (search for candidate cost headers like "Cost", "Total", "Producer", or high density of dollar amounts).
2. Confirm table header variants not yet in `costTablePatterns.js`.
3. Add a new explicit pattern (preferred when header structure is repeatable across multiple reports) OR relax adaptive header guards.
4. Re-run coverage audit; target incremental improvements (e.g., ≥80% first pass, ≥90% after pattern promotion).
5. Once stable, enforce threshold in CI (e.g., fail if coverage < 0.85 or truncation > 0).

CI Recommendation:
Add a workflow step (GitHub Actions example skeleton):
```
run: |
  cd backend
  npm run cost:coverageAudit -- --json audit_cost_coverage.json
```
Then parse `audit_cost_coverage.json` for `coveragePct` and push metrics to a dashboard or artifact store.

Future Enhancements:
- Stratified coverage (by report year or pattern family).
- Diff mode: show newly missing coverage vs previous run.
- Confidence-weighted coverage (discount low-confidence adaptive tables).
- HTML or Markdown report generation for easier human review.


### Pattern Registry
Located at `backend/services/patterns/costTablePatterns.js`. Each pattern defines:
```
id, description,
headerTest(line, allLines, index) -> boolean,
parse(allLines, startIndex) -> { table, normalized }
```
Normalized object includes computed vs reported totals plus `patternId` and `patternConfidence`.

### Structured Report Metadata
Structured reports now contain:
```
metadata.costPatternsDetected = [ { id, title, confidence, totalReported, totalComputed } ]
```
This is surfaced (count only) in the frontend ReportList as a small badge.

### Adding a New Pattern
1. Inspect analysis output in `data/interim/mdeq/*.analysis.json` for a novel header.
2. Add a new entry to the patterns array in `costTablePatterns.js`.
3. Implement `headerTest` (fast, cheap) and `parse` (robust, defensive; return null if parse fails).
4. Run `npm run cost:verify` to ensure totals are acceptable.
5. Optionally run `npm run cost:audit` to confirm no residual unmatched lines.

### Future Ideas
- Confidence heuristic based on row parse success ratio.
- Automated test fixtures per pattern.
- OCR tolerance / fuzzy header matching.
- Pattern-specific discrepancy analytics.

### Aggregated Cost & Pattern Summary Endpoint
The endpoint `GET /reports/summary` provides cross-report analytics derived from Silver layer cost tables.

Current response shape:
```
{
  reportCount: number,              // total silver reports scanned
  reportsWithCosts: number,         // reports containing at least one parsed cost table
  totalReported: number,            // sum of table-level reported totals (where available)
  totalComputed: number,            // sum of recomputed totals from normalized rows
  totalComputedWeighted: number|null, // Σ(computed * patternConfidence) across all tables with confidence
  discrepancy: number|null,         // (totalReported - totalComputed) when both non-zero
  patternUsage: [
    {
      patternId: string,
      count: number,                // number of tables matched to this pattern
      totalReported: number,        // sum reported totals for this pattern (if present)
      totalComputed: number,        // sum computed totals for this pattern
      weightedComputed: number,     // Σ(tableComputed * patternConfidence)
      withReportedTotals: number,   // tables under this pattern that had a reported total field
      totalWithBoth: number,        // tables having both reported and computed values
      pctWithin1pct: number,        // fraction of totalWithBoth whose abs diff <= 1% of computed
      pctWithin5pct: number,        // fraction of totalWithBoth whose abs diff <= 5% of computed
      avgDiscrepancy: number|null,  // average (reported - computed) over tables with both totals
      sumDiscrepancy: number        // aggregate (reported - computed)
    }
  ],
  discrepancyFlags: [
    { report: string, reported: number, computed: number, diff: number, rel: number }
  ]
}
```

Interpretation Notes:
- `patternId` includes both registry-defined patterns and heuristic legacy formats mapped to synthetic IDs (e.g., `booths_creek_format`).
- `totalComputedWeighted` helps discount lower-confidence heuristic parses when deriving a conservative portfolio total.
- `pctWithin1pct` / `pctWithin5pct` serve as quick quality gauges per pattern; low values suggest header drift or parse degradation.
- `avgDiscrepancy` near zero indicates unbiased parsing; systemic positive values hint at missed row costs, negative values hint at double counting or over-expansion.

Operational Workflow Recommendation:
1. Add / modify a pattern → run `npm run cost:verify` locally.
2. Rebuild a sample silver report (`npm run rebuild:one`) to embed new patternId & confidence.
3. Inspect `/reports/summary` to confirm increased `count` under the new patternId and acceptable accuracy statistics.
4. If `pctWithin5pct` drops unexpectedly for an existing pattern, trigger a regression review (compare row-level diffs against prior artifact backups in CI).

Programmatic Example:
```bash
curl -s http://localhost:5200/reports/summary | jq '.patternUsage[] | {patternId,totalComputed,pctWithin1pct}'
```

To compute a conservative funding total using weighting:
```bash
curl -s http://localhost:5200/reports/summary | jq '.totalComputedWeighted'
```

If you prefer a strict view limited to high-agreement patterns:
```bash
curl -s http://localhost:5200/reports/summary \
  | jq '.patternUsage | map(select(.pctWithin1pct > 0.6)) | map(.totalComputed) | add'
```

### BMP Fallback Extraction
When no explicit BMP section yields results, a narrative bullet fallback scans bronze text for anchor phrases (e.g., *"These BMPs include:"*) and reconstructs a baseline BMP set. The outcome is flagged with `metadata.bmpFallbackApplied = true` allowing downstream quality dashboards to differentiate primary vs. fallback sources.

### Metrics & Coverage Endpoints
Two lightweight API endpoints expose corpus-level operational metrics (after running validation scripts):
| Endpoint | Description |
|----------|-------------|
| `GET /reports/coverage` | Bronze/Silver generation coverage summary (from `backend/data/coverage/mdeq_coverage.json`). |
| `GET /reports/validation` | Validation / enrichment summary (pattern usage, counts, discrepancy buckets) from `backend/data/validation/mdeq_corpus_summary.json`. |

Example quick check (PowerShell single line):
```
curl http://localhost:5200/reports/validation | jq '.validation.totals.costTables'
```

### Current Corpus Metrics (After Pass 3 Aggressive Enrichment)
Latest run (see timestamp inside `mdeq_corpus_summary.json`):
```
reports: 51
reportsWithCostTables: 37 (72.5%)
totalCostTables: 79
uniquePatterns: 14
aggressive_loose_cluster tables: 37 (10 reports)
discrepancy buckets (table-level):
  <=1%: 19.0%
  <=5%: 19.0%
  >20%: 11.4%
```
Interpretation:
- Coverage increased from 27 → 37 reports with cost tables after pass 3 (+37%).
- The aggressive clusters materially boost recall; treat them as exploratory until vetted (consider filtering by `patternConfidence >= 0.75` for conservative analytics).
- Elevated >20% discrepancy share reflects noisier cluster inference; future refinement should prune or better segment multi‑table merged regions.

Recommended next refinement steps:
1. Cluster Splitting: Detect internal blank-line separators and recompute sums to lower false totals.
2. Header Detection Upgrade: Use n-gram scoring to label columns (Name / Qty / Unit / Cost) and derive quantities where currently null.
3. Confidence Calibration: Penalize clusters lacking an external "Total" line, or where (Σ row totals) and detected reported total diverge >25%.
4. Pattern Promotion: If an aggressive cluster matches >60% of a known pattern row regex, promote patternId to that known type and escalate confidence.
5. Discrepancy Analytics: Persist per-row parse diagnostics (missing money cell, ambiguous split) to support targeted rule tuning.

You can regenerate these metrics after additional heuristics with:
```
node backend/scripts/validate_mdeq_corpus.js
```

And fetch via API:
```
curl http://localhost:5200/reports/validation | jq '.validation.patternUsage.aggressive_loose_cluster'
```


See `backend/README_PATTERN_WORKFLOW.md` for more in-depth guidance.
# PDF Extraction Tool — Medallion Architecture Demo

A technical assessment implementation that ingests PDFs, extracts raw text (Bronze), normalizes & structures domain entities (Silver), and provides export-ready datasets & visualizations (Gold).

## Quick Start (90‑Second Version)
```bash
git clone <repo-url>
cd pdfextractor
npm install          # installs backend & frontend
npm run dev          # backend auto-tries 5200→5202, frontend starts
```
1. Open http://localhost:3000 (or the port React chooses).
2. Drag & drop a PDF → Upload.
3. Click Process to build structured report.
4. Explore tabs (Summary, Goals, etc.) or Export CSV/JSON.

Need more detail? Skip to Unified Dev Workflow, API Endpoints, or Data Schema sections below.

### API Quick Start (curl)
Assumes backend running on port 5200 (adjust if it retried to 5201 / 5202). PowerShell users: use backticks ` or caret ^ for line continuation, or put everything on one line.

Upload a PDF:
```bash
curl -F "file=@sample.pdf" http://localhost:5200/upload
```
Response (truncated example):
```json
{ "id": "sample", "rawText": "...", "metadata": { "originalName": "sample.pdf" } }
```

Process it into a structured (Silver) report:
```bash
curl -X POST http://localhost:5200/process \
  -H "Content-Type: application/json" \
  -d '{"id":"sample"}'
```

List reports:
```bash
curl http://localhost:5200/reports
```

Export CSV:
```bash
curl -L "http://localhost:5200/export/sample?format=csv" -o sample.csv
```

Delete one report:
```bash
curl -X DELETE http://localhost:5200/reports/sample
```

Bulk delete all (careful):
```bash
curl -X DELETE http://localhost:5200/reports
```

Health probe (shows JSON):
```bash
curl http://localhost:5200/health
```

### jq Parsing Examples
Useful one‑liners (bash) for quickly inspecting API JSON. (Install jq: https://stedolan.github.io/jq/)

Capture ID from upload:
```bash
ID=$(curl -s -F "file=@sample.pdf" http://localhost:5200/upload | jq -r '.id')
echo "Got id=$ID"
```

Process and pretty-print only goal titles:
```bash
curl -s -X POST http://localhost:5200/process \
  -H 'Content-Type: application/json' \
  -d '{"id":"'$ID'"}' | jq '.goals[].title'
```

List report IDs with total goals and completion rate:
```bash
curl -s http://localhost:5200/reports | jq -r '.reports[] | "\(.id) goals=\(.summary.totalGoals) completion=\(.summary.completionRate)"'
```

Extract only incomplete goals (status != completed):
```bash
curl -s -X POST http://localhost:5200/process \
  -H 'Content-Type: application/json' \
  -d '{"id":"'$ID'"}' | \
  jq -r '.goals[] | select(.status!="completed") | .title'
```

Get BMP category distribution as compact JSON:
```bash
curl -s -X POST http://localhost:5200/process -H 'Content-Type: application/json' -d '{"id":"'$ID'"}' | jq '.summary.bmpCategories'
```

Show monitoring metrics with value + unit:
```bash
curl -s -X POST http://localhost:5200/process -H 'Content-Type: application/json' -d '{"id":"'$ID'"}' | \
  jq -r '.monitoring[] | select(.value!=null) | "\(.metric): \(.value) \(.unit // "")"'
```

Delete all reports and show counts purged:
```bash
curl -s -X DELETE http://localhost:5200/reports | jq '{total, purged}'
```

### Converting JSON to CSV (jq piping)
Extract specific fields and produce ad‑hoc CSVs without using the built‑in export endpoint.

Goals (id,title,status,targetValue,unit):
```bash
curl -s -X POST http://localhost:5200/process \
  -H 'Content-Type: application/json' -d '{"id":"'$ID'"}' | \
  jq -r '("id,title,status,targetValue,unit"), (.goals[] | [ .id, (.title|gsub("\n";" ")), .status, (.targetValue//""), (.unit//"") ] | @csv)'
```

Monitoring metrics (metric,value,unit):
```bash
curl -s -X POST http://localhost:5200/process -H 'Content-Type: application/json' -d '{"id":"'$ID'"}' | \
  jq -r '("metric,value,unit"), (.monitoring[] | select(.value!=null) | [ (.metric|gsub("\n";" ")), .value, (.unit//"") ] | @csv)'
```

Flatten BMP category counts to two-column CSV (category,count):
```bash
curl -s -X POST http://localhost:5200/process -H 'Content-Type: application/json' -d '{"id":"'$ID'"}' | \
  jq -r '.summary.bmpCategories | to_entries | ("category,count"), (.[] | [ .key, .value ] | @csv)'
```

All implementation activities with target/achieved (id,description,target,achieved):
```bash
curl -s -X POST http://localhost:5200/process -H 'Content-Type: application/json' -d '{"id":"'$ID'"}' | \
  jq -r '("id,description,target,achieved"), (.implementation[] | [ .id, (.description|gsub("\n";" ")), (.target//""), (.achieved//"") ] | @csv)'
```

Save directly to a file:
```bash
curl -s -X POST http://localhost:5200/process -H 'Content-Type: application/json' -d '{"id":"'$ID'"}' | \
  jq -r '("metric,value,unit"), (.monitoring[] | select(.value!=null) | [ (.metric|gsub("\n";" ")), .value, (.unit//"") ] | @csv)' > monitoring.csv
```

PowerShell note: Use double quotes for JSON, escape inner quotes with backtick ` or use a here-string. Example:
```powershell
$body = '{"id":"' + $env:ID + '"}'
curl -Method POST -Uri http://localhost:5200/process -ContentType 'application/json' -Body $body | jq -r '("id,title"), (.goals[] | [ .id, (.title|gsub("\n";" ")) ] | @csv)'
```

### Multi-Sheet Excel Export
Generate an `.xlsx` workbook with separate sheets (Metadata, Summary, Goals, BMPs, Implementation, Monitoring, Outreach, Geography) from an existing Silver report:
```bash
node backend/scripts/exportExcel.js <reportId>
```
Default output: `backend/data/gold/<reportId>.xlsx`

Custom output path:
```bash
node backend/scripts/exportExcel.js <reportId> ./exports/<reportId>-report.xlsx
```

If the Silver JSON is missing, run the process step first:
```bash
curl -X POST http://localhost:5200/process -H 'Content-Type: application/json' -d '{"id":"<reportId>"}'
```

Each sheet includes a header row (bold) and reasonable column widths; empty/null values are blank.

Metadata sheet fields include:
| key | description |
|-----|-------------|
| reportId | Report identifier (slug) |
| exportedAt | Timestamp when Excel file generated |
| generatedAt | Original Silver generation timestamp (if present) |
| sourceFile | Original filename (if available) |
| goals.count | Count of goals |
| bmps.count | Count of BMPs |
| implementation.count | Count of implementation activities |
| monitoring.count | Count of monitoring metrics |
| outreach.count | Count of outreach activities |
| geographicAreas.count | Count of geographic area entries |

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

### Unified Dev Workflow (Auto Port Retry + Frontend Auto-Detect)

New streamlined workflow (root-level):
```
npm install        # installs backend + frontend via workspaces / or run both package installs manually
npm run dev        # starts backend first (tries 5200 → 5201 → 5202), then frontend
```

Behavior details:
- Backend default base port 5200 with up to 2 automatic incremental retries if ports are occupied.
- Backend binds using the platform default host (dual‑stack) so both IPv4 (127.0.0.1) and IPv6 (::1) localhost resolutions succeed (prevents Axios “Network Error” seen with prior mismatch).
- Frontend does NOT need a hard‑coded `REACT_APP_API_BASE`. It probes `/health` on ports 5200–5202 and latches onto the first 200 OK.
- You can still override with `REACT_APP_API_BASE=http://localhost:5201` if desired.

Manual backend only run (legacy):
```
cd backend
npm run dev
```

### Health & Diagnostics
- `/health` endpoint returns `{ status:"ok", timestamp }`.
- Startup self‑health checks probe both 127.0.0.1 and ::1 and log success/failure for early visibility.
- Frontend Debug Bar (top of UI) shows:
  * Live health status indicator (green/amber/red) with last latency ms.
  * Resolved API base URL.
  * “Re‑detect” button to force re‑probing ports if you restart/move backend mid‑session.
- CLI multi‑port probe script: `node backend/scripts/checkHealth.js` (prints status for 5200–5202).

### Deterministic Goal Slice & Truncation Guard
Historically, a critical long “ultimate goal” sentence risked truncation during heuristic segmentation. To harden against this:
1. A deterministic pre‑extraction slice captures a canonical goal segment directly from the bronze raw text (before heuristic passes) and injects it with a higher confidence score (0.95 vs heuristic ≤ 0.90).
2. Multi‑pass line joining & wrapped line merge heuristics still run, but the canonical slice serves as a safety net.
3. A regression test (`assertGoal.js`) asserts the full Dry Creek sentence remains intact (no mid‑sentence cutoff).

### Regression Scripts
Located under `backend/scripts/`:
| Script | Purpose |
|--------|---------|
| `reprocess.js` | Re-run bronze → silver for all bronze files & log first goal lines. |
| `assertGoal.js` | Asserts full canonical Dry Creek goal sentence is preserved. |
| `assertSyntheticGoal.js` | Uses a synthetic bronze fixture to validate pollutant + percentage phrase extraction. |
| `checkHealth.js` | Multi-port (5200–5202) health probe for quick diagnostics. |
| `assertBMPFallback.js` | Verifies BMP fallback heuristics (cost table + summary lines + refinement) capture expected BMP names. |

Run examples:
```
node backend/scripts/reprocess.js
node backend/scripts/assertGoal.js
node backend/scripts/assertSyntheticGoal.js
node backend/scripts/assertBMPFallback.js steele-bayou-watershed-plan-2009
node backend/scripts/assertBMPFallback.js steele-bayou-watershed-plan-2009 --expect "Ag BMP,Noxious Aquatics,Fisheries Management"
```
`assertBMPFallback` logic:
- Rebuilds Silver for the given report id.
- Uses provided `--expect` comma list OR default expectations keyed by known tricky reports (Ellison Creek, Steele Bayou).
- Fails (exit code 1) if any expected BMP names are missing; prints first 25 extracted BMP names and sources for debugging.

Integrate these into CI to fail builds on regressions in core goal extraction.

### Adding a New Regression Test
1. Drop a representative raw bronze JSON into `backend/data/bronze/` (structure mirrors existing examples).
2. Run `node backend/scripts/reprocess.js` to produce / refresh silver.
3. Author a new `assert<Something>.js` (pattern after existing scripts) targeting a distinctive invariant phrase.
4. Add an npm script alias (optional) and wire into CI.

### UI Enhancements (Goals Tab)
- Long goal sentences show a truncated preview (first ~22 words) with an Expand / Collapse toggle to preserve vertical space.
- Ensures very long canonical goal lines do not appear visually truncated or ambiguous during manual QA.
- Status filter chips (Completed / In Progress / Planned) with counts, parameter filter, search, and sorting (status, title, target value). Longest goal is flagged as canonical for quick reference.

### BMP Cost Table Extraction
If a PDF contains a cost estimate table (e.g. headed by a line containing "Cost Estimate" and rows with BMP names, size/amount, and currency values), the backend performs a heuristic parse:
1. Detects a window starting at the cost estimate header.
2. Identifies table-like lines (multiple spaces or tabs plus quantity or dollar patterns).
3. Infers columns (default fallback: `BMP`, `Size/Amount`, `Estimated Cost`).
4. Extracts rows into `bmpCostTable.rows` and a numeric `bmpCostTable.total` if a "Total Estimated Cost" line is present.

Returned structure (subset):
```jsonc
{
  "bmpCostTable": {
    "columns": ["BMP","Size/Amount","Estimated Cost"],
    "rows": [
      {"BMP":"Sediment Basin","Size/Amount":"2 each @ $6,250","Estimated Cost":"$12,500"},
      {"BMP":"Cover Crops","Size/Amount":"800 ac @ $73","Estimated Cost":"$58,400"}
    ],
    "total": 1973910
  }
}
```
Frontend renders this table above the BMP list when present. Future improvements can normalize numeric unit + cost fields and validate the reported total.

#### Normalized Cost Fields
The parser now derives a normalized structure (`bmpCostTableNormalized`) with per-row numeric fields:
```jsonc
{
  "bmpCostTableNormalized": {
    "rows": [
      {
        "name": "Sediment Basin",
        "rawSize": "2 each @ $6,250",
        "rawCost": "$12,500",
        "quantity": 2,
        "unit": "each",
        "unitCost": 6250,
        "totalCost": 12500
      }
    ],
    "totalReported": 1973910,
    "totalComputed": 1973910,
    "discrepancy": 0
  }
}
```
Fields:
- `quantity` / `unit` parsed from the portion before `@`.
- `unitCost` parsed after `@` dollar amount.
- `totalCost` taken from reported cost cell or computed (quantity * unitCost) if absent.
- `totalComputed` sum of row `totalCost` values.
- `discrepancy` = `totalReported - totalComputed` (only shown if absolute value > 1).

#### Unit Canonicalization
Cost table rows can express units with inconsistent variants (e.g. `ac`, `Acres`, `sq.ft.`). During normalization we retain the original token (`unitRaw`) and add a canonical reduced form (`unit`). The UI shows the canonical version with an asterisk if it differs; hover to see the original.

Current mapping (case-insensitive, punctuation stripped):
| Variants | Canonical |
|----------|-----------|
| each, ea | each |
| ac, acre, acres | acre |
| ft, feet, foot | ft |
| lf, linft, linear, linearft | linear_ft |
| sqft, sq.ft, sq.ft., sq ft, sq_ft, sq | sq_ft |
| yd, yds | yd |
| cy, cuyd, cu.yd | cu_yd |
| gal, gals, gallon, gallons | gal |
| mgd | mgd |
| mg/L, mg/l | mg_per_l |
| tpy | tpy |

Unrecognized units fall back to a sanitized lowercase token (alphanumeric + underscore). Extend `canonicalizeUnit` in `backend/services/reportBuilder.js` to add new mappings (consider: `km`, `m`, `lbs`, `tons`, `cu_ft`). When adding a new mapping also document it here to keep downstream analysts aligned.

Data fields recap:
- `unitRaw`: original extracted token (may include punctuation/pluralization).
- `unit`: canonical mapping target used for aggregation.

Analytical guidance: Group / pivot using `unit`, but keep `unitRaw` for audits and to identify emerging variants worth folding into the canonical set.

#### BMP Fallback Detection (Cost Table & Summary Lines)
Some plans list BMPs only inside a cost estimate table or in a financial summary (e.g., lines like `Ag BMP $3,803,456`). To avoid missing these when the narrative BMP section is sparse, the pipeline applies two fallback heuristics after the primary `extractBMPs` pass:

1. Cost Table Injection: If a parsed `bmpCostTable` exists, each first-column row (excluding subtotal / administrative rows such as Technical Assistance, Monitoring, Education, Project Management, Total) is added as a BMP if its name is not already present.
2. Dollar Summary Lines: When fewer than 3 BMPs were found initially, scan all section lines for patterns `^<Capitalized Phrase> $<amount>` (minimum 4 digit amount). Each match becomes a BMP (skipping the word `Total`). Basic category inference applies (Agriculture, Aquatic, Invasive Species) via keyword fragments.

Injected BMPs receive:
- `source` of `cost_table_row:<name>` or `summary_line:<original line>`
- Conservative confidence (0.25–0.30) so downstream ranking can distinguish heuristic vs narrative-derived items.
- Re-sequenced IDs after augmentation (B1..Bn) to keep ordering stable.

Confidence Promotion: If the same BMP name is found in BOTH a cost table row and a dollar summary line, its `source` field concatenates both tags (e.g. `cost_table_row:Cover Crops|summary_line:Cover Crops $58,400`) and its confidence is elevated to at least 0.60 (capped at 0.90) to reflect multi-source corroboration.

#### Granular BMP Category Refinement
After primary + fallback BMP assembly, a secondary name-based classifier upgrades broad categories to more analytical buckets. Ordered pattern checks (first match wins):

| Pattern (regex fragment) | Category |
|--------------------------|----------|
| `cover\s+crops?` | Cover Crops |
| `grassed\s+waterway` | Erosion Control |
| `sediment basin|sedimentation basin|grade stabilization|terraces?|diversions?` | Structural Erosion |
| `pond\b|stormwater pond|detention|retention` | Stormwater |
| `streambank|shoreline|bank stabilization|riprap|revetment` | Streambank Stabilization |
| `heavy use area protection|livestock|tank/trough|trough|watering facility` | Livestock Management |
| `fencing` | Fencing |
| `forage.*biomass planting|biomass planting|forage planting` | Forage & Biomass |
| `aquatic|fisheries? management|fish habitat` | Aquatic Habitat |
| `invasive|noxious` | Invasive Species |
| `ag\s*bmp|agric|agriculture` | Agriculture |

When a refinement occurs:
- `category` is replaced
- `confidence` boosted by +0.10 (max 0.95)
- `source` appended with `category_refine`

Extend this list in `reportBuilder.js` (`categorizeBMPName`) as new patterns are observed. Keep order-specific (specific first, general last) to avoid premature broad matches.

This improves recall for cases like Ellison Creek and Steele Bayou where BMPs might otherwise be absent from a dedicated section.

### Troubleshooting Quick Reference
| Symptom | Likely Cause | Action |
|---------|--------------|--------|
| Axios Network Error on upload | IPv4/IPv6 mismatch (old host binding) | Ensure you are on the updated backend (dual‑stack) & refresh frontend; use root `npm run dev`. |
| Frontend stuck “probing ports” | Backend not started or all three ports blocked | Start backend; free ports; run `node backend/scripts/checkHealth.js`. |
| Missing long goal sentence | Regression in deterministic slice or test not run | Execute `assertGoal.js`; inspect `reportBuilder.js` deterministic slice block. |
| Wrong API base after backend restart | Cached detection | Click “Re‑detect” in Debug Bar or call `forceRedetect()` in console. |

---


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

## Version & Build Metadata

The backend now exposes a lightweight `/version` endpoint for deployment observability.

Example response:
```json
{
  "service": "pdf-extractor-backend",
  "version": "1.0.0",
  "commit": "a1b2c3d",
  "buildTime": "2025-10-06T13:22:41Z",
  "node": "v20.11.1",
  "env": "production"
}
```

Fields:
- `service`: Static identifier.
- `version`: From `backend/package.json`.
- `commit`: Optional short git SHA (set in environment).
- `buildTime`: Optional ISO build timestamp.
- `node`: Running Node.js version.
- `env`: `NODE_ENV` value.

### Adding Commit & Build Info
Populate two environment variables at build or release time:
```
GIT_SHA=$(git rev-parse --short HEAD)
BUILD_TIME=$(date -u +%FT%TZ)
```
On Windows PowerShell (example):
```powershell
$env:GIT_SHA = (git rev-parse --short HEAD)
$env:BUILD_TIME = (Get-Date).ToUniversalTime().ToString('s') + 'Z'
```
Ensure your process manager (PM2, Dockerfile, GitHub Actions workflow, etc.) exports them before starting the server. They are optional; absence yields `null` for those fields.

### Health vs Version
- `/health` is intended for liveliness probes; fast and minimal.
- `/version` is stable metadata for release verification, cache busting, and attaching build provenance to logs.

### Suggested CI Step (GitHub Actions Snippet)
```yaml
    - name: Set build metadata
      run: |
        echo "GIT_SHA=$(git rev-parse --short HEAD)" >> $GITHUB_ENV
        echo "BUILD_TIME=$(date -u +%FT%TZ)" >> $GITHUB_ENV
    - name: Start backend
      env:
        GIT_SHA: ${{ env.GIT_SHA }}
        BUILD_TIME: ${{ env.BUILD_TIME }}
      run: node backend/server.js &
    - name: Verify version endpoint
      run: |
        sleep 3
        curl -s http://localhost:5200/version | jq '.'
```

### Quick Manual Check
```bash
curl -s http://localhost:5200/version | jq '{version,commit,buildTime,node}'
```

If you redeploy rapidly and want clients to bust caches for static assets, you can include `?v=<commit>` query params in frontend script tags using the same `GIT_SHA`.

