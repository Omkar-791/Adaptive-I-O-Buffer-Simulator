# Phase14 testing, integration, stress and hardening

Date:2 November2026. Overall **PARTIAL**, not complete. Phase15 not started.

## Scope and baseline

Source: DEVELOPMENT_ROADMAP.md Phase14: comprehensive C++/Node/client integration;
10000+req/sec burst stress; ASan/Valgrind memory checks and TSan race detection;
cross-platform builds; one-hour sustained dynamic resizing; zero leaks/races and clean
shutdown. The prescribed tests/integration_test.py and tests/stress_test.cpp are added.
PHASE14_PLAN.md records the requirement/action/verification mapping and architecture.

Initial main at67897ba, tracking origin/main. Six pre-existing untracked data/audit_*
and data/validate_json.js/vjs.js were preserved/excluded. Baseline suites passed:
frontend67, backend40, Python9+25+6 and nine existing native suites. The Python9 first
sandbox attempt failed on a temporary .exe permission; host rerun passed. Backend
localhost checks also required host access. These were environmental failures, not
changes to production behavior. Windows11 build26200, GCC15.2.0 MinGW/MSYS2, Node24.13.0,
Python3.14.3 and installed Edge were used. No dependencies were installed.

## Implementation and review

Phase12 now explicitly reads SUPERSEDED — replacement dashboard delivered in Phase11.
Its historical requirements remain intact; no old gauge/Tailwind/latency/drop/worker
status implementation was added. Phase11/13 files and APIs were preserved.

The Python integration orchestrator reuses existing Node/Vitest/Playwright suites.
It validates native/dependency paths, refuses occupied ports/existing output, records
native SHA256 and stage logs, limits time, invokes backend stop() and stops owned
service trees. Cleanup failures produce failure evidence. Four isolated harness tests
cover timeout cleanup, cleanup errors, early exit and existing-output refusal.
Mocked process/API tests are labelled separately from actual HTTP/native/browser work.

Native stress uses real Simulation with configurable fixed/adaptive batches, bounded
sleep work, safe2s default, explicit --full-hour, optional required actual resizing,
JSONL native samples/results, capacity/accounting checks and measured throughput.
It rejects unsafe/invalid settings and evidence overwrite. Full-hour cannot be combined
with capped cycles. Warmup-only runs cannot return success. Signal handling requests
current-batch drain, then exits interrupted; Windows signal delivery is unverified.
On native execution exceptions last-observed counters remain explicitly partial.

Separate CMake sanitizer build options reject combined/unsupported instrumentation.
CI defines native Linux/Windows/macOS checks and separate Linux ASan/TSan/Valgrind jobs.
These workflow definitions are not remote verification evidence.

Review caught and fixed harness-only issues: cleanup exceptions could lose reports;
no measured batches could return success; full-hour could be shortened by cycle cap;
failed counters could underflow. Unit/CLI tests verify those paths. Independent review additionally caught output overwrite races, unchecked evidence writes
and missing snapshot invariant gates. Cooperative atomic sidecar locking, destination
refusal, checked close/write errors, and observed/final physical-accounting checks now
gate success. Concurrent writer and overwrite faults exit2 and preserve prior evidence;
broken stdout exits2. No production defect
requiring changes to algorithms, frontend or backend was established.

## Requirement-to-evidence matrix

| Requirement | Status | Evidence and command/test reference | Limitation |
|---|---|---|---|
| Comprehensive real integration | PASS | tests/integration_test.py final full report: backend40, frontend67, browser6, activeRuns0, graceful backend stop | Failure injection tests labelled unit, not real crashes |
| Prescribed integration/stress deliverables | PASS | Python orchestrator and actual native C++ stress compiled/executed | See separate duration gate |
| High-rate10000+req/sec burst | PASS | stress-rate-reviewed.jsonl:2240000 completed/3.0269515s=740018.46req/sec | Bounded3s local burst, no sustained-hour claim |
| Actual adaptive resizing smoke | PASS | stress_smoke_reviewed_native14.jsonl:800 completed,15 applied resizes, require-resize met | Short lifecycle workload |
| ASan memory verification | BLOCKED | g++ -fsanitize=address build_phase14/sanitizer_probe.cpp -o build_phase14/asan-probe.exe: cannot find -lasan | Runtime absent; no clean sanitizer result |
| TSan race verification | BLOCKED | Same probe with -fsanitize=thread: cannot find -ltsan | Runtime absent; ordinary tests are not race proof |
| Valgrind leak verification | BLOCKED | Get-Command valgrind finds none; Windows host | No Valgrind run |
| Cross-platform builds | PARTIAL | Fresh local Windows GCC build and nine suites passed; CI matrix added | Linux/macOS jobs not observed; local CMake absent |
| One-hour sustained dynamic resizing | PARTIAL | Explicit full-hour repeated-batch mode implemented; only3–5s checks executed | Full hour not run; batch resets do not prove one uninterrupted Simulation. Safety instrumentation preflight is blocked |
| Zero leaks and races | BLOCKED | Existing ownership/concurrency regression tests pass | Cannot certify without memory/race tooling |
| Clean shutdown | PASS | Nine native suites; real cancel/backend stop; final integration activeRuns0 and both services stopped | Does not prove crash-proof orphan handling or all future shutdowns |
| Protected Phase11/13 behavior | PASS | 271 source/config/workflow/historical hashes unchanged; existing full regression | No source/interface changes |

