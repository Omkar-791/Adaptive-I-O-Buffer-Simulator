# Adaptive I/O Buffer Management & Performance Optimization System

C++17 Operating Systems course project modeling concurrent producer-consumer I/O streams under a shared buffer-slot budget. Current milestone: **Phase 13 Experiment and Analysis Interface**. The React workspace connects to the Phase10 bridge for real native simulations, cursor-polled telemetry and final results. Adaptive operation remains opt-in; WebSocket transport is future work.

## Structure

- `client/`: Adaptive I/O Lab React/Vite/TypeScript workspace, typed API client and browser tests.
- `server/`: Phase10 Express bridge and native process management.
- `engine/include/`, `engine/src/`: engine, CLI, workload generation, resource accounting and metrics.
- `engine/tests/`: nine standalone assert-based suites plus Python experiment tests.
- `configs/`: steady, burst, periodic, stochastic and heterogeneous examples (mixed phases are also supported).
- `docs/`: specifications, architecture, metrics definitions and roadmap.
- `engine/tools/experiment_main.cpp`: single-run experiment CLI.
- `scripts/run_experiments.py`: counterbalanced paired runs and statistical aggregation.
- `scripts/`: subprocess integration and statistics tests.
- `data/`: saved experiment/audit artifacts.

`Simulation` configures `StreamManager` and `BufferResourceManager`. Each `IOStream` owns a Producer, synchronized resizable circular buffer and Consumer (two worker threads). Shutdown joins producers, closes queues, drains and joins consumers. `MetricsEngine` takes a baseline before worker startup, samples on a separate thread, then takes a final post-drain snapshot.

## Build and test

Requires a C++17 compiler; CMake is optional.

```powershell
cmake -S . -B build
cmake --build build
ctest --test-dir build --output-on-failure
```

Alternatively, with GCC on Windows:

```powershell
New-Item -ItemType Directory -Force build | Out-Null
$core = Get-ChildItem engine/src/*.cpp | Where-Object Name -ne 'main.cpp' | ForEach-Object FullName
g++ -std=c++17 -Wall -Wextra -Wpedantic -I engine/include $core engine/src/main.cpp -o build/adaptive_io_sim.exe
foreach ($test in (Get-ChildItem engine/tests/*.cpp)) {
    g++ -std=c++17 -Wall -Wextra -Wpedantic -I engine/include $core $test.FullName -o ('build/'+$test.BaseName+'.exe')
    & ('./build/'+$test.BaseName+'.exe')
}
```

For multi-configuration CMake generators, select the build configuration when building/testing and use its executable subdirectory.

## Run

```powershell
./build/adaptive_io_sim.exe --streams 3 --budget 32 --requests 100 --json
./build/adaptive_io_sim.exe --config configs/workload_heterogeneous.json --telemetry --metrics-interval-ms 100 --metrics-window-ms 1000
./build/adaptive_io_sim.exe --help
```

Default text summaries and completion-only `--json` remain available. `--telemetry` emits initial, periodic and final `metrics_snapshot` NDJSON followed by `simulation_completed`. Configuration files remain compatible; sampling settings use CLI flags or C++ setters.

## Node.js backend

The local Express bridge validates configurations, launches isolated native runs, exposes status/bounded telemetry/results/history, and supports truthful process-termination cancellation. No native controller or resizing algorithms were changed.

```powershell
cd server
npm.cmd ci --ignore-scripts
$env:NATIVE_EXECUTABLE = (Resolve-Path '../build/adaptive_io_sim.exe').Path
npm.cmd start
# In a separate terminal, after building the native simulator:
npm.cmd test
```

API: `http://127.0.0.1:3000/api/v1`. [Setup and API contract](docs/BACKEND_PHASE10.md), [native integration contract](docs/PHASE10_NATIVE_CONTRACT.md), [completion report](docs/PHASE10_COMPLETION_REPORT.md). All 40 backend tests passed, including real fixed/adaptive/empty HTTP runs and cancellation. History is in memory, cancellation is not graceful, and a hard backend crash can leave child processes/artifacts behind; this is a loopback development service without full authentication.

## Reproducible experiments

Fixed Equal and Adaptive start from identical equal allocations with the same workload inputs, seeds, counts, budget and limits. Actual producer checksums verify generated request equivalence. Workload-aware fixed allocation is deferred because suitable configuration priors are unavailable.

CMake builds the experiment_runner target. Manual GCC: link core sources excluding engine/src/main.cpp with engine/tools/experiment_main.cpp. Use consistent -O2 C++17 flags for measured evaluation. The legacy simulator remains a separate executable.

```powershell
python scripts/run_experiments.py --exe build_phase8/experiment_runner.exe --configs configs/workload_steady.json configs/workload_burst.json configs/workload_periodic.json configs/workload_stochastic.json configs/workload_heterogeneous.json --seeds 42 --repetitions 3 --output data/experiments/phase8_repeat_seed42
python scripts/test_experiments.py
```

Use a new output directory each time. Results include full configs, raw JSONL runs, statistics and provenance. [Methodology](docs/EXPERIMENTS_PHASE8.md), [actual 30-run report](docs/PHASE8_EXPERIMENTAL_REPORT.md), and [completion report](docs/PHASE8_COMPLETION_REPORT.md) distinguish validation from measured performance. Results are mixed; no statistical significance or universal adaptive improvement is claimed.

## Phase 9 matrices, resume and exports

