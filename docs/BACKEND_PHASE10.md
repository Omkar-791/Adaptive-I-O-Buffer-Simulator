# Phase 10 Node.js backend bridge

## Install, build and run

Validated with Node24.13.0 (supported24.x LTS branch), npm11.6.2 and locked Express5.3.0. From the project root, build the unchanged native simulator using CMake when available, or GCC17:

```powershell
New-Item -ItemType Directory -Force build_phase10 | Out-Null
$core = Get-ChildItem engine/src/*.cpp | Where-Object Name -ne 'main.cpp' | ForEach-Object FullName
g++ -O2 -std=c++17 -Wall -Wextra -Wpedantic -I engine/include $core engine/src/main.cpp -o build_phase10/adaptive_io_sim.exe
cd server
npm.cmd ci --ignore-scripts
$env:NATIVE_EXECUTABLE = (Resolve-Path '../build_phase10/adaptive_io_sim.exe').Path
npm.cmd start
```

The backend listens on127.0.0.1:3000 by default. Without NATIVE_EXECUTABLE it still starts, health reports unavailable, and run creation records a failed native launch. Configure an absolute trusted path; relative settings resolve against the project root. HTTP requests cannot choose an executable/path/argv/cwd.

```powershell
# From server/ after building the simulator:
npm.cmd test
npm.cmd run test:real
# Optional explicit integration-test executable:
$env:NATIVE_TEST_EXECUTABLE = (Resolve-Path '../build_phase10/adaptive_io_sim.exe').Path
npm.cmd test
```

Full tests use built-in node:test/fetch with deterministic injected processes and real native integration. Real tests can skip if no native binary exists; build first and inspect skip counts. The completed validation had zero skips. No frontend, database, SSE or WebSocket server is introduced.

## API

All endpoints are under /api/v1. JSON errors have shape {error:{code,message}}; public responses contain no stack traces, filesystem paths or raw native stderr. Cache-Control:no-store is used.

| Method/path | Behavior |
|---|---|
| GET /health |200 backend status, native configured/available, activeRuns and concurrencyLimit; availability checks a regular accessible executable file, not every possible DLL/runtime dependency |
| POST /runs |202 admitted run summary; requires uncompressed UTF8 application/json, maximum64KiB |
| GET /runs?limit=20 |Bounded recent {runs}; includes active and terminal runs, oldest terminal runs evicted when registry is full |
| GET /runs/:id |Run summary, canonical effective configuration, backend timestamps, statusUrl, progress:null and safe error |
| GET /runs/:id/telemetry?after=0&limit=100 |Bounded events, nextCursor, oldestCursor and truncated flag |
| GET /runs/:id/result |Original validated native completion JSON only after successful process close;409 otherwise |
| POST /runs/:id/cancel |202 termination requested; no fields needed;409 if terminal/finishing |

Unknown/evicted IDs return404. Bad JSON/query values return400; bad/unsupported configuration422; oversized body413; unsupported content/encoding415; forbidden Host/Origin403; concurrency/history admission and stopping errors503. A valid admitted request can already be failed in its202 summary if native launch fails; status/error remains retrievable. No queue is hidden behind the concurrency limit.

Example request (field values are an example, not a recorded benchmark):

```json
{"strategy":"adaptive","config":{"global_buffer_budget":16,"streams":[{"stream_id":0,"name":"hot","buffer_capacity":8,"num_requests":50,"consumer_processing_ms":1,"workload":{"type":"STEADY","base_interval_ms":0,"min_payload_bytes":64,"max_payload_bytes":128,"seed":42}},{"stream_id":1,"name":"idle","buffer_capacity":8,"num_requests":0,"consumer_processing_ms":0,"workload":{"type":"STEADY","base_interval_ms":5,"seed":142}}]},"metrics":{"interval_ms":20,"window_ms":100}}
```

```powershell
$body = @{strategy='fixed';config=@{num_streams=1;buffer_capacity=8;num_requests=10;producer_interval_ms=0;consumer_processing_ms=1}} | ConvertTo-Json -Depth 8
$run = Invoke-RestMethod -Method Post -Uri http://127.0.0.1:3000/api/v1/runs -ContentType application/json -Body $body
Invoke-RestMethod -Uri ("http://127.0.0.1:3000" + $run.statusUrl)
Invoke-RestMethod -Uri ("http://127.0.0.1:3000/api/v1/runs/" + $run.id + "/telemetry")
```

Poll until completed before fetching /result. A summary includes id,status,createdAt,startedAt,endedAt,progress,error,cancellationMode,cancellationRequested,configuration and statusUrl. Creation/start/end timestamps are backend UTC wall time, distinct from native elapsed_ms/window_ms. Progress is unavailable rather than an invented percentage.

## Accepted configuration and normalization

strategy is fixed (default) or adaptive. fixed preserves configured capacities; it is not the Phase8 fixed_equal allocation baseline. Both uniform native inputs and heterogeneous streams are accepted; they normalize to explicit heterogeneous configs with honored workload seeds. Names are safe ASCII letters/digits/space/underscore/dot/dash, length1..64, because native completion names are not JSON-escaped. Public configuration returns the effective values.

