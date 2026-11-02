# Phase14 testing, integration, stress and hardening

Date: 2 November 2026. Overall **COMPLETE for the Phase14 acceptance scope**.
All platform/sanitizer CI gates passed. Phase15 has not started.

## Scope and baseline

Source: DEVELOPMENT_ROADMAP.md Phase14 requires comprehensive C++/Node/client integration,
10000+req/sec burst stress, ASan/Valgrind memory checks, TSan race checks, cross-platform
builds, a one-hour dynamic-resizing stress run, and clean shutdown. The exact prescribed
paths tests/integration_test.py and tests/stress_test.cpp are implemented.
PHASE14_PLAN.md maps original requirements to workstreams and evidence.

Initial branch main at67897ba, origin already correct. Six existing data/audit_* and
validation scratch files were preserved and excluded. Baseline frontend67, backend40,
Python9+25+6 and nine existing native suites passed. First sandbox Python9 and localhost
attempts were denied by filesystem/network isolation; host reruns passed. No local project dependency
installation or historical binary replacement occurred. Local environment:Windows11
build26200, MinGW GCC15.2.0, Node24.13.0, Python3.14.3, installed Edge.

## Implementation

Phase12 explicitly says SUPERSEDED — replacement dashboard delivered in Phase11; its
historical requirements remain intact and are not new implementation tasks.

Integration runner: standard-library orchestration of existing suites, trusted native
SHA256, bounded stage timeouts, refusal of occupied ports/existing output, stage logs,
graceful backend stop and owned-service cleanup. Four new harness unit tests cover
failure/timeout paths. Real HTTP/native/browser execution is distinguished from injected
process and mocked API tests. No production frontend/backend or native algorithms changed.

Stress runner: actual fixed/adaptive Simulation batches, configurable workload intensity,
stream count/capacity/budget, producer/consumer, sampling/controller, warmup and duration.
Safe2s default; explicit --full-hour; capped cycles cannot shorten full-hour mode. JSONL
retains native snapshots, resize results and full batch results, actual counts/rates and
interruption status. It checks observed occupancy/capacity/budget and final per-stream
physical/accounting agreement. --require-resize rejects missing actual resize activity.
Output uses cooperative atomic sidecar locking, existing-destination refusal, checked
write/flush/close errors and nonzero failure exits. This is not adversarial file exclusivity.

Dedicated mutually-exclusive Unix GCC/Clang CMake ASan/TSan configurations and CI native
Linux/Windows/macOS, Linux sanitizer and Valgrind jobs are added. CTest fixture paths now
use the repository root. New failure annotations expose remote test diagnostics publicly.

## Review and verified fixes

Independent review found output overwrite/write-failure and snapshot-invariant gaps in
the new stress harness. Those were fixed; overwrite preserves SHA256, concurrent second
writer exits2 while first completes, and broken stdout exits2. Warmup-only success,
shortened full-hour caps, failure counter underflow and cleanup-report loss were also
corrected with CLI/unit checks. Current stress binary rebuilt warning-free.

First remote CI failed because CTest ran fixture-reading native tests from build/.
Locally reproduced missing configs/workload_steady.json from build_phase14; the same
binary passed from repository root. CMake WORKING_DIRECTORY now specifies the root.

macOS exposed a unit-test mock replacing subprocess.run calls used by platform.platform().
Only scripts/test_experiments.py changed in the protection inventory: native-failure
mock is scoped to the canonical fixture path, host metadata is isolated, and additional
exit-code/stderr assertions prove the injected failure actually ran. Stronger assertions
also exposed /var vs /private/var temporary-directory aliases. A Windows statistics job
timeout was recorded during this work; the final complete matrix subsequently passed.
No existing assertion was removed or weakened and no production workflow was changed.

## Actual requirement-to-evidence matrix

