Phase 9 adds deterministic grids, journal-based resume and richer exports while preserving these Phase 8 measurements. Current workflow/output contracts: [EXPERIMENTS_PHASE9.md](EXPERIMENTS_PHASE9.md). The historical Phase 8 dataset and measured reports remain unchanged; it is not a resumable Phase 9 journal.

# Phase 8 experimental framework

## Scope and strategies

ExperimentRunner reuses the existing Simulation, workload generators, MetricsEngine, AdaptiveController and RuntimeResizeExecutor. Each strategy starts a fresh simulation with the same normalized IOStreamConfig list, constrained equal initial allocations, hard stream limits and logical slot budget.

**fixed_equal** uses a capped max-min equal water level: capacity_i=clamp(level,min_i,max_i), with the highest feasible integer level and deterministic remainder slots in sorted stream-ID order. Floors above the water level do not receive remainder priority. Subtraction-safe sums reject insufficient minimum budgets and avoid overflow; bounded binary search avoids work proportional to a large budget. Unused budget is allowed if every stream reaches maximum. No adaptive controller or resizing executor is enabled in a fixed run; a live snapshot invariant checks capacities remain unchanged.

**adaptive** starts from exactly those same equal allocations and calls the existing enableAdaptive path. It uses the unmodified Phase6 controller and Phase7 runtime executor. All live snapshots are checked against the global budget. Test policy parameters can be supplied through C++ options, but the initial reported performance matrix uses unchanged controller defaults.

The optional workload-aware fixed baseline is deferred. Configs provide no reliable priorities or uniform long-run demand priors for all patterns; payload bytes do not influence the current consumer's constant per-request service time. Inventing size/rate/priority weights or reading future telemetry would introduce assumptions rather than a clean initial comparison.

## Reproducibility and normalization

makeCase parses existing uniform or heterogeneous configurations and derives budget from an explicit override, configured global budget, or original total capacities. Fixed equal and adaptive intentionally replace config initial capacity splits with the same equal baseline. Other workload fields are retained. Global bounds are CLI-configurable; the C++ API accepts per-stream limits. Uniform source minimum capacity is honored.

The experiment seed is explicit (default42) and overrides config seeds consistently: effective seed_i=(base_seed+100*sorted_stream_index) modulo2^32. Both random_seed and workload.seed are updated and recorded. Optional --requests replaces every stream count, including zero. Otherwise original per-stream counts are retained. Full effective workloads, periodic arrays, mixed phases, payload bounds, seeds, service intervals, requests, allocations, limits, metrics settings and controller parameters are saved with each record. Original configs are copied into the manifest with SHA256 hashes, so overrides are reviewable rather than implicit.

A pure preflight WorkloadGenerator generates every nominal request decision outside the simulation timer. The actual producer independently checksums each successfully inserted WorkloadRequest: zero-based generator sequence index, payload, nominal interarrival and length-prefixed phase. Every stream's post-join checksum/count is compared to preflight. A stable combined FNV-1a64 fingerprint is exported; this is a reproducibility checksum, not cryptographic identity proof. Python additionally requires paired fingerprints and full effective configs to match. Allocation and wall-clock timestamps are excluded from the checksum. Actual consumed bytes/counts are recorded.

Equivalent inputs do not imply identical arrival timestamps: Producer waits its nominal spacing after its previous push completes, so backpressure shifts realized arrivals. The workload model is closed-loop rather than a pre-timed open-loop arrival trace. Seeded generation is deterministic within the toolchain; the controller is deterministic for identical observations/state, but OS scheduling, measured windows, deferrals and controller observations vary. Standard-library random distributions may differ across toolchains. The record includes compiler/C++ version and optimization indicator; the manifest captures executable SHA256 and platform/Python details.

## Runner and saved artifacts

The C++ executable performs one measured run:

```powershell
./build_phase8/experiment_runner.exe --config configs/workload_heterogeneous.json --strategy fixed_equal --seed 42 --repetition 0
./build_phase8/experiment_runner.exe --config configs/workload_heterogeneous.json --strategy adaptive --seed 42 --repetition 0
```

A reusable Python-standard-library driver runs strategies/seeds/repetitions serially and reverses strategy order in alternating paired blocks to reduce order bias. It never launches benchmark simulations in parallel. Processes are fresh, have a configurable timeout, and the driver returns nonzero when any run fails. Failed subprocess/configuration outcomes are recorded, never silently removed. Timeout/malformed JSON output becomes an explicit failed record. Output directory creation is exclusive to prevent overwriting earlier measurements.

```powershell
python scripts/run_experiments.py --exe build_phase8/experiment_runner.exe --configs configs/workload_steady.json configs/workload_burst.json configs/workload_periodic.json configs/workload_stochastic.json configs/workload_heterogeneous.json --seeds 42 --repetitions 3 --output data/experiments/phase8_initial_seed42
```

