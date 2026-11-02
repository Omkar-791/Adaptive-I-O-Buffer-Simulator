# Adaptive I/O Lab viva demonstration

Target:5–8 minutes after setup. Demonstrate the mechanism and measured tradeoffs;
do not promise adaptive superiority. Full results: [report](FINAL_REPORT.md),
[slides](VIVA_PRESENTATION.md), [figure manifest](../data/plots/manifest.json).

## Prerequisites and build

From the repository root use Node24, Python3, a C++17 toolchain and installed client/
server dependencies. The plot script additionally needs matplotlib (tested3.10.8).
Skip dependency installation when the existing locked environment is already ready.
If needed: `npm.cmd --prefix server ci --ignore-scripts` and `npm.cmd --prefix client ci`.
An installed Playwright browser is required only for automated browser rehearsal; the
Windows default is Edge. Configure PLAYWRIGHT_CHANNEL for another installed channel.

CMake route (a new directory; do not rebuild historical experiment binaries):

```powershell
cmake -S . -B build/viva -DCMAKE_BUILD_TYPE=Release
cmake --build build/viva --config Release --parallel 2
```

With Visual Studio, use `build/viva/Release/adaptive_io_sim.exe` below. Single-config
builds use `build/viva/adaptive_io_sim.exe`. CMake was absent on the local validation
host; this alternative matches its verified GCC route:

```powershell
New-Item -ItemType Directory -Force build/viva | Out-Null
$vivaCore = Get-ChildItem engine/src/*.cpp | Where-Object Name -ne 'main.cpp' | ForEach-Object FullName
g++ -O2 -std=c++17 -Wall -Wextra -Wpedantic -I engine/include $vivaCore engine/src/main.cpp -o build/viva/adaptive_io_sim.exe
./build/viva/adaptive_io_sim.exe --help
```

The already validated `build_phase14/adaptive_io_sim.exe` can be reused locally.
Unix uses extensionless executables and `npm`; see root build instructions for its
toolchain. Never assume an ignored executable exists in a fresh clone.

## Automated bounded rehearsal

```powershell
python scripts/plot_phase15.py
python scripts/test_phase15.py
python scripts/demo_phase15.py --native build_phase14/adaptive_io_sim.exe --output build_phase15/viva-dry-run
```

Choose a NEW output directory for each rehearsal; the script refuses existing ones.
Substitute the newly built executable if needed. Ports3000 and5173 must be free; the
runner refuses conflicts rather than taking over user services. It reuses the existing
real HTTP/native and browser fixed/adaptive/comparison/export/cancel workflows,120s
stage limits and explicit service cleanup. It does not launch an hour test or a benchmark
matrix. Prior browser evidence is copied before the run, new evidence saved separately,
then original files restored and hash-checked. Inspect output/integration/report.json,
dry-run-browser-evidence and evidence-preservation.json. A passed report must show
activeRuns0, backendGraceful=true and frontendStopped=true.

This is the automation counterpart of the complete product demonstration below; it
is not a replacement for explaining the report and figures to the examiner.

## Manual live sequence

**1. Start two owned terminals.** From the root, terminal A:

```powershell
$env:NATIVE_EXECUTABLE = (Resolve-Path './build/viva/adaptive_io_sim.exe').Path
Set-Location server
npm.cmd start
```

Terminal B, from root:

```powershell
Set-Location client
npm.cmd run dev
```

Use the Release subdirectory where applicable. Open `http://127.0.0.1:5173`.
Confirm actual backend/native availability. Explain same-origin proxying and that
history is bounded/in-memory. A disconnected state is an error, not demo data.

**2. Fixed run (about one minute including explanation).** New Simulation: Fixed
Allocation,2 streams,200 requests/stream,seed42,capacity2,budget32,producer0ms,
consumer5ms,payload64–128 bytes,metrics interval50ms/window100ms,STEADY workload.
Launch. Point out real run ID and running/terminal state; there is no artificial
percentage progress. At successful completion expect400 consumed requests, fixed
capacities and a result retrieved through the result endpoint. Do not promise duration.

**3. Adaptive run (about one minute).** Use the same settings with Adaptive Allocation.
Inspect actual capacities and allocation outcomes/reasons in Overview. Under this
pressure configuration real applied changes are normally observable; exact counts and
timing vary. If none occur, report that observation and inspect retained dry-run evidence
instead of inventing an event. Open Configuration/Telemetry/Result to distinguish
effective settings, native elapsed time, receipt timestamps and final measurements.

