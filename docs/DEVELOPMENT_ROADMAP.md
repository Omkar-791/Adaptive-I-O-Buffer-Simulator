## Phase11 scope update

The current Phase11 master specification supersedes the older Phase11/12 split below: Phase11 now delivers Adaptive I/O Lab, the React frontend with cursor-based polling over the existing Phase10 API. Dashboard, configuration, run inspection, history, architecture, editable wireframes and browser integration are implemented in client/. See PHASE11_COMPLETION_REPORT.md for evidence. WebSocket transport remains deferred and is not required for these live polling views. The older Phase12 dashboard description is retained as historical planning context, not a claim of missing Phase11 screens.

Phase13 now delivers descriptive matched-pair comparison/export through the unchanged API; see PHASE13_API_CONTRACT.md and PHASE13_COMPLETION_REPORT.md. Persistent storage remains deferred, not a Phase13 requirement. Phase14 verification is complete. Phase15 academic evaluation and viva deliverables are now verified; the roadmap ends at Phase15.

# Development Roadmap

This roadmap outlines the phased, incremental development plan for the **Adaptive I/O Buffer Management & Performance Optimization System**. Each phase builds systematically upon verified foundations, preserving clear boundaries between simulation, metrics, control, and visualization.

---

## Roadmap Overview

```text
Phases 0-4: Foundation, concurrent streams, resource budget, workloads
Phase 5: Metrics -> Phase 6: Controller decisions -> Phase 7: Runtime resizing
Phase 8: Baselines -> Phase 9: CLI experiments -> Phase 10: Node backend
Phase 11: Polling frontend/dashboard (absorbs old Phase12) -> Phase 13: Analysis UI
Phase 14: Integration/hardening -> Phase 15: Final report and presentation
```

---

## Detailed Phase Breakdown

### Phase 0: Project Setup and Specification [COMPLETED]
- **Status**: **COMPLETED**
- **Objective**: Establish the repository foundation, formal system specifications, architectural blueprint, build configuration, and development environment verification.
- **Features**:
  - Directory skeleton.
  - Formal documentation covering specs, architecture, metrics, roadmap, controller design, and experiment plan.
  - Modern CMake configuration with C++17/20 support.
  - Minimal compilation and execution verification.
- **Files / Modules Implemented**:
  - `CMakeLists.txt`
  - `README.md`
  - `docs/*.md`
  - `engine/src/main.cpp`
- **Dependencies**: Native C++ compiler, CMake.
- **Tests**: Clean build and execution of skeleton executable.
- **Completion Criteria**: Executable compiles without errors and outputs verification message; environment verified.
- **Expected Deliverables**: Initial git repository with docs and working build.

---

### Phase 1: Basic Single-Stream Producer-Consumer Simulation [COMPLETED]
- **Status**: **COMPLETED**
- **Objective**: Implement a rock-solid, thread-safe bounded circular buffer with standard POSIX/C++ synchronization primitives.
- **Features**:
  - `Request` data structure with unique ID, payload bytes, and lifecycle timestamps.
  - Thread-safe `BoundedBuffer` with configurable capacity, circular indexing, and state tracking.
  - Condition variables (`not_full_`, `not_empty_`) and `std::mutex`.
  - Independent `Producer` and `Consumer` worker threads.
  - Precise producer blocked waiting time measurement.
  - Time-integrated buffer occupancy tracking.
  - Robust command-line interface with `--help` and configurable parameters.
  - Comprehensive unit test suite (`test_bounded_buffer`) and integration test suite (`test_simulation`).
- **Files / Modules Implemented**:
  - `engine/include/Request.h`, `engine/src/Request.cpp`
  - `engine/include/BoundedBuffer.h`, `engine/src/BoundedBuffer.cpp`
  - `engine/include/Producer.h`, `engine/src/Producer.cpp`
  - `engine/include/Consumer.h`, `engine/src/Consumer.cpp`
  - `engine/include/Metrics.h`, `engine/src/Metrics.cpp`
  - `engine/include/Simulation.h`, `engine/src/Simulation.cpp`
  - `engine/src/main.cpp`
  - `engine/tests/test_bounded_buffer.cpp`
  - `engine/tests/test_simulation.cpp`
