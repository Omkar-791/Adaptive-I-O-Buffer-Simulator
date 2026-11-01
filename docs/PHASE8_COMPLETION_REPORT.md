# Phase 8 completion report

## 1. Completion status

Implemented Fixed Equal versus Adaptive experiments, actual input verification, fresh-run execution, reproducible output/provenance and descriptive aggregation. Executed the requested five-workload comparison:30 successful actual runs,15 matched pairs,0 failures. This is an initial descriptive evaluation, not a demonstrated universal adaptive improvement or significance claim. The optional workload-aware fixed baseline is explicitly deferred.

## 2. Architecture and strategies

ExperimentRunner is independent of the legacy simulation CLI and reuses the same existing engine. makeCase normalizes parsed config; allocateEqual implements constrained max-min integer water filling with sorted remainder handling and overflow-safe limits/budget checks. Each run starts fresh with identical equal initial allocations, per-stream limits, effective workload fields, request counts and canonical seeds across strategies.

fixed_equal never calls enableAdaptive and verifies live capacities remain unchanged. adaptive uses the existing unmodified controller/runtime-executor path; no alternate controller or resizing algorithm was introduced. Live budget invariants and final physical/accounting agreement are checked.

Workload-aware fixed allocation was investigated and deferred: no reliable priority/demand priors cover all patterns, and payload size does not change current simulated per-request service time. Inventing weights or consulting future observations would make the baseline harder to interpret.

## 3. Framework and reproducibility

The C++ experiment_runner executable performs one run, returning a versioned JSON record. Python-standard-library run_experiments.py selects configs/strategies/seeds/counts/budget/limits/metrics/repetitions, launches sequential fresh processes and reverses strategy order in alternating paired blocks. Output directories cannot overwrite previous results. Failed/timeout/malformed subprocess outputs become explicit failed records; failures remain counted and are excluded from numerical success summaries.

Producer checksums every successfully inserted generated decision (sequence index, payload, nominal interval, phase); runner independently generates expected traces before timing and compares per-stream hashes/counts after join. Paired effective configs and combined fingerprints must match. Full original/effective config and seed overrides are saved. Hashes are stable noncryptographic FNV64 checksums, not collision-proof identity certificates. Workload nominal decisions are deterministic; wall-clock arrivals and observations are not, because backpressure and scheduling alter timing.

## 4. Measurements and aggregation

Per-run outputs record strategy/workload/seed/repetition, stream/request count, budget/limits, initial allocations, final records and actual physical capacities, duration, throughput, mean latency, whole-run p50/p95 histogram upper bounds, producer/consumer waiting, average time-weighted utilization, largest per-stream peak fraction, successful/deferred/rejected resize transactions and status/error. Exact simultaneous global peak is unavailable and explicitly null. Unmeasured errors use measurements:null. Whole-run quantiles use cumulative completion histograms, not last-window percentiles.

Each measured metric and resize counter has count, mean, median, sample standard deviation, minimum and maximum. Sample SD uses n-1 and is null for n<2. Absolute change is adaptive-fixed; percentage change is100*(adaptive-fixed)/fixed, null for zero denominator. Saved output distinguishes paired differences (including their variability) from difference-of-means percentages. All raw records and150 group/paired statistics dictionaries were independently audited and recomputed exactly.

## 5. Files added and modified

Added:
- engine/include/ExperimentRunner.h and engine/src/ExperimentRunner.cpp.
- engine/include/WorkloadFingerprint.h.
- engine/tools/experiment_main.cpp.
- engine/tests/test_experiment_runner.cpp.
- scripts/run_experiments.py and scripts/test_experiments.py.
- docs/EXPERIMENTS_PHASE8.md, docs/PHASE8_EXPERIMENTAL_REPORT.md and this completion report.
- data/experiments/phase8_initial_seed42/manifest.json, runs.jsonl, summary.json and build_metadata.json.

Modified:
- engine/include/Producer.h and engine/src/Producer.cpp: post-join actual nominal-input checksum, constant per-stream storage.
- engine/include/Metrics.h and engine/src/IOStream.cpp: carry post-join checksum internally for experiments; legacy JSON schema unchanged.
- CMakeLists.txt: experiment module/CLI/test target, optional Python tests; keep assert-based suites enabled even in Release configuration.
- .gitignore: local build_phase8 artifacts.
- README.md, docs/ARCHITECTURE.md, docs/DEVELOPMENT_ROADMAP.md and docs/EXPERIMENT_PLAN.md: implemented scope, measured methodology and next-work distinctions.

No Phase6 controller or Phase7 queue/executor algorithm was changed; no backend/dashboard was implemented.

## 6. Subagents and acceptance

- p8_audit: read-only experimental design and independent source/statistical reviews. Identified cumulative-vs-window metric requirements, closed-loop arrivals, seed normalization and counterbalancing. Audited30 successful outcomes,15 equivalent pairs and150 statistics dictionaries exactly, then checked measured-report claims.
- p8_runner: designed and implemented owned ExperimentRunner header/source after main approval. Added constrained equal allocation, effective configs, producer/preflight hash checks, whole-run measurements and robust JSON. Independently compiled and exercised experiment tests.
- p8_tests: independent C++ tests and initial Python statistical tests. Checked allocation boundaries, fixed invariance, real adaptive growth, seed/trace equivalence and serialization/aggregation. All four C++ groups and initial seven Python tests passed independently.
- Main orchestrator: reviewed/extended final physical-capacity checks, fingerprint instrumentation, CLI, paired driver/error handling, final build/tests, actual measurements, source/build provenance and reports. Expanded Python validation to nine tests, including failed-subprocess preservation and duplicate identity rejection.

