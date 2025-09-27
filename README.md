# PDF Extraction Tool — Medallion Architecture Demo

A technical assessment implementation that ingests PDFs, extracts raw text (Bronze), normalizes & structures domain entities (Silver), and provides export-ready datasets & visualizations (Gold).

## Overview

| Layer | Purpose | This Project | Enterprise (Azure + Databricks Mapping) |
|-------|---------|--------------|-------------------------------------------|
| Bronze | Raw immutable ingestion | PDF bytes + raw extracted text stored as JSON in `backend/data/bronze/` | ADLS Gen2 landing zone, Databricks Auto Loader streaming ingestion into raw Delta tables |
| Silver | Cleansed & conformed schema | Regex + LLM classification -> `ExtractedReport` objects in `backend/data/silver/` | Delta Live Tables (DLT) transforming raw to curated Delta tables with expectations (quality gates) |
| Gold | Analytics-ready + BI serving | Aggregated / export endpoints -> JSON / CSV in `backend/data/gold/` | Databricks SQL endpoints, Power BI semantic models / dashboards |

## Features
- Upload PDF (multipart) -> extract text with `pdf-parse`.
- Section extraction (Goals, BMPs, Implementation, Monitoring, Outreach, Geography) via regex heuristics.
- Optional LLM (OpenAI) classification for ambiguous lines (uncategorized -> category).
- Transformation into `ExtractedReport` structure with summary metrics (completion rate, counts).
- Validation script comparing produced file vs golden reference (accuracy for Goals, BMPs, Monitoring metrics; zero false positives).
- Export structured data as JSON or CSV; listing endpoint.
- Ready for frontend dashboard (React + Recharts + Tailwind) for KPIs & charts.

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Health probe |
| POST | `/upload` | Accepts PDF (`file` field). Returns `{ id, rawText, metadata }` (Bronze) |
| POST | `/process` | Body: `{ id? , rawText? }` -> builds structured report (Silver) |
| GET | `/export/:id?format=json|csv` | Export report (Gold) |
| GET | `/reports` | List available processed report summaries |

### Example Flow
1. `POST /upload` (multipart) -> receive Bronze ID.
2. `POST /process` with `{ id: <bronzeId> }` -> structured report saved to Silver.
3. `GET /export/<id>?format=csv` -> downloadable CSV (also persisted to Gold).

## Data Schema (`ExtractedReport`)
```ts
interface ExtractedReport {
  summary: {
    totalGoals: number;
    totalBMPs: number;
    completionRate: number; // 0..1
  };
  goals: { id: string; title: string; status: 'completed'|'in_progress'|'planned'; }[];
  bmps: { id: string; name: string; category: string; }[];
  implementation: { id: string; description: string; date: string|null; }[];
  monitoring: { id: string; metric: string; value: number|null; }[];
  outreach: { id: string; activity: string; audience: string; }[];
  geographicAreas: { id: string; area: string; }[];
  generatedAt: string;
  metadata?: { sourceId?: string; sourceFile?: string };
}
```

## Validation
- Script: `node backend/validation/validate.js <producedFile> [goldenFile]`
- Metrics: Accuracy (Goals, BMPs, Monitoring) ≥ 0.90, False Positives = 0.
- Exits with code `2` if thresholds not met (usable in CI).

### Sample Command
```bash
node backend/validation/validate.js backend/data/silver/<your-id>.json
```

## Environment Variables
Create `backend/.env` from `.env.example`:
```
OPENAI_API_KEY=sk-...
PORT=4000
NODE_ENV=development
LOG_LEVEL=info
```
If `OPENAI_API_KEY` is absent, classification step is skipped gracefully.

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

## Frontend (Planned)
- React + TypeScript + Tailwind.
- Drag-and-drop upload (react-dropzone) with raw text preview.
- Process button triggers `/process`.
- Dashboard: Goals completion rate gauge, BMPs category bar chart, Implementation timeline, Monitoring & Outreach tables.
- Export button (CSV / JSON) using `/export` endpoint.

## Medallion Value
Separating raw vs curated vs serving layers reduces reprocessing risk, enables schema evolution, and aligns compute cost with data refinement stage. This demo compresses that lifecycle into a clear, inspectable file hierarchy.

## License
MIT (adjust as needed).