- **Dependencies**: Phase 0.
- **Tests Executed**:
  - TEST 1: Single item push and pop (FIFO & data preservation).
  - TEST 2: Fill to capacity and FIFO drain.
  - TEST 3: Producer blocking when buffer is full.
  - TEST 4: Consumer blocking when buffer is empty.
  - TEST 5: High-concurrency producer/consumer (zero dropped or duplicated items).
  - TEST 6: Graceful shutdown wakes blocked consumer.
  - TEST 7: Graceful shutdown wakes blocked producer and drains remaining items.
  - TEST 8: Full simulation run (100% produced == consumed).
  - TEST 9: Deterministic seed workload reproducibility.
  - Contention & edge cases: fast producer / slow consumer, capacity = 2, slow producer / fast consumer.
- **Completion Criteria**: All tests passing cleanly, zero compiler warnings under `-Wall -Wextra -Wpedantic`, zero deadlocks or lost requests.
- **Deliverables**: Verified single-stream simulation binary `adaptive_io_sim.exe` and test binaries.

---

### Phase 2: Multiple I/O Streams [COMPLETED]
- **Status**: **COMPLETED**
- **Objective**: Generalize single-stream synchronization to $N$ concurrent, independent I/O streams running simultaneously.
- **Features**:
  - `IOStream` abstraction encapsulating a Producer, dedicated `BoundedBuffer`, and Consumer.
  - `StreamManager` orchestrating $N$ concurrent streams ($2N$ worker threads).
  - Configurable stream count ($N \ge 1$) via CLI (`--streams <N>`).
  - Independent, heterogeneous operational parameters per stream (arrival intervals, device processing times, buffer capacities, seeds).
  - Synchronized three-stage shutdown protocol avoiding deadlocks and thread leaks.
  - Per-stream and global aggregate telemetry metrics.
  - Comprehensive multi-stream test suite (`test_multi_stream.cpp`).
- **Files / Modules Implemented**:
  - `engine/include/IOStream.h`, `engine/src/IOStream.cpp`
  - `engine/include/StreamManager.h`, `engine/src/StreamManager.cpp`
  - `engine/include/Request.h`, `engine/src/Request.cpp` (updated with stream ID)
  - `engine/include/Producer.h`, `engine/src/Producer.cpp` (updated with stream ID)
  - `engine/include/Consumer.h`, `engine/src/Consumer.cpp` (updated with stream ID)
  - `engine/include/Metrics.h`, `engine/src/Metrics.cpp` (added `StreamMetrics` and per-stream report formatting)
  - `engine/include/Simulation.h`, `engine/src/Simulation.cpp` (delegating to `StreamManager`)
  - `engine/src/main.cpp` (updated with `--streams` CLI parameter)
  - `engine/tests/test_multi_stream.cpp`
- **Dependencies**: Phase 1.
- **Tests Executed**:
  - TEST 1: Multiple concurrent homogeneous streams (3 streams, 150 req/stream).
  - TEST 2: Heterogeneous streams with varied capacities, producer rates, and consumer delays.
  - TEST 3: High concurrency scaling test (8 concurrent streams, 16 threads, 800 requests).
  - TEST 4: Direct `StreamManager` lifecycle and stream lookup.
  - TEST 5: Deterministic multi-stream reproducibility across runs.
- **Completion Criteria**: All streams start, execute, and join cleanly without thread leaks, deadlocks, or unhandled exceptions.
- **Expected Deliverables**: Verified multi-stream simulation binary `adaptive_io_sim.exe` and test binary `test_multi_stream.exe`.

---

### Phase 3: Shared Buffer Budget & Resource Manager (COMPLETE)
- **Objective**: Introduce a global memory constraint, deterministic initial allocation, canonical data contracts, and dynamic resizing preparation.
- **Features**:
  - Global `BufferResourceManager` tracking total allocated capacity: $\sum C_i \le B_{\text{total}}$.
  - Thread-safe initial allocation strategy: equal distribution with deterministic remainder allocation.
  - Strict minimum capacity validation ($C_i \ge C_{\text{min}}$) and budget overflow rejection.
  - Interface preparation for future Phase 6 Adaptive Controller dynamic resizing (`canResize`, `requestResize`, `reallocate`).
  - Canonical data models (`BufferState`, `StreamState`, `SimulationState`, `SimulationResult`) with JSON serialization.
  - Event model (`SimulationEventType`, `SimulationEvent`) and canonical error taxonomy (`EngineErrorCode`).
  - Comprehensive Integration Contract (`docs/INTEGRATION_CONTRACT.md`) defining future REST and WebSocket specifications.