The Python driver now supports deterministic parameter grids, capped/prefix-selected plans, stable SHA256 identities, native single-writer locking and safe resume from immutable attempt records. Sources, executable and workflow helpers are checked before and after every run. Failed/malformed histories remain available. CSV, complete JSON and Markdown exports distinguish paired changes from differences between means.

```powershell
python scripts/run_experiments.py --exe build_phase9/experiment_runner.exe --configs configs/phase9_reclamation.json configs/phase9_backpressure.json configs/phase9_balanced.json configs/phase9_heterogeneous.json --grid configs/phase9_grid.json --seeds 42 101 --repetitions 4 --max-runs 128 --output data/experiments/phase9_repeat --plan-only
# Repeat those arguments with --resume instead of --plan-only to execute/recover.
```

[Workflow/recovery documentation](docs/EXPERIMENTS_PHASE9.md), [128-run measured report](docs/PHASE9_EXPERIMENTAL_REPORT.md), and [completion report](docs/PHASE9_COMPLETION_REPORT.md) include commands, tests and limitations. The controlled matrix completed 128 runs/64 matched pairs. Backpressure was measured; adaptive reduced producer waiting but increased mean latency in pressure cases. No universal improvement or significance is claimed. Historical Phase 8 measurements remain unchanged.

## Adaptive controller

`AdaptiveController` consumes existing MetricsSnapshots and explicit current allocations/budget/stream bounds. It produces deterministic allocation recommendations with reasons using occupancy, producer/consumer blocking, throughput, confirming windows, hysteresis, cooldown and fair capped allocation. A read-only BufferResourceManager overload is available. The policy itself only recommends. Phase 7 RuntimeResizeExecutor validates and applies complete decisions to physical queues and accounting when adaptive mode is enabled. See [algorithm, defaults and embedding example](docs/CONTROLLER_PHASE6.md).

## Runtime resizing

`RuntimeResizeExecutor` stages FIFO-preserving replacement rings, revalidates live occupancy under sorted queue locks, and atomically commits queue capacities and accounting within the logical slot budget. Busy/unsafe shrink operations defer explicitly, without sleeps or automatic retries. Existing fixed behavior remains the default.

```powershell
./build/adaptive_io_sim.exe --adaptive --streams 2 --capacity 2 --budget 32 --requests 100 --producer-ms 0 --consumer-ms 5 --telemetry --metrics-interval-ms 10 --metrics-window-ms 50
```

Adaptive telemetry includes buffer_resize results with previous/requested/actual capacities. --json alone stays completion-only. See [runtime semantics and locking](docs/RUNTIME_RESIZING_PHASE7.md) and [actual validation results](docs/PHASE7_COMPLETION_REPORT.md). Staging uses additional temporary heap storage; the budget limits logical active queue slots.

## Metrics

[Phase 5 definitions](docs/METRICS_PHASE5.md) describe the controller interface, observed window duration, sampling skew and synchronization constraints. Measurements include cumulative completed counts/bytes, window throughput, occupancy/utilization, producer/consumer waits (including ongoing waits), blocking episodes, mean latency and histogram p50/p95 upper bounds. History is bounded; legacy latency samples retain at most 4096 entries.

All nine C++ suites passed a fresh warning-free GCC build and execution: 38 original tests, six metrics groups, seven controller groups, nine resizing groups and four experiment groups. All 40 Python tests passed: nine existing statistics/driver tests, 25 workflow/recovery tests and six export/atomic-I/O tests. Some filesystem tests required approved access; bounded Windows sharing-error recovery was implemented and tested. All five example configurations were exercised with NDJSON validation. CMake/CTest were unavailable in that environment; the CMake targets were updated but not executed. ThreadSanitizer linking failed because this GCC installation lacks libtsan. No race-free or overhead claim is made.

Legacy resource-manager resize hooks remain accounting-only and are blocked while an executor is bound. Use RuntimeResizeExecutor for physical changes. The next milestone is **Phase 14 Testing and Integration**.

## Adaptive I/O Lab

Run the backend as above, then use a separate terminal: cd client, npm.cmd ci, npm.cmd run dev. Open http://127.0.0.1:5173. Configure simulations at /simulations/new, inspect run tabs, view bounded in-memory history and read the architecture page. [Frontend setup and verification](client/README.md), [wireframes](docs/design/wireframes/README.md), [Phase11 report](docs/PHASE11_COMPLETION_REPORT.md).

No fabricated progress or metrics are displayed. Cancellation terminates the native process. The UI cannot tune controller thresholds through the existing API; it displays the backend's effective configuration.



## Experiment analysis (Phase 13)

Open History, choose a retained source configuration, and launch a matched fixed/adaptive
pair. Each run uses the existing API and native simulator. Select retained pairs using
the two selectors; their IDs remain in the URL. Matching effective inputs and successful
final counts/bytes are required before whole-run throughput, mean latency and producer
waiting are compared. Actual allocation events include native timing and reasons.
Download JSON or CSV with configurations, results, retained telemetry, errors and loss
metadata. CSV includes full JSON context in each metric row; readers may need to raise
large-field limits. Empty/failed/evicted selections remain identifiable in exports.

This descriptive pair can run concurrently and is affected by scheduling contention.
Use the Phase9 CLI for counterbalanced, multi-repetition provenance-checked experiments.
History remains in memory. [Workflow contract](docs/PHASE13_API_CONTRACT.md),
[implementation plan](docs/PHASE13_PLAN.md), [completion and acceptance](docs/PHASE13_COMPLETION_REPORT.md).
