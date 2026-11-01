# Phase 9 completion report

## Status

Phase 9 is implemented, validated and evaluated. The controlled matrix completed128 successful runs and64 matched pairs, with no failed simulation runs. Backpressure and real physical reallocation/reclamation were measured. Phase6 controller and Phase7 runtime algorithms were not changed. Historical Phase8 raw measurements and measured/completion reports remain byte-for-byte unchanged.

## Architecture and features

The Python-standard-library driver extends the existing CLI with --grid, --max-runs, --limit-cells, --plan-only and --resume. Supported grid arrays are budgets, requests, metrics_interval_ms and metrics_window_ms; no unsupported controller/engine knobs were invented. Plans expand deterministically, retain complete pairs and save source/binary/helper hashes before launch.

Configuration/pair/run identities cover effective scientific parameters and provenance. Immutable checksummed attempt envelopes are authoritative. Resume skips only fully validated completed successes and retries missing, failed, malformed or incomplete results. Failed attempts remain preserved; derived views contain one latest record per identity to avoid counting retries as repetitions. Native file locking excludes concurrent writers. Pre/post subprocess checks detect source, executable or workflow changes. Atomic files preserve old targets on failure, with bounded recovery for transient Windows sharing violations.

Exports include raw_runs.csv, attempt_records.csv, aggregate_statistics.csv, paired_comparisons.csv, results.json, units.json and summary.md in addition to JSONL/plan/manifest/states. Failed and unavailable values remain explicit. Configuration-aware grouping prevents cross-grid mixing; paired changes are distinct from differences of strategy means.

## Files added and modified

Added:
- scripts/atomic_io.py: bounded atomic-replacement recovery.
- scripts/experiment_exports.py: loss-preserving CSV/JSON/Markdown exports.
- scripts/test_workflow_phase9.py and scripts/test_exports_phase9.py.
- configs/phase9_reclamation.json, phase9_backpressure.json, phase9_balanced.json, phase9_heterogeneous.json and phase9_grid.json.
- docs/EXPERIMENTS_PHASE9.md, PHASE9_EXPERIMENTAL_REPORT.md and this report.
- data/experiments/phase9_controlled/: plan, immutable128-attempt journal, manifest/session states, raw/summary/export artifacts and build metadata.

Modified: scripts/run_experiments.py, CMakeLists.txt (Python test registrations), .gitignore, README.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_ROADMAP.md and general docs/EXPERIMENTS_PHASE8.md cross-reference. No native engine source was modified in Phase9.

## Subagents and review

- p9_workflow implemented the bounded driver workstream, including identity/schema validation, native locks, journals, resume and provenance. All changes were reviewed before measurement.
- p9_tests independently authored25 workflow tests and reviewed malformed-cache, provenance and lock paths; all25 passed.
- p9_audit_cases audited the original workflow, designed four controlled profiles using existing fields, and independently reviewed final driver/export/helper code. Final acceptance review found no remaining blocker.
- Main orchestrator owned exports/shared I/O integration, build/tests, controlled evaluation, independent numeric recomputation, recovery verification and documentation. A later requested subagent statistics pass could not run because its usage limit was reached; numeric checks below are explicitly attributed to the orchestrator rather than that agent.

## Actual build and tests

Fresh GCC15.2.0 C++17 -O2 -Wall -Wextra -Wpedantic build completed without warnings. Assertions remained enabled. All existing nine suites executed successfully:

| Suite | Result |
|---|---|
| bounded_buffer |7 tests passed|
| simulation |5 tests passed|
| multi_stream |5 tests passed|
| resource_manager |9 tests passed|
| workload_generator |12 tests passed|
| metrics_engine |6 groups passed|
| adaptive_controller |7 groups passed|
| runtime_resizing |9 groups passed|
| experiment_runner |4 groups passed|

Python: nine existing experiment/statistics tests,25 new workflow tests and six export/atomic-I/O tests passed (40 total). Tests cover expansion/order/count/limits, Phase8 CLI compatibility, no-overwrite and plan mismatch, skip/missing/failure retry, preserved malformed/torn attempts, complete-schema/identity checks, executable/source/helper drift, native writer exclusion/dead-owner recovery, interrupted atomic writes, late-cell malformed-cache handling, CSV/JSON round trips, missing units/values and bounded Windows retries.