Uniform fields: num_streams,buffer_capacity,num_requests,producer_interval_ms,consumer_processing_ms,min_payload_bytes,max_payload_bytes,random_seed,global_buffer_budget,workload. Heterogeneous root fields: streams,global_buffer_budget,num_requests; stream fields additionally allow stream_id/name. No duplicate IDs or unknown fields are accepted. Uniform seed base is explicit workload.seed if supplied, otherwise random_seed/default42, incremented by100 per stream modulo2^32; heterogeneous workload seeds are honored and reflected in effective random_seed. If a uniform budget is supplied without capacity, equal integer capacities are calculated; explicit capacities are preserved and must fit the budget.

Bounds:1..16 streams,1..64 slots/stream, global budget1..1024,0..10000 requests/stream and at most100000 total,0..1000ms producer/service/workload intervals, payload0..1048576 bytes with valid ranges, uint32 seeds/IDs. Workloads STEADY/BURST/PERIODIC/STOCHASTIC/MIXED support actual JSON-parser fields: base/burst interval, burst/normal length, period length, amplitude0..100, nonnegative lambda, payloads, seed/stream association and up to32 uniquely named bounded phases. Unknown fields, native-JSON-unsupported periodic interval arrays, root min/max/controller tuning and arbitrary executable/config file paths are rejected. Empty request workloads are supported.

Sampling interval10..1000ms, window>=interval and <=60000ms. These are deliberately smaller local-service limits than the native integer maxima. The policy itself is unchanged; advanced native experiments remain available through the existing CLI/workflow.

## Native protocol and lifecycle

Use spawn(trustedExecutable, argumentArray, {shell:false,windowsHide:true,controlled cwd,whitelisted runtime environment}). Generated config files are isolated in server/.runs/run-*/config.json, with no user-derived paths, and removed after confirmed child close. Cleanup checks the exact owned parent/name before recursive removal. PATH/system/temp/runtime-library variables are the only inherited environment entries, not arbitrary service secrets.

The child emits metrics_snapshot, optional buffer_resize and one simulation_completed. Incremental fatal UTF8 decoding handles split chunks, multiple lines and a valid final line without newline. Invalid/truncated/unknown records, inconsistent counters/IDs/budgets/configuration echoes, duplicate completion, output after completion and nonzero exit fail the run. Completion requires final-snapshot agreement and successful exit/close; receipt of a completion object alone is insufficient.

States: starting -> running -> completed/failed/cancelled/timed_out (launch failure can go directly from starting to failed). Admission reserves a slot before async setup. Terminal state/result is retained; concurrency releases only after actual close and cleanup. Telemetry wraps original native records with backend index/receivedAt. Retention eviction is explicit through cursor metadata; the final result is stored separately.

Native cancellation is NOT graceful: there is no stdin/signal cooperative stop protocol. Cancel/timeout sends SIGTERM, then SIGKILL after250ms if needed. Status remains starting/running until close/cleanup confirms termination. Forced shutdown does not guarantee drain or final metrics, and /result remains unavailable. If close is never confirmed, the active slot remains occupied and shutdown rejects SHUTDOWN_INCOMPLETE after5s rather than claiming success.

## Limits and environment

| Setting | Default | Accepted environment range |
|---|---:|---|
| HOST |127.0.0.1|127.0.0.1,::1,localhost only|
| PORT |3000|0..65535 (0 useful for tests)|
| NATIVE_EXECUTABLE |unset|Trusted operator-supplied path|
| MAX_CONCURRENT_RUNS |2|1..8|
| MAX_RUN_HISTORY |20|8..100, registry includes active runs|
| TELEMETRY_RETENTION |100|1..500 records/run|
| TELEMETRY_BYTES |1048576|65536..1048576 bytes/run|
| RUN_TIMEOUT_MS |30000|100..300000|
| BROWSER_ORIGIN |unset|Optional explicit loopback frontend origin|

Native line64KiB; combined stdout/stderr16MiB/run; stderr retention8KiB and never public. Total telemetry is limited by both count and bytes; native final results have their own line bound. HTTP headers/request/keepalive timeouts are10s/15s/5s. Loopback Host and Origin checks plus JSON-only creation prevent arbitrary browser origins from driving local processes; an optional explicit loopback BROWSER_ORIGIN enables a future frontend. No full authentication system is present: do not expose this as a remote multi-user service.

## Limitations

The in-memory registry/results disappear on backend restart. Normal close/cancel cleanup is tested, but a hard-killed/crashed backend can leave a native child or temp input behind without OS process supervision. Do not assume timers survive a backend crash; inspect processes before manually removing abandoned artifacts. Native termination is forced and cannot promise request draining. File accessibility health does not guarantee launch dependencies are installed. This is a local development bridge, not a production job scheduler. Historical experiment workflows/results are separate and unchanged.
