# Phase15 evidence inventory and evaluation plan

Baseline: main at8753cfb; no tracked edits, six existing audit/validation scratch files
preserved. Full tracked SHA256 inventory saved under ignored build_phase15 before edits.
No engine, backend, client, API or historical measurements are to change.

| Source | Schema / status | Evaluation use and limits |
|---|---|---|
| data/experiments/phase9_controlled/runs.jsonl | Tracked experiment_result schema1,128 successful records,64 pairs | Primary comparable corpus: four profiles x budgets16/24 x seeds42/101 x four repeats x two strategies; effective config, fingerprints, whole-run metrics and histogram p50/p95 bounds |
| Same directory plan.json, attempts/, summary.json and CSV exports | Tracked immutable attempt envelopes and derived statistics | Verify identity/provenance and regenerate descriptive summaries; retain all runs and report any failures |
| data/experiments/phase8_initial_seed42/ | Tracked30 runs; five profiles,seed42,three repeats/strategy | Earlier reclamation-oriented corpus; do not mix with Phase9 cells or infer pressure relief |
| client/test-results/comparison.json and comparison-evidence.json | Ignored local Phase13 descriptive pair/export | UI integration evidence only; concurrent execution, no CLI checksums/executable provenance |
| build_phase14/stress-hour-final.jsonl and hour-validation-resume.json | Ignored local JSONL and audit;207 batches, original hour complete | Sustained repeated adaptive execution/drains; not a controlled fixed/adaptive comparison |
| build_phase14/stress-rate-reviewed.jsonl | Ignored local bounded burst | Separate achieved-throughput stress observation; do not substitute for hour throughput |
| docs/PHASE14_COMPLETION_REPORT.md and linked CI | Tracked report plus remote execution | Scope-qualified integration, sanitizer/platform and limitations evidence |

Plan: read actual models/metric code; create a read-only Phase9 analysis/plot script using
installed matplotlib, export figure data and hashed manifest under data/plots. Generate
throughput by workload/budget, per-run p50/p95 histogram bounds, and final logical budget
allocation plus occupancy/capacity-time utilization. No p99/exact percentile or process
memory chart is supported. Show all128 observations, n8 per strategy/cell, descriptive
sample SD where used, no trimming or significance claims.

Deliver a self-contained FINAL_REPORT.md,15-slide VIVA_PRESENTATION.md with narration,
VIVA_DEMO_GUIDE.md with commands/fallback/Q&A, and a bounded demo script reusing existing
real integration/browser workflows. Dry-run includes real fixed/adaptive launch, result,
resize, comparison, URL/history, export and cancellation plus owned-service cleanup.
Validate plotting with meaningful malformed/mismatch tests, inspect all generated PNGs,
audit tables against source, check relative Markdown links, then mark roadmap complete
only after evidence passes. Do not rerun the Phase14 hour or modify its historical report.