| Requirement | Status | Evidence / command reference | Limitation |
|---|---|---|---|
| Real C++/Node/client integration | PASS | tests/integration_test.py final full report:40 backend,67 frontend,6 browser; activeRuns0 | Mock failures labelled separately |
| Prescribed test deliverables | PASS | Python orchestrator, C++ stress target compiled/run,4 harness unit tests | No new framework |
|10000+req/sec burst | PASS | stress-rate-reviewed.jsonl:2240000 completed/3.0269515s=740018.46req/sec | Bounded3s unpaced burst, not one-hour high-rate claim |
| Adaptive resizing | PASS | Final smoke800 completed,15 applied; hour run has repeated actual resizes | Separate from high-rate workload |
| ASan | PASS | Linux ASan CI job at699c99a,12 native/stress CTests | Local MinGW runtime absent; coverage-scoped result |
| TSan | PASS | Linux TSan CI job at699c99a,12 native/stress CTests | Not universal race-freedom proof |
| Valgrind | PASS | Linux job full leak checking, all leak kinds, error-exitcode99, runtime-resizing suite | Only the executed target |
| Cross-platform build/test | PASS | Linux/Windows/macOS CMake+CTest jobs at699c99a,15 CTests each | Local Windows fresh GCC also passed; no cross-browser certification |
| One-hour dynamic-resizing stress | PASS | Original run3603.4664745s,207 batches,828000 completed,3107 applied resizes; execution session exit0 | Repeated native batches, not one uninterrupted controller lifetime |
| Zero observed leaks/races in executed checks | PASS | ASan/TSan suites and Valgrind success | No guarantee outside tested workloads |
| Clean shutdown | PASS | Fresh nine native suites; actual cancel/backend stop; activeRuns0 and services stopped | Hard-crash orphan containment not proved |
| Phase11/13 preservation | PASS |270 protected hashes unchanged; one intentional test-only portability fix; full existing regressions | No production/API redesign |

## Executed tests and commands

- `npm.cmd --prefix client test`:67 passed baseline and final orchestration.
- `npm.cmd --prefix client run lint`, `run typecheck`, `run build`:passed.
  Largest production chunk397.10kB; no size warning.
