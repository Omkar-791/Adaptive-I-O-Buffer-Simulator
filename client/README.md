# Adaptive I/O Lab frontend

React, Vite and strict TypeScript client for the Phase10 loopback bridge. The custom CSS/token stack already established under the original Phase11 specification is preserved; the revised specification's compatible-existing-frontend exception applies. No controller logic lives in this client.

## Local setup

Use Node24 (the backend requires >=24 <25), npm and a built native executable. From the repository root:

```powershell
# Terminal1: backend
cd server
npm.cmd ci --ignore-scripts
$env:NATIVE_EXECUTABLE = (Resolve-Path '../build/adaptive_io_sim.exe').Path
npm.cmd start
# Or point NATIVE_EXECUTABLE at your own build/adaptive_io_sim.exe.
```

```powershell
# Terminal2: frontend
cd client
npm.cmd ci
npm.cmd run dev
```

Open http://127.0.0.1:5173. The Vite development/preview proxy sends `/api` to http://127.0.0.1:3000 while preserving the browser Host, satisfying the existing loopback Host/Origin boundary. Native build instructions remain in the root README. Stop the Vite server before running `npm ci` on Windows: the active esbuild binary is locked.

Copy `.env.example` to `.env.local` only if changing the API base. Default `VITE_API_BASE_URL=/api/v1` uses same-origin proxying. A separate backend origin needs its `BROWSER_ORIGIN` set to the exact browser origin; see server/README.md. Vite variables are public build-time configuration, not secret storage. Backend HOST/PORT/NATIVE_EXECUTABLE and concurrency/timeout/retention settings remain owned by server/.

## Routes and implementation

- `/`: current/selected retained run, native charts, allocation events and streams.
- `/simulations/new`: validated uniform configuration for all five accepted workload types. `/runs/new` remains a compatibility alias.
- `/runs/:runId?tab=overview|telemetry|configuration|result`: URL-addressable inspection views.
- `/history`: bounded backend history with Run ID search, filters, results and Phase13 matched-pair launch/comparison/export.
- `/architecture`: actual responsibility and data-flow diagram.

`src/api/client.ts` centralizes typed fetch requests, abort handling and safe API errors. `src/types/api.ts` records the actual contract. `src/hooks/useRun.ts` owns lifecycle and telemetry. Shared RunView and Recharts components render only received measurements. `src/pages/validation.ts` contains pure form validation. `src/styles/tokens.css` owns the palette; app.css owns the responsive shell and components. Follow AGENTS.md and ../docs/design/wireframes/ for changes.

The client polls selected-run status and telemetry sequentially every500ms after successful active responses, never overlapping loop requests. Event index is the deduplication/order key. Cursor commit follows validated page processing. Terminal runs drain remaining pages and stop; successful completion retrieves the separate result endpoint. Transient failures retain data and use bounded retries, then manual retry. Browser retention is600 records, separate from backend record/byte limits; both omissions are disclosed. Native elapsed seconds remain distinct from backend receipt timestamps. Cancellation requests process termination and waits for authoritative backend state.

## Verification

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd run build
npm.cmd test
# Backend and frontend must be running with a native executable:
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

Browser tests default to installed Microsoft Edge on this Windows environment, with a screenshot-surface workaround for the installed Playwright/browser combination. Configure `PLAYWRIGHT_CHANNEL=chromium` when using downloaded Chromium instead. Test-only fixtures never populate production state. E2E creates real fixed/adaptive/cancelled runs in the local in-memory backend. Test artifacts and screenshots remain ignored in test-results/.

## Limits

History/results disappear on backend restart or eviction. Opening an old completed run may recover only the backend's retained telemetry, while its separate final result remains available until registry eviction. No persistence, authentication, WebSocket transport, pause/resume or multi-repetition experiment-runner UI is claimed. Phase13 adds descriptive single-pair analysis. The form uses supported uniform settings; arbitrary heterogeneous per-stream editing and controller threshold tuning are outside its scope. Per-stream worker state is unavailable; the table labels run state. Whole-run percentiles are not exposed by this completion contract. Cancellation is termination and need not yield a successful result. The backend timeout defaults to30seconds, so long configurations can time out. Current npm audit reports development-tool advisories in ESLint's minimatch dependency chain; production-only audit is clean. No forced major override is applied to lint dependencies.


## Matched comparison workflow

In History select a source configuration, then Launch matched pair. Only strategy changes;
POSTs are independent, and a rejected second launch leaves the first controllable.
Select existing fixed/adaptive IDs to inspect another retained pair, or bookmark the URL
query. One useRun loop per distinct member handles all live/terminal lifecycle behavior.
Successful matching final results populate independent throughput/latency/wait charts
and the exact measurement table. Mismatches and unavailable results never populate it.
Run links expose full effective settings. Resize events reuse the native allocation viewer;
a missing correlated snapshot falls back to explicitly labelled receipt time.

JSON and CSV export actual status/errors/configurations/results and retained telemetry,
requested IDs even after eviction, truncation flags and observation errors. Missing values
are null (JSON) or NA (CSV). CSV context_json contains the full JSON dataset per metric row;
large-field readers may need a higher field size limit. No server storage is added.

These pairs may overlap and contend for CPU/timers; they are descriptive, not Phase9
counterbalanced/checksum/provenance-controlled experiments or significance evidence.
See ../docs/PHASE13_API_CONTRACT.md and PHASE13_COMPLETION_REPORT.md for contract/tests.
