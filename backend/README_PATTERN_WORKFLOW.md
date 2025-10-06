# Cost Table Pattern Workflow

This document explains how bulk ingestion + pattern-based cost table parsing works.

## Overview
Legacy cost table parsing relied on ad hoc branching inside `reportBuilder.js`. A pluggable registry now lives in `services/patterns/costTablePatterns.js` where each pattern defines:

- `id`: Unique string key
- `description`: Human-friendly summary
- `headerTest(line, allLines, index)`: Fast boolean test identifying a header line
- `parse(allLines, startIndex)`: Returns `{ table, normalized }`

The normalized object should include:
```
{
  rows: [...],
  totalReported: number|null,
  totalComputed: number|null,
  discrepancy: number|null,
  patternId: string,
  patternConfidence: number (0..1)
}
```
Additional fields (e.g., landownerMatchComputed) are allowed.

## Adding a New Pattern
1. Open `services/patterns/costTablePatterns.js`.
2. Append a new object to the `patterns` array following existing examples (e.g., `booths_creek_bmps`).
3. Keep parsing logic self-contained; *do not* mutate global state.
4. Prefer small regex groups and defensive try/catch around fragile extractions.
5. Return `null` if the header matches but rows cannot be parsed (prevents false positives).

## Deduplication
Pattern-parsed tables are inserted before legacy scanning. During legacy `tableStarts` processing, a dedup signature is computed using lowercase joined column headers; if a prior pattern produced the same signature and title, the legacy result is skipped.

## Bulk PDF Ingestion Flow
```
node scripts/fetch_mdeq_pdfs.js        # Downloads all watershed plan PDFs
node scripts/analyze_mdeq_pdfs.js      # Extracts candidate header contexts
# (Optional) run future audit script to list unmatched header variants
```
Review `data/interim/mdeq/*.analysis.json` to see header snippets and decide if a new pattern is needed.

## Pattern Confidence
Assign an initial static confidence (e.g. 0.85–0.95). In the future this can be upgraded to a scoring heuristic based on:
- Row count distribution
- Presence of expected money columns
- Percentage of lines matching row regex

## Testing Recommendations
Create a minimal fixture snippet (`.txt`) with just the relevant header + sample rows. A forthcoming regression script can feed that snippet into `parseCostTablesWithPatterns` to assert totals.

## Edge Cases & Guidance
- Split headers across multi lines: Use a lookahead window in `headerTest`.
- Missing totals: Accept `null` reported total; rely on computed sum.
- Negative or parenthetical values: Extend `moneyToNumber` if encountered.
- Multi-currency or units: Use `canonicalizeUnit` extension map.

## Migration Progress
Implemented patterns: booths_creek_bmps, phase1_bmps, activity_match, practice_costs, bell_creek_bmps, tech_assistance.

Remaining legacy generic fallback still handled in `reportBuilder.parseCostTable`.

## Future Enhancements
- `audit_cost_patterns.js` to auto-surface unmatched cost cue clusters.
- Automated regression tests per pattern.
- Confidence recalibration with metrics (precision of row parsing).
- Column normalization for cross-pattern analytics.

---
*Last updated: 2025-10-01*
