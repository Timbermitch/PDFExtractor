# Extraction Logic & Pipeline Architecture

This document explains the full end‑to‑end logic used to ingest PDFs and derive structured watershed report data (Goals, BMPs, Activities, Monitoring Metrics, Cost Tables) along with filtering, normalization, and quality safeguards.

## High-Level Flow
1. Upload (`/upload` – `routes/upload.js`)
   - Multer in‑memory receives PDF.
   - Primary parse via patched `pdf-parse` (`services/pdfParsePatched.js`); fallback to pdfjs (`services/pdfText.js`).
   - Raw text + metadata persisted to `data/bronze/<id>.json`.
2. Process (`/process` – `routes/process.js`)
   - Loads Bronze raw text (or uses provided `rawText`).
   - Sectionization (`services/sectionExtractor.js`): Locates headings & thematic anchors to carve text into arrays (Goals, BMPs, Implementation, Monitoring, Outreach, Geography, Additional Narrative). Multiple heuristics: exact header regex, fuzzy fallback tokens, and recovery for noisy capitalization.
   - Structured assembly (`services/reportBuilder.js`): Delegates to `enhancedExtractors.js` then enriches, normalizes and optionally filters collections. Adds cost table parsing + metrics.
   - Optional BMP filtering (`services/bmpFilters.js`) when `BMP_FILTER=1` for false-positive suppression.
   - Cost table pattern detection (`services/patterns/costTablePatterns.js`) with multi-pattern registry and adaptive fallbacks.
   - Final `ExtractedReport` written to `data/silver/<id>.json`.
3. Export (`/export/:id`) or listing/report analytics endpoints consume Silver layer to derive Gold outputs.

## Core Modules
| Module | Responsibility |
|--------|----------------|
| `sectionExtractor.js` | Split raw text into semantically labeled sections. |
| `enhancedExtractors.js` | Fine-grained line classification for Goals, BMPs, Activities (Implementation), Monitoring, Outreach, Geography. |
| `reportBuilder.js` | Orchestrates extraction, normalization, cost table parsing, BMP fallback augmentation, summary metrics, optional filtering, confidence scoring. |
| `bmpFilters.js` | Rule engine for flagging/removing noisy BMP lines; returns reasons + confidence. |
| `patterns/costTablePatterns.js` | Pattern registry: declarative identification + parsing of multiple cost table formats (Booths Creek, Bell Creek, Implementation Plan, etc.). |
| `regexRules.js` | Centralized reusable regular expressions (pollutant terms, numeric patterns, date heuristics). |
| `classifier.js` | (Optional) LLM / heuristic hybrid scaffolding for advanced future classification. |

## Section Extraction Highlights (`sectionExtractor.js`)
- Multi-pass heading detection: strict anchors (e.g., `^Goal`), tolerant case-insensitive matches, then heuristic expansion (lines with high uppercase ratio and colon endings).
- Recover missing sections by backfilling from narrative if explicit headers absent (e.g., scanning for bullet-style goal sentences starting with action verbs + pollutant keywords).
- Produces an object: `{ Goals:[], BMPs:[], Implementation:[], Monitoring:[], Outreach:[], Geography:[], Narrative:[] }`.

## Enhanced Entity Extraction (`enhancedExtractors.js`)
### Goals
Heuristics:
- Action verb + pollutant / percentage / reduction phrase detection: `(reduce|decrease|improve|restore)` + pollutant token (from `POLLUTANT_TERMS`).
- Quantity normalization: Parse leading or trailing numeric `%`, mass/area units (acres, mg/L) and store as `targetValue` + `unit` when unambiguous.
- Status inference: pattern matching (`completed`, `in progress`, `ongoing`, `planned`, `proposed`). Defaults to `planned` if future-tense constructs or no indicators.

### BMPs
Layers:
1. Primary list section tokens (lines with BMP style formatting / bullet markers).
2. Cost table injection: first column of recognized cost tables (excludes admin/support rows: Technical Assistance, Monitoring, etc.).
3. Dollar summary fallback: lines shaped like `Name $123,456` when primary pass yields <3 BMPs.
4. Category inference: keyword-driven mapping (e.g., `streambank|shoreline` → Streambank Stabilization; `cover crops` → Cover Crops).
5. Refinement pass re-categorizes broad `General` items with ordered specific regex patterns.

### Implementation Activities
- Looks for temporal markers (years), verbs (install, construct, implement), and target vs achieved patterns (`Target:` / `Achieved:` / `Goal:` segments).
- Parses numeric targets and achievements; produces `ImplementationActivity` entries with normalized numeric fields.

### Monitoring Metrics
- Captures metrics with numeric + unit patterns (e.g., mg/L, %, acres) or explicit monitoring vocabulary (turbidity, sediment load, TSS, DO).
- `value` null when numeric not confidently parsed to avoid false precision.

### Outreach & Geography
- Simple heuristics: phrases with audience markers (public, school, community) and named geographic areas (creek, reach, sub-basin, HUC codes) respectively.

## Cost Table Parsing
### Pattern Registry
`parseCostTablesWithPatterns()` iterates ordered pattern objects:
```
{
  id: 'implementation_plan_coded_budget',
  headerTest(line, allLines, idx) -> boolean,
  parse(allLines, startIndex) -> { table, normalized }
}
```
Each pattern returns:
- Raw table snapshot (`columns`, `rows`, `total`).
- Normalized rows: structured with numeric `quantity`, `unit`, `unitCost`, `totalCost`.
- Metadata: `patternId`, `patternConfidence` (0..1), `totalReported`, `totalComputed`, `discrepancy`.