## 7. Build and actual test results

All core sources, legacy simulator, experiment CLI and nine C++ suites were built with GCC15.2.0, C++17, -O2, -Wall -Wextra -Wpedantic, without warnings. Assertions remained active in the manual build. Complete suites executed:

| Suite | Actual result |
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
| Python statistics/driver |9 tests passed|

After final compiler-provenance/JSON checks, the experiment module/CLI/test were rebuilt and its four groups rerun successfully. Driver smoke test ran both strategies with a four-request override and saved valid paired artifacts. Experiment CLI rejected insufficient budget. Legacy heterogeneous completion-only JSON returned exactly one successful object; text CLI reported SUCCESS. Existing adaptive NDJSON parsed correctly and performed physical resizes.

New C++ tests cover equal/min/max/nondivisible/insufficient/huge budgets, constrained heterogeneous floors, actual trace/seed/count equivalence, fixed-capacity invariance, real adaptive idle-donor growth, empty/invalid cases and escaped/nonfinite JSON. Python tests cover sample SD/median/extrema, null/zero conventions, signed percentages, failed-run exclusion, paired-versus-mean differences, mismatched/duplicate pair rejection and malformed-subprocess failure preservation.

The Python temporary-file driver test initially encountered sandbox Windows-temp access denial. The cause was investigated and the complete nine-test suite rerun with approved temporary-directory access; all passed. No test failure was hidden or converted into a passing numerical result.

## 8. Executed performance methodology

Five existing configs:steady,burst,periodic,stochastic,heterogeneous. Retained original200 requests/stream, timing patterns/payloads and derived/configured budgets16,32,20,24,32. Initial equal capacities respectively[8,8],[16,16],[10,10],[12,12],[11,11,10]. Experiment seed42 maps to effective stream seeds42,142,242. Three repetitions per strategy/config;30 total fresh sequential runs, with alternating paired order. No test/benchmark simulations were run concurrently during this matrix.

Metrics100ms interval/1000ms window and unchanged controller defaults were used. Actual build used -O2; binary SHA256/environment/configs are in manifest and raw records, exact flags/source hashes in build_metadata.json. More controlled hardware or multiple seeds were not fabricated. Process startup and preflight are excluded from Simulation::run duration; adaptive runtime work and shared checksum instrumentation are included in the measured simulation.

## 9. Measured results

Mean changes (adaptive minus fixed); n=3/strategy. Full mean/median/sampleSD/min/max and raw values are in [measured report](PHASE8_EXPERIMENTAL_REPORT.md) and [saved statistics](../data/experiments/phase8_initial_seed42/summary.json).

| Workload | Throughput absolute req/s | Throughput relative | Mean latency absolute ms | Mean latency relative |
|---|---:|---:|---:|---:|
|steady|+3.159|+2.540%|-0.396|-2.462%|
|burst|-0.651|-0.534%|+0.173|+1.105%|
|periodic|-0.193|-0.199%|-0.104|-0.660%|
|stochastic|-0.301|-0.290%|-0.465|-2.377%|
|heterogeneous|-0.573|-0.448%|-0.038|-0.228%|

Adaptive was not consistently faster: four throughput means were lower, and burst mean latency higher. Steady had zero resizes in both strategies, so its higher adaptive-labelled throughput cannot be attributed to resizing. Fixed steady SD4.825req/s vs adaptive0.721 shows scheduling variation relative to the mean difference; no slow run was trimmed.

The matrix recorded11 successful physical resize transactions,1 deferred and0 rejected. All30 runs verified actual nominal inputs and completed counts, final physical/accounting agreement and budget constraints. All producer full-queue waits were zero: this initial corpus exercised reclamation rather than pressure relief. Dedicated implementation tests separately demonstrated physical growth under pressure; those test outcomes are not presented as performance improvements.

## 10. Limitations, unresolved issues and next milestone

No known unresolved failures remain in executed implementation or matrix validation. CMake/CTest were unavailable, so updated registrations were not executed. No new sanitizer run was performed; the unchanged MinGW environment previously failed ThreadSanitizer linkage because libtsan is absent. Ordinary concurrency tests are not a race-free proof. No isolated CPU-overhead benchmark or throughput-improvement claim is made.

Three same-seed repetitions support initial descriptive results only. OS timer resolution, load and scheduling vary; no pinned affinity/thermal control/warmup isolation was used. Identical nominal requests do not mean identical wall-clock arrivals. Standard-library distributions can vary across toolchains. Quantiles are histogram bounds, consumer wait includes lifecycle idle time, exact global peak is unavailable, temporary resize staging exceeds logical active-slot storage, and workload-aware fixed allocation remains deferred. The measured corpus had no sustained producer backpressure.

Next milestone: Phase9 CLI experiment workflow extensions—parameter grids, richer exports/resume and broader controlled contention/seed evaluations—building on the reusable runner already delivered here. Backend/dashboard remain later milestones.