- **Files / Modules Delivered**:
  - `engine/include/BufferResourceManager.h`, `engine/src/BufferResourceManager.cpp`
  - `engine/include/DataModels.h`, `engine/include/EventModel.h`, `engine/include/ErrorCodes.h`
  - `engine/tests/test_resource_manager.cpp`
  - `docs/INTEGRATION_CONTRACT.md`
- **Dependencies**: Phase 2.
- **Tests**: Budget initialization, equal allocation, remainder allocation, minimum capacity validation, overflow prevention, reallocation hooks, multi-stream execution under budget, and invariant verification.
- **Completion Criteria**: Invariant $\sum C_i \le B_{\text{total}}$ verified, 0 compiler warnings, all Phase 1/2/3 tests PASS.
- **Expected Deliverables**: Budget-constrained buffer management module, test suite `test_resource_manager.exe`, CLI `--budget` and `--json` support.

---

### Phase 4: Workload Generator [COMPLETED]
- **Status**: **COMPLETED**
- **Objective**: Build a deterministic, reproducible synthetic workload generator subsystem supporting diverse traffic patterns.
- **Features**:
  - Five core synthetic workload arrival patterns:
    - `STEADY`: Constant arrival rate.
    - `BURST`: Alternating two-phase cycle (normal low-activity phase vs high-activity burst phase).
    - `PERIODIC`: Sinusoidal continuous modulation over period length or discrete interval stepping.
    - `STOCHASTIC`: Poisson arrival process with exponential inter-arrival distribution ($\lambda = 1 / T_{\text{mean}}$).
    - `MIXED`: Custom sequential multi-phase workload (e.g. warmup $\to$ stress $\to$ cooldown) with per-phase durations, intervals, and payload bounds.
  - Strict PRNG determinism using `std::mt19937` with unique per-stream seed derivation.
  - Architectural separation of workload decisions (`WorkloadRequest`) from thread execution (`Producer`).
  - Configurable request payload bounds (uniform random or per-phase).
  - Multi-stream heterogeneous workload profiles (concurrent streams running different workloads).
  - JSON configuration loader (`ConfigParser`) supporting uniform and heterogeneous simulations.
  - CLI flags: `--workload`, `--burst-interval`, `--burst-length`, `--normal-length`, `--config`.
  - Machine-readable single-line NDJSON output and EventModel integration (`WORKLOAD_STARTED`, `WORKLOAD_PHASE_CHANGED`, `WORKLOAD_COMPLETED`).
- **Files / Modules Delivered**:
  - `engine/include/WorkloadGenerator.h`, `engine/src/WorkloadGenerator.cpp`
  - `engine/include/ConfigParser.h`, `engine/src/ConfigParser.cpp`
  - `engine/tests/test_workload_generator.cpp`
  - `configs/workload_steady.json`
  - `configs/workload_burst.json`
  - `configs/workload_periodic.json`
  - `configs/workload_stochastic.json`
  - `configs/workload_heterogeneous.json`
  - `docs/WORKLOAD_GENERATOR.md`
- **Dependencies**: Phase 3.
- **Tests**: 12/12 unit and integration tests passing in `test_workload_generator.exe` (steady, burst, periodic, stochastic, mixed, seed reproducibility, seed differentiation, producer integration, simulation burst execution, heterogeneous multi-stream execution, config parser, telemetry & events).
- **Completion Criteria**: 100% test pass rate, 0 compiler warnings, full backward compatibility with Phase 1–3 tests, verified subprocess consumption via Node.js script.
- **Expected Deliverables**: Workload generator subsystem, CLI options, configuration files, and documentation.

---

### Phase 5: Metrics Engine [COMPLETED]

Implemented interfaces and validation: see METRICS_PHASE5.md. Percentiles are histogram bounds; the CPU overhead target remains unbenchmarked.
- **Objective**: Develop a high-precision, low-overhead telemetry engine.
- **Features**:
  - Per-stream metrics: buffer occupancy, utilization, throughput, request latency, producer wait time, consumer idle time.
  - Global metrics: total memory usage, aggregate throughput, total blocked thread time.
  - Sliding-window statistical aggregation (mean, p50, p95).
  - Structured output streaming (NDJSON to stdout or file).