An actual pilot saved a plan, executed both strategies, measured positive producer waiting and physical growth, then repaired a torn derived cache with no reruns. After the full matrix, a second real recovery check skipped all128 completed runs, executed zero children, retained exactly128 attempt files and regenerated the original raw-byte SHA256 exactly. The original Phase8-style driver command and legacy text/completion-only JSON were also executed and passed.

Initial filesystem tests exposed transient Windows PermissionError during atomic replacement even with approved access. This was investigated and fixed with bounded targeted retries, not ignored; final tests all passed. Persistent errors still fail safely and preserve staged/previous data. Some filesystem fixtures required approved access outside sandbox restrictions.

CMake/CTest were not installed, so their updated registrations were not executed. A fresh GCC ThreadSanitizer probe failed to link with cannot find -ltsan. Ordinary concurrency tests are not a race-free proof. No CPU-overhead benchmark was performed.

## Executed matrix and measured outcomes

Four profiles x budgets16/24 x seeds42/101 x four repetitions x two strategies =128 runs (eight observations per strategy/cell). Active streams have80 requests; idle donors have zero, with no global count override. Sampling20ms/window100ms is identical across strategies; default controller thresholds/confirmation/cooldown/step logic are unchanged. Sequential counterbalanced pairs were measured without simultaneous test/benchmark jobs.

The profiles deliberately cover reclamation (arrival-limited active/idle donor), backpressure (zero producer interval/service5ms), balanced2ms/2ms demand and heterogeneous burst/periodic/stochastic sources. Rates use existing fields only. See [measured tables](PHASE9_EXPERIMENTAL_REPORT.md) for means, variability, absolute/relative differences and exact commands.

Measured resizing:81 successful whole-plan transactions,20 deferrals,0 rejections. All fixed allocations remained fixed. All backpressure and heterogeneous runs measured producer waiting; reclamation and balanced runs had none. Under backpressure, adaptive producer waiting decreased, but mean latency increased23.703% at budget16 and17.798% at budget24, while throughput changed-0.108%/+0.567%. Heterogeneous latency increased9.907%/3.260%, with throughput-0.741%/-0.984%. Balanced runs had no resizes; their differences cannot be attributed to resizing. Reclamation demonstrably released physical capacity. No negative/slow result was trimmed and no universal benefit or statistical significance is asserted.

The orchestrator independently recomputed240 group/paired statistic dictionaries and verified all64 paired full configurations/fingerprints, produced/consumed counts, physical/accounting agreement, budget constraints and export rows. CSV counts:128 latest runs,128 attempt records,208 aggregate-statistic rows and64 comparison rows. All checks passed.

## Reproduce

See [workflow semantics and exact plan/run commands](EXPERIMENTS_PHASE9.md). Use a new output directory for a new matrix; repeat identical arguments with --resume for recovery. Preserve the measured executable and sources: rebuilds, relocation, code edits, ordering/timeout changes may intentionally produce a plan mismatch. The complete recorded plan and effective configs are in data/experiments/phase9_controlled/plan.json and raw records.

## Limitations and unresolved issues

No known unresolved failures remain in executed checks. Resume needs readable initial plan/manifest; interruption before bootstrap completes, malformed lock ownership or ambiguous live PID can require manual inspection/new output. Derived files are individually atomic, not one multi-file transaction; recovery regenerates them. Hash checks are practical provenance guards, not adversarial immutable snapshots. Filesystem retries are bounded and do not guarantee progress under persistent denial. Resume can separate paired measurements in time and weaken original order balancing; sessions record this history.

Results are descriptive for two seeds/four repeats per seed, not broad statistical significance. OS scheduling/timer resolution and the closed-loop arrival model influence measurements. Histogram quantiles are bounds; exact global peak is unavailable; runtime staging heap exceeds logical active-slot storage. Native writer locks have been exercised on this Windows environment; Unix implementation has not been separately executed. No backend/dashboard was added.

Recommended next phase: Phase10 Node.js backend bridge, using the existing native runner and versioned telemetry, while retaining these workflows for future controlled studies.