Use a new output path when repeating the command. --strategies chooses one or both strategies; --seeds accepts multiple uint32 seeds. --budget, --requests, --min-capacity, --max-capacity, --metrics-interval-ms, --metrics-window-ms and --timeout-sec provide explicit overrides. Metrics default100ms interval/1000ms window; limits default1..64. The initial matrix retains request counts and budgets from each config.

Artifacts:
- manifest.json: exact source configs/hashes, command options, binary hash, environment, start/end and run/failure counts.
- runs.jsonl: every run, execution order, command, status, effective config, actual final capacities, measurements, checksums and resize outcomes.
- build_metadata.json (initial measured dataset): orchestrator-recorded actual compiler flags and source hashes; optimized:true alone does not encode a specific optimization level.
- summary.json: group descriptive statistics and paired comparisons, updated after completed pairs so finished results survive later failures/interruption.

The manifest is left incomplete if execution is interrupted; it must not be presented as a completed matrix. This initial dataset is tracked under data/experiments; generated binaries remain ignored.

## Metric definitions and availability

All measurements come from real engine state; none is a hardcoded speedup.

| Field | Definition |
|---|---|
| simulation_duration_sec | Simulation::run wall time including queue/thread setup, sampling and shutdown; excludes process startup and preflight/config setup |
| throughput_req_per_sec / throughput_mb_per_sec | Completed requests or payload MiB divided by simulation wall duration |
| avg_latency_ms | Completion-weighted mean creation-to-completion latency, including producer backpressure, queue and service |
| p50_latency_upper_ms / p95_latency_upper_ms | Whole-run cumulative64-bucket histogram quantile upper boundaries, not the final sliding-window quantiles or exact percentiles |
| producer_wait_ms | Whole-run producer full-queue blocking from existing summary |
| consumer_wait_ms | Cumulative empty-queue waiting from final snapshot, including shutdown/drain lifecycle idle time |
| average_utilization_pct | 100*cumulative occupancy-time / cumulative capacity-time; global sums per-stream integrals |
| peak_stream_utilization_pct | Largest observed exact individual-stream peak fraction from stream summary; not simultaneous global utilization |
| peak_global_utilization_pct | null: an exact simultaneous global peak is unavailable |
| resize_successful / deferred / rejected | Whole-plan executor transaction counts; one transaction may change several queues |
| final_allocations / actual_final_capacities | Final manager records and physical snapshot limits; runner verifies agreement |

Mean latency and duration are measured floats; histogram bounds can remain constant even when the underlying latency distribution changes. Empty workloads use zero mean/quantile conventions from the engine and have zero completions. Failed/unmeasured runs export measurements:null. Consumer waits and cumulative integrals include tiny buffer construction intervals prior to sampler baseline. Current summary historical global max slots is not used as a global peak metric.

## Statistics and interpretation

For successful runs only, every numeric metric gets count, arithmetic mean, median, sample standard deviation sqrt(sum((x-mean)^2)/(n-1)), minimum and maximum. Empty groups have null statistics; sample SD is null for n<2. Failed counts remain explicit. Results are grouped by workload/strategy; when multiple seeds are supplied, group variability combines seed and scheduling variation, while raw records retain both identities.

For throughput and mean latency, difference_of_means reports adaptive_mean-fixed_mean and100*(adaptive_mean-fixed_mean)/fixed_mean. Paired differences are also summarized for matching workload/seed/repetition identities, including per-pair percentages. Mean paired percentages can differ from percentage change of means; both are named distinctly. Zero fixed denominator yields null relative percentage. Negative latency change means lower observed mean latency; positive throughput change means higher observed throughput. No p-values or significance claims are made from the small initial sample.

## Build and validation

CMake adds experiment_runner, test_experiment_runner and optional Python statistics CTest registration. For manual GCC builds, compile all engine/src except main.cpp into the core, then link engine/tools/experiment_main.cpp for experiment_runner. Existing main.cpp remains the original simulation CLI. Use C++17, -Wall -Wextra -Wpedantic and consistent optimization (initial evaluation used -O2).

Independent tests cover constrained allocation, seed/actual trace equivalence, fixed capacity invariance, adaptive physical changes, empty/invalid cases, escaping and JSON validity. Python tests verify sample statistics, exclusions, paired-versus-mean calculations and undefined percentages. Implementation correctness checks are separate from the performance matrix; complete actual results and unavailable-tool limitations appear in PHASE8_COMPLETION_REPORT.md.

## Limitations and next milestone

Three same-seed repetitions per strategy/case form an initial descriptive experiment, not generalization across workloads or seeds. There is no isolated CPU pinning, thermal/load control, dedicated hardware I/O or CPU-overhead benchmark. Service time depends on per-request configured sleeps rather than payload size; OS timer resolution and scheduling dominate many cases. Strategies can tie or adaptive can perform worse. Staging copies/heap overhead are included where they occur, but not attributed to an isolated overhead component. CMake/CTest and ThreadSanitizer remain environment-limited as documented in the completion report.

Next milestone: Phase9 CLI experiment workflow extensions (batch matrices, richer exports/analysis), before the planned backend/dashboard. This phase already supplies the minimal reusable CLI required to execute reproducible comparisons.