- **Files / Modules Expected**:
  - `engine/include/metrics_engine.hpp`
  - `engine/src/metrics_engine.cpp`
  - `engine/include/telemetry_snapshot.hpp`
- **Dependencies**: Phase 4.
- **Tests**: Verification that metric math matches theoretical arrival/service rates in controlled static runs.
- **Completion Criteria**: Metrics engine operates with $<2\%$ CPU overhead and introduces no synchronization lock contention.
- **Expected Deliverables**: Telemetry subsystem with JSON snapshot output.

---

### Phase 6: Adaptive Controller [IMPLEMENTED: RECOMMENDATIONS ONLY]
- **Objective**: Deterministic, explainable adaptive allocation decisions from Phase 5 metrics.
- **Implemented modules**: `engine/include/AdaptiveController.h`, `engine/src/AdaptiveController.cpp`, `engine/tests/test_adaptive_controller.cpp`.
- **Policy**: Multi-signal occupancy/backpressure/consumer-wait/throughput interpretation, nonoverlapping confirming windows, hysteresis, cooldown, per-stream min/max, overflow-safe budget checks and fair capped grants.
- **Integration**: Read-only resource-manager adapter and existing serialized metrics callbacks. No duplicate instrumentation or extra controller thread.
- **Scope**: Returns recommendations only; neither resource bookkeeping nor physical queues change.
- **Definitions and validation**: See `CONTROLLER_PHASE6.md` and `PHASE6_COMPLETION_REPORT.md`.

### Phase 7: Runtime Buffer Resizing Executor [IMPLEMENTED AND VALIDATED]
- **Modules**: RuntimeResizeExecutor, synchronized mutable BoundedBuffer capacity and guarded resource-manager binding.
- **Behavior**: Transactional FIFO-preserving growth/shrink; live occupancy/closed/stale checks; all-or-nothing accounting; nonblocking lock contention deferral; growth wakes producers after unlock.
- **Integration**: Opt-in Simulation::enableAdaptive / --adaptive uses existing sampler/controller callbacks with explicit resize results. Capacity-time telemetry accounts for varying limits.
- **Validation**: Full GCC build, all eight suites including nine resizing groups, 10000-request FIFO stress, five adaptive configs, legacy CLI/JSON and real capacity changes. CMake unavailable; ThreadSanitizer runtime absent. See PHASE7_COMPLETION_REPORT.md.
- **Limits**: Staging heap overhead exceeds logical active slot budget; deferrals have no success deadline; lifecycle and executor epochs are caller-managed.

---

### Phase 8: Baseline Strategies and Reproducible Experiments [IMPLEMENTED AND EVALUATED]
- **Strategies**: Fixed Equal and Adaptive, same constrained equal starting allocations/budget/limits and nominal request traces. Optional workload-aware baseline deferred; no reliable uniform demand/priority priors.
- **Modules**: ExperimentRunner, independent experiment CLI, producer checksum verification, Python-standard-library paired driver/statistics.
- **Outputs**: Full effective configs, input fingerprints, physical/accounting capacity outcomes, cumulative latency histogram bounds, waits/utilization/resize counts, manifest/raw JSONL/statistics.
- **Validation**: All nine C++ suites and nine Python tests passed. Independent statistical audit recomputed150 descriptive-statistic dictionaries exactly.
- **Evaluation**:30 actual runs across all five configs, seed42, three repetitions per strategy; no failures. Mixed results, no significance/universal benefit claim. All producer full-queue waits were zero in this initial corpus, so pressure relief remains outside these particular measured cases.
- **References**: EXPERIMENTS_PHASE8.md, PHASE8_EXPERIMENTAL_REPORT.md, PHASE8_COMPLETION_REPORT.md.
- **Dependencies**: Phase 7.

---

