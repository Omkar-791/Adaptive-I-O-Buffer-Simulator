# Phase14 testing and integration

Run from the repository root. Requires C++17 GCC/Clang/MSVC, CMake3.15+ for the
CMake route, Node24 with existing server/client locked dependencies, Python3 and
an installed Playwright browser. No new Python packages are required.

## Native builds and isolation

```
cmake -S . -B build_phase14/normal -DCMAKE_BUILD_TYPE=Release
cmake --build build_phase14/normal --config Release --parallel 2
ctest --test-dir build_phase14/normal -C Release --output-on-failure --timeout 180
```

Multi-config Windows executables are in Release/. Without CMake use the root README
GCC procedure with output under build_phase14; link tests/stress_test.cpp with the
same core objects (all engine/src except main.cpp). Never rebuild historical binaries.

## Real system integration

```
python tests/integration_test.py --native build_phase14/adaptive_io_sim.exe --mode full --output build_phase14/integration-new
python tests/integration_test.py --native build_phase14/adaptive_io_sim.exe --mode smoke --output build_phase14/integration-smoke-new
python -m unittest discover -s tests -p "test_phase14_*.py"
```

On Unix use the extensionless native executable. Both modes require the actual simulator,
not a fixture. The runner refuses existing output directories and occupied ports3000/5173.
It starts isolated loopback backend and Vite, passes trusted executable paths, bounds
stage duration, requests existing graceful backend stop, then stops its own service trees.
A JSON report and separate stage logs preserve outcomes and cleanup. Browser tests write
their established ignored client/test-results evidence. Full includes existing Node
failure tests (injected unit processes explicitly labelled), Vitest mock API tests and
all Playwright cases. Smoke selects real native HTTP/cancel and real browser workflows.
No mocked test is reported as native end-to-end verification.

## Stress: bounded default and explicit full duration

```
build_phase14/stress_test.exe --duration-seconds 3 --strategy both --output build_phase14/stress-smoke-new.jsonl --require-resize
build_phase14/stress_test.exe --duration-seconds 3 --requests 10000 --streams 4 --producer-ms 0 --consumer-ms 0 --burst --output build_phase14/stress-rate-new.jsonl
build_phase14/stress_test.exe --full-hour --require-resize --strategy adaptive --requests 100 --consumer-ms 1 --output build_phase14/stress-hour-new.jsonl
build_phase14/stress_test.exe --help
```

Unix uses extensionless executables. Output paths must be new. JSONL contains environment,
parameters, actual native samples/resize outcomes and per-batch native results/mean latency,
then attempted/completed/uncompleted counts and completed/wall-time throughput. Unpaced
load has configured_rate=null, not an invented request rate. Timeouts/rejections are null
because the in-process Simulation does not expose these categories. Use actual observed
throughput to judge10000+ req/sec, not the configured request count.

Stress uses repeated fresh actual Simulation batches; state/controller reset each batch.
It is not one uninterrupted hour-long Simulation. Warmup is optional. Reporting/sampling,
work intensity, streams, budget/capacity and controller settings are configurable. SIGINT
or SIGTERM requests stopping after current bounded batch drains. Duration may overshoot
by a strategy cycle. This does not add a native cancellation protocol. Inspect host resource
impact using a smoke run before full duration. A full-hour completion and sustained resize
activity must be independently confirmed from actual output; smoke cannot satisfy it.

## Sanitizers and leak detection

Use separate fresh build directories. ASan and TSan cannot be combined. Options reject
unsupported Windows/compiler combinations instead of silently omitting instrumentation.

```
cmake -S . -B build_phase14/asan -DCMAKE_BUILD_TYPE=Debug -DADAPTIVE_IO_ASAN=ON
cmake --build build_phase14/asan --parallel 2
ASAN_OPTIONS=detect_leaks=1:halt_on_error=1 ctest --test-dir build_phase14/asan --output-on-failure --timeout 180
cmake -S . -B build_phase14/tsan -DCMAKE_BUILD_TYPE=Debug -DADAPTIVE_IO_TSAN=ON
cmake --build build_phase14/tsan --parallel 2
TSAN_OPTIONS=halt_on_error=1 ctest --test-dir build_phase14/tsan --output-on-failure --timeout 180
valgrind --leak-check=full --show-leak-kinds=all --errors-for-leak-kinds=all --error-exitcode=99 build_phase14/normal/test_runtime_resizing
```

Environment-variable command prefixes above are POSIX-shell syntax. Run on a compatible
Unix sanitizer runtime. Successful ordinary concurrency tests are not evidence of race
freedom. The installed Windows MinGW runtimes must not be assumed to support instrumentation.

## Platform verification

.github/workflows/phase14.yml defines native CMake tests on Linux/Windows/macOS, separate
Linux ASan/TSan jobs and Linux Valgrind. Workflow configuration is not execution evidence;
check actual job logs and conclusions before declaring platform/safety acceptance.

See PHASE14_COMPLETION_REPORT.md for executed results, unresolved acceptance and baseline
preservation. Phase15 must wait until the remaining Phase14 gates are resolved.

Evidence writers use cooperative atomic sidecar locking. Existing destinations and concurrent writers are rejected; stale locks require inspection rather than automatic takeover. Write/close failures return nonzero. This is not adversarial filesystem exclusivity.