- `server: npm.cmd test`:40 passed,0 skips at baseline and final integration.
- `python scripts/test_experiments.py`:9 passed after portable-fixture fixes.
- `python scripts/test_workflow_phase9.py`:25 passed.
- `python scripts/test_exports_phase9.py`:6 passed.
- Fresh native GCC compile: each engine/src/*.cpp excluding main.cpp with
  `g++ -O2 -std=c++17 -Wall -Wextra -Wpedantic -I engine/include -c SOURCE -o OBJECT`;
  link core objects with main.cpp, each engine/tests/*.cpp, and tests/stress_test.cpp
  into build_phase14. Simulator and all9 fresh suites built; every suite exited0.
- `python tests/integration_test.py --native build_phase14/adaptive_io_sim.exe --mode full --output build_phase14/integration-final`:
  PASS, backend40/Vitest67/Playwright6; browser31.9s. Native SHA256
  6eaec21bbbb55ca05375fa70034fe9fbc97fd5a9630d02eae3cb368841adc69d.
  finalHealth.activeRuns=0; backendGraceful=true; frontendStopped=true.
- Earlier orchestrator smoke using unchanged Phase10 binary passed2 real native HTTP
  and2 real browser workflows. Final full used fresh native.
- `python -m unittest discover -s tests -p "test_phase14_*.py"`:4 passed.
  Printed fixture timeout/cleanup failures are expected unit inputs.
- Native CLI:11 invalid settings rejected with exit2; no measured batches exits1.
- Local sanitizer link probes failed with missing -lasan/-ltsan. CMake/Valgrind absent
  locally. WSL host listed no installed Linux distro. Remote verification resolved these
  verification gaps; local tooling was not fabricated or installed.

## Remote CI evidence

[Run41405648589](https://github.com/Omkar-791/Adaptive-I-O-Buffer-Simulator/actions/runs/41405648589)
at code commit699c99a completed all six jobs successfully: Linux/Windows/macOS native
CMake/CTest (15 each, including Python suites), Linux ASan and TSan (12 each), Valgrind
runtime-resizing. Memory/race flags halt on error; Valgrind errors exit99. These are
observed executions, not inferred workflow support. Earlier failures remain visible.
Authenticated log archive reads returned401; public job results and failure annotations
provided the actual diagnostic evidence. No token was printed or committed.

## Stress measurements and semantics

| Run | Workload | Elapsed | Attempted/completed/failed | Actual req/sec | Applied resizes |
|---|---|---:|---|---:|---:|
| Reviewed resizing smoke |4 streams x100,producer0ms,consumer1ms,fixed+adaptive,capacity2,budget128|3.1681931s|800/800/0|252.51|15|
| Reviewed bounded burst |4 streams x10000 per batch,producer/consumer0ms,BURST,fixed+adaptive,56 batches|3.0269515s|2240000/2240000/0|740018.46|0|
| Earlier adaptive duration smoke |4 streams x100,consumer1ms,3 batches|4.73631s|1200/1200/0|253.36|45|

Unpaced configured rate is null; configured count is not achieved throughput. Native
in-process Simulation has no per-request timeout/rejection category, so those counts are
null rather than fabricated zeroes. Adaptive smoke batch mean latencies:371.9931,
371.4299,390.1455ms. Earlier burst first-batch fixed/adaptive means:0.0127/0.0128ms.
All JSONL retains actual per-batch latency/resize details, including slow results.
No significance/universal-benefit inference is made.

Hour command (started after bounded resource/sanitizer preflight;33.5GiB free disk):

```
./build_phase14/stress_test.exe --full-hour --require-resize --strategy adaptive --requests 1000 --consumer-ms 1 --interval-ms 100 --window-ms 200 --output build_phase14/stress-hour-final.jsonl
```

This is one stress process running repeated real Simulation/drain/controller-reset
batches for a full-hour target. Four streams/eight producer-consumer workers, capacity2,
budget128; it does not claim one uninterrupted controller lifetime. Duration may overshoot
by one bounded batch. The original run completed normally and was recovered after the
usage-limit interruption; no duplicate or replacement hour run was launched.

### Newly verified final hour result

- Original retained execution session73402 returned actual exit code0 on recovery.
  Host process inventory showed no remaining stress_test.exe process.
- First/last file writes:2 November2026,12:36:39.351269–13:36:42.817606 IST
  (07:06:39.351269–08:06:42.817606 UTC). Filesystem wall span3603.4663367s;
  harness steady-clock elapsed3603.4664745s. Both exceed the requested3600s.
- 207 completed adaptive batches;828000 attempted=828000 completed;0 failed.
  Per-request timeout/rejection counts remain null because the native API does not
  provide those categories; they are not silently assumed zero.
- 3107 applied,7 deferred,0 rejected resize operations (3114 native resize records).
  Aggregate achieved throughput229.7787438455 completed requests/second, including
  the long batch; the separate short burst result is not substituted for this rate.
- All207 clean_drain checks passed; duration_target_reached=true,
  resize_requirement_met=true, interrupted=false, clean_drains=true.
- Independent recovery audit parsed every JSONL record strictly:30063 snapshots,
  all resize transitions,207 final batch results and exactly one terminal summary.
  It checked occupancy/capacity/budget, per-stream counts, final physical capacities,
  exported allocation accounting, native sequence/elapsed ordering within each batch,
  and exact agreement between batch aggregates, native events and the final summary.
  The harness also checked actual resource-manager allocation agreement before
  reporting each successful drain.
- Sum of measured batch durations3603.4436237s; longest batch360.8972455s.
  Batch native mean latency range469.405–12187.9381ms. The long batch coincided with
  a delayed monitor wait; its cause is not established, and it was retained untrimmed.
  This is not a controlled performance-comparison or significance claim.
- Evidence:build_phase14/stress-hour-final.jsonl (68398955 bytes), SHA256
  c1fa34ea266514e67bcc6c19e4fdd78b48c5f97aca638c98bb4111005cfe5493.
  Recovery audit:build_phase14/hour-validation-resume.json. Both remain ignored,
  preserved locally and excluded from Git publication.

Workload:4 streams/eight producer-consumer workers,1000 requests per stream per
batch, initial capacity2 per stream, logical budget128, unpaced producer,1ms
configured consumer work,64-byte payloads,seed42,100ms sampling/200ms windows,
controller step2/confirmation1/cooldown20ms,zero warmup. The complete parameters
record is preserved in the original evidence. This is a full hour of repeated actual
Simulation lifecycles with dynamic resizing, not one uninterrupted Simulation instance.

## Preservation, limitations and publication

No native engine, client or server implementation changed. Historical artifacts,
configuration, production experiment workflows and other protected sources remain byte
unchanged. One test-only fixture correction is justified above; all existing Phase11/13
browser workflows, URL state, results, exports and cancellation passed final integration.
Builds/reports remain ignored; pre-existing six audit scratch files remain untracked.

Normal owned-service shutdown is verified. The Python helper cannot conclusively exclude
surviving grandchildren after an unexpected parent exit, and existing backend hard-crash
orphan containment is not newly solved. Windows signal delivery for the in-process stress
harness is not independently tested; normal final drains are tested. No persistence,
authentication, dashboard redesign or Phase15 implementation was introduced.

Implementation publication commits and the final remote hash are reported in the final
response. Early commits truthfully recorded partial gates; CI fixes and subsequent real
checks resolved them. Recovery revalidated the unchanged final integration report and native executable hash,
its backend40/frontend67/browser6 passing logs, and all six actual jobs in CI run41405648589
at699c99a103f596b6e24faa4093e746676f0723d6. Those checks were not rerun unnecessarily.
The271-file protection inventory was recomputed:only the documented test-only
scripts/test_experiments.py correction differs; all other270 files match their baseline.
No mandatory acceptance gate remains unverified in the stated test scope. The phase is
complete; Phase15 is the next roadmap milestone and has not been started.

Code through699c99a was already pushed and its remote hash reconfirmed on recovery.
The final documentation reconciliation is published separately; its commit/push outcome
is verified in the final task response, without assuming success in advance.
See TESTING_PHASE14.md for setup/smoke/hour/sanitizer/platform commands.