### Phase 9: Experiment Workflow Extensions & Controlled Evaluation [IMPLEMENTED AND VALIDATED]
- **Workflow**: deterministic supported grids, stable IDs, saved plans, run caps/subsets, immutable attempts, strict resume/recovery, native writer locks and pre/post provenance checks.
- **Exports**: latest/all-attempt CSV, aggregate/paired CSV, full JSON, units and Markdown summaries with failure/missing-value preservation.
- **Controlled evaluation**: four existing-model rate profiles x two budgets x two seeds x four repetitions x two strategies =128 successful runs/64 pairs. Both backpressure and reclamation demonstrated; no universal performance gain claimed.
- **Validation**: all nine C++ suites and 40 Python tests passed. Independent final code review completed; orchestrator separately recomputed240 statistic dictionaries and verified all data invariants. Real resume skipped128 and repaired a torn derived cache without new attempts.
- **Limits**: bootstrap artifacts must be readable; conservative lock/hash checks can refuse ambiguous recovery; no CMake/CTest or ThreadSanitizer execution available in the validation environment.
- **References**: EXPERIMENTS_PHASE9.md, PHASE9_EXPERIMENTAL_REPORT.md, PHASE9_COMPLETION_REPORT.md.
- **Dependencies**: Phase 8. Controller/resizing algorithms unchanged.

---

### Phase 10: Node.js Backend Bridge [IMPLEMENTED AND VALIDATED]
- **Modules**: Express app/config/validation, run manager, bounded NDJSON parser and locked Node dependencies under server/.
- **API**: versioned health, submit/list/status, telemetry polling, final results and process-termination cancellation.
- **Safety**: loopback Host/Origin checks, complete bounded input validation, trusted argv-based spawning, isolated artifacts, concurrency/history/output limits and sanitized errors.
- **Validation**: 40 backend tests passed with zero skips, including real native fixed/adaptive/empty runs and cancellation; all nine C++ suites and 40 Python tests passed. Independent source/security review found no remaining blocker.
- **Limits**: in-memory state, no graceful native cancellation or crash-proof orphan cleanup, CMake/CTest unavailable and ThreadSanitizer runtime absent.
- **References**: BACKEND_PHASE10.md, PHASE10_NATIVE_CONTRACT.md, PHASE10_COMPLETION_REPORT.md.

---

### Phase 11: Live Telemetry Transport / Client Integration [COMPLETED UNDER SCOPE OVERRIDE]

The feature list below is historical planning; the opening override and Phase11 completion report define the delivered polling/frontend scope. WebSockets/native controls remain deferred.
- **Objective**: Extend the working polling API for a concrete client need; choose SSE or WebSockets after defining that need. Native pause/resume/step requires a separate native control protocol and is not currently supported.
- **Features**:
  - WebSocket server (`ws` or `socket.io`).
  - Broadcast loop pushing telemetry snapshots to connected browser clients at 10–20 Hz.
  - Bi-directional control channel (pause, resume, step, adjust load dynamically).
- **Files / Modules Expected**:
  - `server/src/websocket_handler.js`
- **Dependencies**: Phase 10.
- **Tests**: WebSocket connection and message throughput stress test.
- **Completion Criteria**: Smooth, low-latency ($<30\text{ ms}$) streaming of live telemetry to multiple clients.
- **Expected Deliverables**: Real-time WebSocket streaming service.

---

### Phase 12: React Dashboard [SUPERSEDED — replacement dashboard delivered in Phase 11]

The Phase11 master specification superseded the older Phase11/12 split. The historical dashboard description below is retained for context and is not outstanding implementation work. The replacement uses React/Vite/TypeScript/custom tokens and real polling dashboards. No separate dashboard rebuild, Tailwind migration, additional occupancy gauge, historical latency time-series chart, or old drop-count cards/worker-status metrics are required merely to satisfy this superseded scope.
- **Objective**: Develop an interactive web dashboard for real-time simulation monitoring.
- **Features**:
  - Built with React, Vite, and Tailwind CSS.
  - Live buffer occupancy visualizer (gauge / animated bar showing free, used, and reserved slots).
  - Time-series charts for throughput, latency, and producer wait times (using Recharts).
  - Stream status cards showing current capacity, queue length, and drop counts.
- **Files / Modules Expected**:
  - `client/package.json`
  - `client/src/App.jsx`
  - `client/src/components/BufferVisualizer.jsx`
  - `client/src/components/TimeSeriesChart.jsx`
  - `client/src/components/StreamCard.jsx`
- **Dependencies**: Phase 11.
- **Tests**: Frontend component tests; live render validation.
- **Completion Criteria**: Dashboard renders live telemetry updates smoothly without browser UI stuttering.
- **Expected Deliverables**: Interactive React simulation dashboard.

---

