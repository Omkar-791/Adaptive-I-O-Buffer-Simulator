# Adaptive IO backend

Node24.x + Express, CommonJS, no database/frontend. See [full API and lifecycle contract](../docs/BACKEND_PHASE10.md).

From this directory:

```powershell
npm.cmd ci --ignore-scripts
$env:NATIVE_EXECUTABLE = (Resolve-Path '../build_phase10/adaptive_io_sim.exe').Path
npm.cmd start
npm.cmd test
```

Build the native simulator first. Default API is http://127.0.0.1:3000/api/v1; health works with native availability=false when unconfigured. Cancellation terminates the process; it is not graceful. State is in-memory and crash-proof child cleanup is not guaranteed. Tests needing localhost/native access require permission in restricted execution environments.

Phase13 comparison clients reuse this unchanged API; see [workflow contract](../docs/PHASE13_API_CONTRACT.md). Pair admission is independent, not transactional; no comparison registry or persistence is added.
