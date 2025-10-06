# Testing & Accuracy Validation

This document describes how extraction accuracy, regression safety, and quality signals are measured.

## Objectives
1. Guard against silent degradation in entity extraction (Goals, BMPs, Implementation Activities, Monitoring Metrics, Cost Tables).
2. Provide repeatable metrics (precision, recall, F1) against curated gold references.
3. Detect structural changes in cost table parsing (row counts, totals, discrepancies).
4. Surface anomaly classes (inflated BMP counts, empty-text PDFs, large discrepancies) early.

## Test Layers
| Layer | Purpose | Location |
|-------|---------|----------|
| Smoke | Basic router & health availability | `/health`, `/upload/smoke` |
| Functional | End-to-end Bronze → Silver build for sample PDFs | `backend/test/*.js` scripts |
| Cost Table Snapshot | Structural regression detection | `backend/test/fixtures/costTables/` |
| Coverage | Report-level presence of cost tables & entities | `audit_cost_coverage*.json` |
| Filtering Diff | Impact of BMP filtering heuristics | `bmp_filter_diff.json` |

## Scripts Overview
| Script | Command | Purpose |
|--------|---------|---------|
| Health Check | `npm run health` (backend) | Probe `/health` endpoint (multi-port logic external) |
| Build Sample Silver | `node scripts/test_mdeq_extraction.js` | Batch process MDEQ corpus with resume logic |
| Cost Snapshot | `npm run cost:snapshot` | Compare current normalized cost tables vs saved fixtures |
| Coverage Audit | `npm run cost:coverageAudit` | Produce coverage JSON + exit code gating thresholds |
| Silver Coverage | `npm run mdeq:coverage` | High-level Bronze/Silver progress stats |
| Filtered Subset Extraction | `node scripts/filtered_subset_extraction_one.js <reportId>` | Reprocess w/ filtering for targeted file |
| Filter Impact Diff | `node scripts/diff_bmp_filter_impact.js` | Compare baseline vs filtered BMP counts |
| Reports Summary Test | `npm run test:summary` | Validate cross-report aggregation endpoint |

## Gold References
The optional gold standard for evaluation resides under `backend/validation/gold/` (if created). Each gold JSON can list arrays: `goals`, `bmps`, `activities`, `metrics` representing reference canonical strings. Omitted arrays are ignored.

### Evaluation Script
`node backend/validation/evaluate.js [--report <id>]`
- Normalizes candidate vs gold strings: lowercase, trim, collapse whitespace, punctuation strip subset.
- Computes: `truePositive`, `falsePositive`, `falseNegative` per category.
- Metrics: `precision = TP/(TP+FP)`, `recall = TP/(TP+FN)`, `F1`.
- Numeric tolerance: For metrics with numeric values, relative error must be <= `METRIC_VALUE_TOLERANCE` (default 0.01) to count as match.
- Thresholds (env overrides): `GOAL_MIN`, `BMP_MIN`, `ACTIVITY_MIN`, `METRIC_MIN`.
- Exit code non-zero if any category falls below threshold.

## Cost Table Snapshot Testing
Goal: Ensure structural stability and detect unintended parsing changes.

Workflow:
1. Generate snapshot baseline: `npm run cost:snapshot -- --update` (after intentional improvements) – stores per-report compact signatures.
2. Future runs: `npm run cost:snapshot` – prints diffs (Added/Removed tables, row count changes, total deltas, hash mismatches).
3. CI gating: Fail on any unexpected diff (no `--update`).

Snapshot file schema (per report):
```
{
  reportId,
  tables:[ { id, patternId, rowCount, totalReported, totalComputed, hash } ],
  combinedHash
}
```
Hash algorithm: stable SHA1 over ordered row name + numeric totals to minimize false positives.

## Filtering Evaluation
`bmpFilters.js` outputs structured rejection reasons. The diff script `diff_bmp_filter_impact.js` computes:
```
{
  totalBefore, totalAfter, reductionPct,
  perFile:[{ id, before, after, delta }],
  reasonsAggregate: { reason -> count }
}
```
Success Criteria:
- Significant noisy BMP reduction (subset ~30–40% reduction).
- Zero legitimate goal loss (goal counts unaffected).

## Regression Guardrails
| Guard | Trigger | Action |
|-------|---------|--------|
| Goals truncated | Deterministic slice missing canonical long goal | Inspect section extractor; run `assertGoal.js` |
| BMP inflation spike | Single report BMP count > (median + 3*IQR) | Re-run with filter; inspect top sources | 
| Cost discrepancy surge | Pattern `pctWithin5pct` falls below historic baseline | Examine new pattern; run snapshot diff |
| Empty text PDF | Zero-length rawText after parse | Flag for OCR pipeline (future) |

## Manual QA Checklist
1. Upload a known multi-section PDF (with cost tables) – verify Goals, BMPs, Cost patterns present.
2. Upload a small PDF – verify no crash; empty categories acceptable.
3. Process twice – idempotent Silver output (except timestamp).
4. Export JSON & CSV – verify row counts match Silver arrays.
5. Toggle filtering (set `BMP_FILTER=1`) – verify reduction without category loss.

## Large PDF Handling
For very large PDFs (>50MB) confirm:
- Parse finishes within acceptable time (observed typical < 2s/page for complex docs).
- Memory: In-memory buffer acceptable for current scale (<100MB). For production serverless adaptation see `DEPLOYMENT.md` streaming notes.

## Adding New Tests
1. Create a bronze fixture and run process to generate Silver.
2. Add or update snapshot if cost tables affected.
3. (Optional) Author a gold reference JSON for new entity type phrase set.
4. Extend evaluation script threshold if new category introduced.

## Metrics Export
Future work: Expose `/metrics` endpoint with Prometheus format for:
- upload_duration_ms (summary)
- parse_fallback_total
- cost_table_discrepancy_bucket{bucket="<=5pct"}

## Summary
Testing blends deterministic snapshots, heuristic coverage audits, and optional gold benchmarks, yielding a layered approach that balances rapid heuristic iteration with regression safety.
