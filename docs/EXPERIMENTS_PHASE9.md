# Phase 9 workflow, recovery and controlled experiments

## Supported matrix

The existing C++ experiment runner and Phase6/7 controller/executor algorithms are unchanged. The Python driver extends the Phase8 invocation with --grid, --max-runs, --limit-cells, --plan-only and --resume. Only existing engine options are exposed. A grid JSON has nonempty, duplicate-free integer arrays for budgets, requests, metrics_interval_ms and metrics_window_ms. Omitting a dimension uses the corresponding existing CLI value (or source budget/count). Unknown dimensions and invalid Cartesian combinations are rejected. A request override applies to EVERY stream; omit it when using zero-request idle donors.

```json
{"budgets":[16,24],"metrics_interval_ms":[20],"metrics_window_ms":[100]}
```

Field expansion order is fixed; source-config/value/seed order follows supplied lists. Complete pair blocks alternate strategy execution order. --limit-cells selects a deterministic prefix of complete parameter/configuration cells; --max-runs (default10000) rejects excessive selected matrices before creating output or launching children. The full and selected cell counts and planned run count are displayed and saved. Min/max capacity and existing timeout flags remain supported. Controller settings and producer/service rates are configured only through existing supported mechanisms; this phase uses unchanged controller defaults and explicit source workload profiles, not invented CLI fields.

plan.json is saved before any simulation starts. Configuration IDs bind source contents/settings/limits, pair IDs bind configuration/seed/repetition/executable, run IDs add strategy, and plan_id covers the full ordered plan/provenance. SHA256 provenance includes executable, configuration sources and workflow/export helper source files. FNV64 nominal-input fingerprints remain noncryptographic checksums, independently verified by the engine and compared between paired runs.

## Commands

```powershell
python scripts/run_experiments.py --exe build_phase9/experiment_runner.exe --configs configs/phase9_reclamation.json configs/phase9_backpressure.json configs/phase9_balanced.json configs/phase9_heterogeneous.json --grid configs/phase9_grid.json --seeds 42 101 --repetitions 4 --max-runs 128 --output data/experiments/phase9_controlled --plan-only
# Same arguments and output, adding --resume and removing --plan-only:
python scripts/run_experiments.py --exe build_phase9/experiment_runner.exe --configs configs/phase9_reclamation.json configs/phase9_backpressure.json configs/phase9_balanced.json configs/phase9_heterogeneous.json --grid configs/phase9_grid.json --seeds 42 101 --repetitions 4 --max-runs 128 --output data/experiments/phase9_controlled --resume
```

Use a NEW output directory for a new matrix. The historical Phase8 directory is read-only history and has no Phase9 plan/journal; it cannot be resumed as a Phase9 matrix. Old Phase8 CLI arguments remain accepted for new batches. No output migration or unsafe force-overwrite is provided.

## Authoritative records and safe resume

plan.json is immutable. attempts/<run_id>/<attempt>.json are immutable atomic attempt envelopes with plan/run identity, ordinal, raw record and SHA256 record checksum. A failed or malformed attempt is not deleted. Staging remnants remain auditable; fresh attempts use a new ordinal. runs.jsonl, summary.json and exports are derived views and can be regenerated after a torn/interrupted write. There is one latest record per run identity, so retries are not counted as extra statistical repetitions.

On --resume the requested ordered plan must match exactly, including hashes, source paths, options and workflow code. Resume validates complete successful schemas, identity/checksum bindings, effective source settings and seeds, initial equal allocations, fixed-capacity invariance, final physical/accounting agreement, budget, counts and finite measurements. Only validated completed successes are skipped. Missing, failed, malformed or incomplete results are retried. A mismatched stored pair invalidates its cached successes for retry. Unknown identities are rejected rather than silently merged. Manifest sessions and states.json distinguish planned/running/completed/failed/skipped and record executed/skipped IDs and recovery diagnostics.

Executable/config/workflow hashes are checked immediately before and after each child process. A drift aborts the batch; post-run drift is preserved as a failed attempt and excluded from statistics. This is practical provenance checking, not an adversarial file-lock/snapshot guarantee against edits that are made and restored entirely between checks.

A persistent .workflow.lock uses a native Windows byte lock or Unix flock and owner metadata. An active writer cannot be replaced even if metadata appears stale. Recovery of an abandoned owner is conservative: same-host/dead-PID checks plus the native lock must permit ownership; ambiguous or malformed metadata causes refusal. Windows process liveness uses query APIs, never a terminating os.kill call. Clean exit marks owner metadata released and releases the native lock. Callers must not edit/delete the lock file while a writer is active.