### Phase 13: Experiment and Analysis Interface [IMPLEMENTED AND VALIDATED]

Delivered in History: matched independent fixed/adaptive native launches, retained-run selectors, exact whole-run measurements and three unit-separated bar charts, reused native adaptation timelines, and full-context CSV/JSON downloads. Inputs, strategies, successful final counts/bytes are checked before comparison. Partial launches/failures/evicted IDs and bounded telemetry remain explicit. Tests:67 frontend,6 browser,40 backend,40 Python; all9 existing native suites rerun. See PHASE13_COMPLETION_REPORT.md for actual commands and limitations.
- **Objective**: Add comparative benchmarking UI and historical analysis views.
- **Features**:
  - Experiment runner view: launch side-by-side runs (e.g. Fixed Small vs. Adaptive).
  - Comparative bar/line charts comparing throughput, latency, and wait times.
  - Adaptation timeline visualizer showing exact points where buffer reallocations occurred and why.
  - Export experiment datasets as CSV/JSON.
- **Files / Modules Expected**:
  - `client/src/components/ComparisonView.jsx`
  - `client/src/components/AdaptationLogView.jsx`
  - `client/src/components/ExportModal.jsx`
- **Dependencies**: Phase 12.
- **Tests**: Comparative data visualization validation against pre-recorded experiment runs.
- **Completion Criteria**: Clear visual comparison showing measured adaptive benefits and costs against matching fixed inputs. This clarifies the original benefits wording under the standing truthful-evidence rule; no favorable outcome or universal improvement is required.
- **Expected Deliverables**: Comparative analysis dashboard views.

---

### Phase 14: Testing and Integration [IMPLEMENTED AND VERIFIED]

Phase14 delivers the real integration orchestrator, bounded native stress harness, isolated sanitizer options and platform CI. Local fresh GCC builds and regressions passed; Linux/Windows/macOS CMake/CTest and Linux ASan/TSan/Valgrind jobs passed. The original full-hour repeated adaptive-batch run completed in3603.466s with828000 completed requests,3107 applied resizes and clean exit0. See PHASE14_COMPLETION_REPORT.md and TESTING_PHASE14.md for commands, evidence and coverage limits. Phase15 deliverables are documented below.
- **Objective**: End-to-end system testing, performance optimization, and hardening.
- **Features**:
  - Comprehensive integration test suite linking C++, Node.js, and client pipelines.
  - Stress testing under extreme burst conditions (10,000+ req/sec).
  - Memory leak checks (AddressSanitizer / Valgrind) and race detection (ThreadSanitizer).
  - Cross-platform build verification.
- **Files / Modules Expected**:
  - `tests/integration_test.py`
  - `tests/stress_test.cpp`
- **Dependencies**: Phase 13.
- **Tests**: 1-hour sustained stress run with dynamic resizing under high concurrency.
- **Completion Criteria**: 0 memory leaks, 0 thread race conditions, 100% clean process shutdowns.
- **Expected Deliverables**: End-to-end verified system with automated test scripts.

---

### Phase 15: Final Evaluation, Report, and Viva Preparation [IMPLEMENTED AND VERIFIED]
Final report,15-slide Markdown presentation content, practical viva guide and bounded real demo dry-run are complete. Three300DPI comparative figures reproduce from all128 tracked Phase9 runs with per-run histogram-bound and logical-slot qualifications. No production implementation or Phase14 historical evidence changed. See PHASE15_COMPLETION_REPORT.md and PHASE15_EVIDENCE.md. No later phase was started.

- **Objective**: Compile experimental results, generate formal performance graphs, and prepare academic deliverables.
- **Features**:
  - Final academic report detailing problem statement, OS architecture, mathematical models, experimental results, and conclusions.
  - High-resolution comparative plots (throughput vs. workload, latency percentiles, memory efficiency).
  - Slide presentation and live viva demonstration scripts.
- **Files / Modules Expected**:
  - `docs/FINAL_REPORT.md`
  - `docs/VIVA_PRESENTATION.md`
  - `data/plots/*.png`
- **Dependencies**: Phase 14.
- **Tests**: Dry-run of complete demonstration workflow.
- **Completion Criteria**: Complete documentation, reproducible benchmark charts, and ready-to-present viva demonstration.
- **Expected Deliverables**: Final project report, presentation slides, and demonstration guide.

