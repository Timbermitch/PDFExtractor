# Validation Framework

This folder contains the accuracy evaluation tooling for extracted reports.

## Gold Data Format
Create one `.gold.json` per report inside `gold/` with the following shape:

```jsonc
{
  "reportId": "watershed-plan-2024", // should match silver id
  "goals": ["Reduce sediment by 30%", "Install 5 rain gardens"],
  "bmps": ["Rain garden", "Bioswale"],
  "activities": ["Install sediment trap", "Public outreach workshops"],
  "metrics": ["Sediment load 250 mg/L", "Nitrate 0.5 mg/L"]
}
```

Only provide arrays you want evaluated; missing arrays are skipped.

## Running
The script `evaluate.js` will:
- Load each gold file
- Load corresponding silver JSON from `data/silver/<reportId>.json`
- Normalize & compare
- Compute precision, recall, F1 for each category (goals, bmps, activities, metrics)
- Compute quantitative metric value accuracy (exact value & unit match)
- Report false positives (items not in raw text based on `_present` flag) if available
- Summarize whether 90% thresholds are met

## Thresholds
Default thresholds (override via env vars):
- GOAL_MIN=0.9
- BMP_MIN=0.9
- ACTIVITY_MIN=0.9
- METRIC_MIN=0.9
- METRIC_VALUE_TOLERANCE=0.01 (relative tolerance for numeric comparison)

## Usage
```bash
node validation/evaluate.js
```
Optionally specify a single report:
```bash
node validation/evaluate.js --report watershed-plan-2024
```

Output: human-readable table + JSON summary file in `validation/results/`.
