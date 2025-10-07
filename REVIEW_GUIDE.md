# Code Review Guide – PDFExtractor

Date: 2025-10-08
Repository: PDFExtractor (Node.js / Express backend + lightweight embedded UI)
Live Demo: https://pdf-extractor-o2bx.onrender.com
Health: https://pdf-extractor-o2bx.onrender.com/health
Version: https://pdf-extractor-o2bx.onrender.com/version
Diagnostics: https://pdf-extractor-o2bx.onrender.com/__diag

---
## 1. High-Level Architecture

Layered (Bronze → Silver → Gold) data processing pipeline:
- Bronze: Raw PDF upload and text extraction persisted as JSON (`backend/data/bronze/<id>.json`).
- Silver: Structured extraction (Goals, BMPs, Implementation, Monitoring, Outreach, Geography, Cost Tables) into `backend/data/silver/<id>.json`.
- Gold: On-demand export artifacts (JSON/CSV/XLSX) in `backend/data/gold/`.

Key modules:
- `backend/server.js` – Express server, static + API routes, diagnostics.
- `backend/routes/*.js` – Upload, process, list, export, report detail, summary/metrics.
- `backend/services/` – Parsing & extraction (sectioning, report building, cost pattern registry, classifier integration).
- `backend/services/patterns/` – Cost table pattern definitions & heuristics.
- `backend/utils/errorHandlers.js` – Standardized error & 404 handling.
- `backend/frontend/` – Embedded no-build UI (upload → process → tabbed report explorer).

Optional AI Classification: `backend/services/classifier.js` (OpenAI) – gracefully skipped if `OPENAI_API_KEY` is not set.

---
## 2. Build & Run Locally

Prereqs: Node.js 20.x, npm.

```
# Clone
git clone <repo-url>
cd pdfextractor

# Install backend deps
cd backend
npm install

# Start server (default port 5200)
node server.js
```

Open: http://localhost:5200

Run a simple flow (PowerShell-friendly single lines):
```
# Upload a PDF
curl -F "file=@test.pdf" http://localhost:5200/upload

# Process it (substitute returned id)
curl -X POST http://localhost:5200/process -H "Content-Type: application/json" -d '{"id":"<id>"}'

# List reports
curl http://localhost:5200/reports
```

Embedded UI: Visit root URL → use Upload & Process buttons, then open reports with tabbed view.

---
## 3. Key API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Liveness JSON |
| GET | /version | Build metadata (git SHA if env provided) |
| POST | /upload | Multipart PDF (field `file`) → Bronze JSON |
| POST | /process | `{ id }` or `{ rawText }` → Silver JSON persisted |
| GET | /reports | List of processed reports (summaries) |
| GET | /report/:id | Full structured Silver report |
| GET | /export/:id?format=csv|json | Gold export (persists artifact) |
| GET | /reports/summary | Aggregated cost pattern metrics (if generated) |
| GET | /__diag | Runtime diagnostics (static detection, env, route sample) |

---
## 4. Data Structures (ExtractedReport – abbreviated)
```
{
  id: string,
  summary: { totalGoals, totalBMPs, goalStatus:{...}, bmpCategories:{...}, ... },
  goals: [{ id, title, status, pollutant, reductionPercent, confidence, ... }],
  bmps: [{ id, name, category, quantity, unit, totalCost?, source }],
  implementation: [...],
  monitoring: [...],
  outreach: [...],
  geographicAreas: [...],
  bmpCostTables / bmpCostTablesNormalized: [...],
  generatedAt: ISO8601,
  metadata: { sourceId?, sourceFile?, presence? }
}
```
Each entity retains a `source` link for audit.

---
## 5. Cost Table Pattern System
- Located in `backend/services/patterns/`.
- `parseCostTablesWithPatterns` orchestrates pattern attempts.
- Patterns expose `headerTest()` and `parse()` returning `{ table, normalized }`.
- Multi-pass merging for repeated pattern variants (e.g., implementation plan budget consolidation).

Diagnostics fields stored in normalized output: `patternId`, `patternConfidence`, `totalReported`, `totalComputed`, `discrepancy`.

---
## 6. Error Handling & Logging
- Central error handler returns `{ error: message }` with appropriate HTTP status.
- /process route includes a detailed `diag.steps[]` array on failure (id, classification, report build stages).
- Startup logs static directory detection & route enumeration for deployment verification.

---
## 7. Security & PII Notes
- No credentials or secrets stored in repo.
- OpenAI key (optional) only used if present in environment variables (not committed).
- Uploaded PDF text stored locally (demo context); production should use secured object storage + encryption at rest.

---
## 8. Testing / Validation Hooks
- Regression & audit scripts under `backend/scripts/` (goal assertion, cost coverage, BMP fallback assertions, etc.).
- Snapshot and coverage audits produce JSON artifacts to track extraction stability.
- Minimal automated tests; future step: integrate Jest + CI gating on coverage & discrepancy thresholds.

---
## 9. Deployment (Render)
- Live service is a Render Web/Docker deployment exposing port 5200.
- Fallback inline HTML replaced automatically when `backend/frontend/index.html` exists.
- Optional environment metadata: `GIT_SHA`, `BUILD_TIME` shown in `/version`.

---
## 10. Reviewer Focus Pointers
1. `reportBuilder.js` (large file): correctness of parsing heuristics & pattern integration.
2. Resilience: graceful fallbacks when patterns or classification fail.
3. Security: multipart handling (no arbitrary file writes beyond intended directories).
4. Cost pattern normalization math (totals vs computed) & discrepancy logic.
5. Potential refactors: split reportBuilder into cohesive modules (goals, bmp, cost tables) for maintainability.

---
## 11. Known Limitations / Next Steps
- Limited automated tests; rely on scripts + manual inspection.
- Some heuristic confidence scores are static; could benefit from data-driven calibration.
- No authentication / RBAC.
- Embedded UI is minimal; full React app (already in repo under `frontend/`) can be re-enabled for richer visualization.
- Large `reportBuilder.js` ( >1000 lines ) should be modularized.

---
## 12. How To Reproduce A Full Flow From Raw PDF
1. Place a PDF in the local directory.
2. `curl -F "file=@your.pdf" http://localhost:5200/upload` → note `id`.
3. `curl -X POST http://localhost:5200/process -H "Content-Type: application/json" -d '{"id":"<id>"}'`.
4. Inspect `backend/data/bronze/<id>.json` & `backend/data/silver/<id>.json`.
5. Optional: `curl http://localhost:5200/export/<id>?format=csv`.
6. View UI at `http://localhost:5200` and open the report tabs.

---
## 13. Minimal Dependency Footprint
Primary backend runtime deps (see `backend/package.json`): express, morgan, cors, dotenv, pdf-parse, openai (optional). No heavy compiled modules.

---
## 14. Contact
Maintainer: Matthew (provide preferred email/Slack if desired)

---
This guide is intentionally concise to accelerate code review and highlight the core moving parts.