## Executed commands and actual results

- `npm.cmd --prefix client test`:67 passed baseline; final orchestrator again67.
- `npm.cmd --prefix client run lint`, `run typecheck`, `run build`:all passed;
  build largest chunk397.10kB, no chunk-size warning.
- `server: npm.cmd test`:40 passed,0 skips at baseline and final full integration.
- `python scripts/test_experiments.py`:9 passed on host rerun.
- `python scripts/test_workflow_phase9.py`:25 passed.
- `python scripts/test_exports_phase9.py`:6 passed.
- GCC fresh build: compile each engine/src/*.cpp excluding main.cpp once with
  `g++ -O2 -std=c++17 -Wall -Wextra -Wpedantic -I engine/include -c SOURCE -o OBJECT`;
  link those objects with main.cpp and separately each engine/tests/*.cpp into
  build_phase14. Fresh simulator and all9 fresh test executables built; all9 exited0.
  Stress linked with tests/stress_test.cpp, warning-free. No historical binary replaced.
- `python tests/integration_test.py --native build_phase14/adaptive_io_sim.exe --mode full --output build_phase14/integration-final`:
  PASS. Node40, Vitest67, Playwright6; browser31.9s (stage32.6s). Native executable SHA256
  6eaec21bbbb55ca05375fa70034fe9fbc97fd5a9630d02eae3cb368841adc69d.
  finalHealth.activeRuns=0; backendGraceful=true; frontendStopped=true.
- Earlier full and smoke harness runs used unchanged Phase10 binary; smoke passed2
  real native HTTP tests and2 real browser workflows. Final full used fresh native.
- `python -m unittest discover -s tests -p "test_phase14_*.py"`:4 passed.
  Printed fixture timeout/cleanup failure messages are expected regression inputs.
- Native CLI tests:11 invalid settings rejected with exit2; warmup-only returns1.
- `git diff --check`:passed for Phase14 tracked changes.

## Measured stress results

| Run | Configured intensity | Actual elapsed | Attempted / completed / failed | Actual req/sec | Resize |
|---|---|---:|---|---:|---:|
| Final required-resize smoke |4 streams x100, producer0ms, consumer1ms, fixed+adaptive, capacity2,budget128 |3.1681931s|800 /800 /0|252.51|15 applied|
| Final bounded burst |4 streams x10000 per batch, producer/consumer0ms, BURST, fixed+adaptive;56 batches |3.0269515s|2240000 /2240000 /0|740018.46|0|
| Adaptive duration smoke |4 streams x100, producer0ms, consumer1ms;3 batches |4.73631s|1200 /1200 /0|253.36|45 applied|

Configured rate is null for unpaced workloads; request intensity is not a promised rate.
Timeout/rejection request counts are null because native in-process Simulation has no
such per-request category. Mean latencies in the adaptive duration batches were371.9931,
371.4299 and390.1455ms. The earlier pre-review burst first fixed/adaptive batch means were0.0127/0.0128ms;
full per-batch native latency results are retained in each JSONL artifact.
These are raw scheduling-dependent diagnostics, not adaptive benefit or significance.
No results were cherry-picked to claim a one-hour or sanitizer pass.

## Limitations and remaining gates

CMake not installed locally; dedicated CMake/CTest configurations are unexecuted here.
ASan/TSan link probes fail for missing runtimes. Valgrind absent. WSL listing returned
no installed Linux distribution on host; sandbox probe separately denied access.
Remote Linux/macOS and Windows CMake CI results remain unverified.

Full-hour verification has not run. Current harness provides an hour of repeated real
Simulation/drain/controller-reset batches, not a single persistent controller lifetime.
Resolve compatible sanitizer/memory preflight, then execute and inspect full-duration
output; a continuous-session stress case may still be needed to satisfy the stricter
roadmap interpretation. Ordinary short tests do not establish zero leaks/races.

Existing registry history remains ephemeral and bounded. Backend hard-crash orphan
cleanup is not solved. The integration helper cannot conclusively exclude surviving
grandchildren after an unexpected parent exit; normal graceful manager shutdown and
activeRuns0 were verified, not arbitrary crash-proof process-tree containment. No production behavior, authentication, database or Phase15 work
was added. Test environments/builds/results stay ignored under build_phase14 and existing
client/test-results. See TESTING_PHASE14.md for commands and setup.

## Publication

Intended publication is the verified partial Phase14 implementation, explicitly not
completion. Only .gitignore, CMakeLists.txt, README.md, the minimal roadmap clarification/
Phase14 status, Phase14 plan/testing/report, tests and CI are intended. No existing audit
scratch, native binaries or generated evidence are staged. Commit/push outcome is recorded
in the final task response after the Git gate; no publication success is assumed here.

Final stress commands after independent review:

```
./build_phase14/stress_test.exe --cycles 1 --requests 100 --duration-seconds 2 --require-resize --output build_phase14/stress_smoke_reviewed_native14.jsonl
./build_phase14/stress_test.exe --duration-seconds 3 --requests 10000 --streams 4 --producer-ms 0 --consumer-ms 0 --burst --output build_phase14/stress-rate-reviewed.jsonl
```

Both passed observed occupancy/capacity/budget and final physical/accounting gates.
The final burst and resizing rows above are distinct workloads, not a combined claim
of sustained high-rate resizing. Original measured shorter runs are retained, not deleted.