### Merging & Consolidation
If multiple Implementation Plan budget fragments appear, a merge pass consolidates them into a synthesized `implementation_plan_coded_budget_merged` representation (deduplicating by code|section, summing amounts) to avoid overcounting.

### Heuristic Fallbacks in `reportBuilder.js`
For legacy / irregular formats not covered by explicit patterns (Bell Creek, Steele Bayou etc.), specialized inline parsers execute (see large switch in `parseCostTable`). They reconstruct domain-specific interpretations (e.g., multi-line Practice headers, Activity + Match tables) and produce normalized rows with discrepancy calculations.

### Discrepancy & Integrity Checks
- `discrepancy = totalReported - totalComputed` when both present.
- Negative totals or extremely high per-row unit costs flagged upstream (filtering hook ready; not all thresholds enforced yet).
- Weighted totals: downstream metrics can multiply `totalComputed * patternConfidence` for conservative sum.

## BMP Filtering (`bmpFilters.js`)
Activated via `BMP_FILTER=1`.
Rules (examples):
- Reject overly generic lines (length < 4 tokens AND lacks strong BMP keyword).
- Reject lines dominated by stopwords or administrative phrases (e.g., `project management`, `education/outreach` if already categorized separately) unless cost table corroboration present.
- Reject duplicates (case-insensitive name collisions) keeping highest-confidence source (cost table > narrative > summary line).
- Reject lines with >65% numeric/dollar/percent tokens (likely cost summary rather than a BMP name) unless whitelisted.
Outputs per rejected item:
```
{
  name, source, rejectPrimary, rejectReasons:[...], flags:{ short:true, admin:true }, confidenceBefore, confidenceAfter
}
```
Retained BMPs may have `confidence` adjusted upward if corroborated by multi-source detection.

## Confidence Model (Lightweight)
- Base confidence tiers: narrative (0.55), cost table injection (0.50), summary line fallback (0.30).
- Multi-source merge raises to 0.70 (capped 0.90 after category refinement).
- Category refinement (+0.10) if specific regex pattern matches.
- Filtering demotions: borderline lines drop by 0.1 before potential rejection.

## Summary Metrics
Computed in `reportBuilder.js`:
- Goal status distribution + completion percentages.
- BMP category counts.
- Totals: goals, BMPs, activities, monitoring metrics.
- Cost pattern usage metadata array (patternId, confidence, totals) for cross-report summary endpoint.

## Traceability & Auditability
- Every entity retains its original `source` raw line (or synthetic provenance tag like `cost_table_row:<name>`).
- Normalized cost rows include both raw textual cells and parsed numeric fields for reproducibility.
- Filtering retains `bmpRejected` array when active for diagnostic diffing.

## Error Handling & Resilience
- PDF parsing gracefully downgrades to pdfjs fallback to handle unusual encodings.
- Section extraction failures (empty sets) produce valid but minimal Silver JSON objects (arrays empty, metrics zeroed) to avoid pipeline halts.
- All filter and pattern parsing wrapped in try/catch blocks that swallow non-fatal errors (logged) to favor forward progress.

## Large PDF Considerations
- Current upload uses memory storage (Multer). For >100MB pipelines or memory-constrained serverless platforms, migrate to disk or streaming parser variant. See `DEPLOYMENT.md` recommendations.

## Extensibility Hooks
- Add new cost table pattern: extend array in `patterns/costTablePatterns.js` (ordered; more specific first).
- Add new BMP category: update refinement regex sequence in `reportBuilder.js` (`categorizeBMPName`).
- Introduce ML classification: implement hybrid scoring in `classifier.js` with fallback to current heuristics if model absent.

## Known Limitations / Future Work
| Area | Limitation | Planned Mitigation |
|------|------------|--------------------|
| Unit Inference | Some composite units (e.g., ft² / linear ft combos) normalized loosely | Expand tokenization + context window scoring |
| Cost Table Confidence | Confidence static per pattern | Derive from row parse success + discrepancy magnitude |
| BMP Over-Merge | Similar synonyms not deduped (e.g., "streambank stabilization" vs "bank stabilization") | Fuzzy name hashing (Levenshtein threshold) |
| Monitoring Value Parsing | Only first numeric extracted | Multi-value line splitting with labeled sub-metrics |
| Memory Upload | In-memory buffer for very large PDFs | Streaming / chunked parse pipeline |

## Data Artifacts
| Layer | Directory | Notes |
|-------|-----------|-------|
| Bronze | `data/bronze` | Raw PDF text + metadata (immutable) |
| Silver | `data/silver` | Structured `ExtractedReport` JSON |
| Gold | `data/gold` | Exports (CSV/JSON/XLSX) + aggregations |
| Diagnostics | `backend/audit_*.json` | Coverage, cost audits, diffs |

## Minimal Extraction Contract
Input: Raw PDF bytes.
Output: `ExtractedReport` with non-null `summary` fields; arrays (possibly empty) with each item containing at minimum an `id` and original `source` (except synthesized cost-derived BMPs which include synthetic provenance in `source`).

## Footnotes
- All numbers in discrepancies are raw (not percentage); compute relative delta externally when needed.
- Pattern merge ensures one logical Implementation Plan table to prevent double counting.

---
This document should be updated whenever new pattern families, filtering rules, or confidence heuristics are introduced.