Atomic file writes flush/fsync then replace within the same directory. Windows sharing/access violations have a bounded six-attempt backoff (10,20,40,80,160ms); unrelated or persistent errors still fail and preserve the prior target and staged file. This is filesystem recovery outside simulation timers, not queue synchronization or an unbounded retry. Individual derived files are atomic, not an all-files transaction: resume regenerates a consistent set from authoritative attempts. No sudden-power-loss durability guarantee is claimed. A crash before plan/manifest creation or malformed owner metadata can require manual inspection/new output rather than unsafe reconstruction.

## Exports

All exports are derived atomically under the single-writer workflow lock:

| Artifact | Contents |
|---|---|
| runs.jsonl / raw_runs.csv | Every latest attempted run, including failed results; identity/configuration/status and numeric measurements |
| attempts/ / attempt_records.csv | Immutable attempt history, including superseded failures and malformed/staging diagnostics |
| summary.json / aggregate_statistics.csv | Per-config/strategy descriptive statistics, explicit success/failure counts |
| paired_comparisons.csv | Named paired differences versus differences of strategy means, separately labelled |
| results.json | Full plan, latest records, exported attempts, states and summary |
| units.json | Metric units, definitions and missing-value conventions |
| summary.md | Human-readable per-config/strategy results without significance claims |
| manifest.json / states.json | Environment, provenance, sessions, execution/recovery status |

CSV uses NA for unavailable values; JSON uses null. Nested effective configs are JSON strings in CSV. Counts of resize transactions are top-level fields, not pooled request events. Exact global peak utilization is unavailable; the largest individual stream peak and histogram quantile bounds retain their Phase8 definitions. Aggregate fields include mean/median/sampleSD/min/max/count, exclude failures but retain their counts, and group by config_id so different grid cells are not accidentally mixed. Seeds and repetitions remain in raw records; within-cell aggregate SD mixes seed and scheduling variation. No trimming rule is applied. Paired identity/nominal trace matching remains mandatory.

## Controlled cases and rationale

All four configs use existing deterministic request generation and consumer service timing; no core extension was needed. Active streams have80 requests each and payload bounds64..1024. Experiment seed overrides still map to base+100*sorted index. Zero-request donors stay idle because the evaluation omits --requests.

- phase9_reclamation: steady8ms arrival/0ms service active stream plus idle donor; observes low-pressure reclaim.
- phase9_backpressure: zero-interval producer/5ms service plus idle donor; should sustain queue-full waits and permit growth from reclaimed capacity.
- phase9_balanced: comparable2ms arrival/2ms service for both streams; a neutral/near-balanced control.
- phase9_heterogeneous: burst arrival8->0ms/service3ms, periodic10ms/service0ms, stochastic mean2ms/service3ms.

Requested sleeps are not guaranteed actual timings, particularly on Windows. Actual backpressure/reclamation must be verified from measured waits/capacities, not inferred from labels. Nominal traces are paired, while backpressure alters realized wall-clock arrival times. Buffers can trade producer waiting for queue latency without increasing a fixed-rate consumer's throughput. A physical resize is evidence of operation, not a benefit.

The controlled evaluation uses4 profiles x2 budgets x2 seeds x4 repetitions x2 strategies=128 runs (64 pairs),8 runs per strategy/configuration cell. This is broader than Phase8 but remains descriptive and small; no p-values/significance or universal superiority claims. Metrics20ms/100ms make observation windows meaningful within short80-request runs; controller thresholds/confirmations/cooldowns are unchanged and both strategies get identical sampling. There is no CPU pinning, timer-resolution manipulation, service-model change or outcome-driven tuning. Runtime budgets govern active logical slots; staging heap remains additional.

## Validation and next work

The Phase9 completion report records actual C++/Python counts, recovery pilots, provenance checks, CSV/JSON audits and measured outcomes. Phase8 reports/data are preserved unchanged. Source/plan relocation and code upgrades intentionally cause resume mismatch; no cross-version migration is implemented. Resume can separate paired runs in wall-clock time and weaken order balancing, so session times are recorded and those results must be interpreted with scheduling/environment variation in mind.

Next planned milestone: Phase10 Node.js backend bridge, using the existing native engine and versioned telemetry. Workflow extensions remain reusable for future multi-seed/contention studies; no dashboard/backend is introduced by this phase.