**4. Matched analysis (about two minutes).** History → Experiment Analysis. Choose
the completed fixed source configuration → Launch matched pair. Two independent POSTs
change strategy only. If admission rejects the second, retain/control the first and
explain the actual error. Once both complete, show the exact throughput/latency/wait
table, separate-unit charts and resize timeline. Reload the URL to demonstrate selected
IDs persist. Existing mismatched runs should show an unavailable comparison, not a winner.
History search/strategy filters apply to actual retained IDs. The pair can contend for CPU;
refer to the tracked Phase9 corpus for controlled multi-repetition evaluation.

**5. Exports.** Export JSON and CSV. Open JSON: actual requested IDs, configs, final
results, records, errors and truncation metadata. CSV has metric rows and quoted full
context_json; readers may need a larger field limit. Check matching counts/bytes in
paired results. Explain absence of whole-run p99/exact percentiles and show the qualified
historical histogram-bound figure instead. Exported partial data is not a completed run.

**6. Cancellation and shutdown.** Optionally launch a fixed10000-request/stream case
with the same5ms service and cancel while running. Wait for authoritative Cancelled;
do not call the button click proof of termination. Successful result is unavailable.
Cancel any remaining active owned run, then Ctrl+C terminal A and terminal B. Do not
kill unrelated processes. Automation verifies normal cleanup; a hard backend crash can
still leave an orphan and is a documented limitation.

## Native-only fallback and offline evidence

If UI/backend startup fails, explain the error and use the same actual simulator:

```powershell
./build/viva/adaptive_io_sim.exe --streams 2 --capacity 2 --budget 32 --requests 200 --producer-ms 0 --consumer-ms 5 --seed 42 --min-payload 64 --max-payload 128 --telemetry --metrics-interval-ms 50 --metrics-window-ms 100
./build/viva/adaptive_io_sim.exe --adaptive --streams 2 --capacity 2 --budget 32 --requests 200 --producer-ms 0 --consumer-ms 5 --seed 42 --min-payload 64 --max-payload 128 --telemetry --metrics-interval-ms 50 --metrics-window-ms 100
```

The ordinary CLI fixed strategy preserves configured capacity; it is not automatically
the experiment fixed_equal baseline. Avoid claiming these are a new controlled benchmark.
For historical experiment reproduction, use the [Phase9 documented workflow](EXPERIMENTS_PHASE9.md)
with a NEW output directory and its experiment_runner target. Its `--help` was verified
using the retained build_phase9 executable; no new matrix is needed during the viva.

If no native runtime is available, present tracked plots, figure_data.csv and manifest,
the formal report and clearly labelled recorded dry-run evidence. Static recorded
screenshots are not live measurements. Report any unavailable evidence explicitly.

## Concise viva Q&A

| Question | Answer |
|---|---|
| What is the OS problem? | Safe bounded producer-consumer buffering and resource allocation under changing demand. |
| Why not just increase every buffer? | The shared slot budget is finite; larger queues can increase latency without raising service capacity. |
| Is the budget bytes or RAM? | Logical active request slots; payload bytes and staging heap/RSS are distinct. |
| What prevents deadlock on normal completion? | Join producers, close queues, drain/join consumers; waits use predicates and close wakes blocked workers. |
| Can shrink discard queued requests? | Executor revalidates live occupancy and preserves FIFO; unsafe plans defer rather than discard work. |
| What does adaptive inspect? | Window utilization, producer/consumer blocking and throughput corroboration, with confirmations/cooldown/bounds. |
| Is adaptive always better? | No. Phase9 pressure cases reduced producer waiting but increased mean latency, with small mixed throughput changes. |
| Are p95 values exact? | Histogram upper boundaries, not raw exact percentiles; p99 is unavailable in the retained corpus. |
| Why match seeds and fingerprints? | To verify nominal generated inputs; backpressure still changes realized wall-clock arrivals. |
| Does the hour test prove speedup? | No. It is207 repeated adaptive batches with clean drains; no controlled fixed counterpart. |
| Does a sanitizer pass prove no future race? | It reports no observed errors in the executed coverage, not every possible workload. |
| What remains limited? | Hard-crash orphan containment, Windows signal verification, ephemeral history and bounded telemetry. |
