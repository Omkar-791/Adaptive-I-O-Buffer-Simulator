# Phase 13 — Experiment and Analysis Interface: execution plan

## Scope and interpretation

Source: DEVELOPMENT_ROADMAP.md Phase 13 and its Phase11 scope override,
PHASE11_COMPLETION_REPORT.md, and the Phase8/9 experiment methodology.
The old Phase12 dashboard is already delivered by Phase11. Phase13 is absent.
Dependencies: verified Phase10 process/API contracts and Phase11 React dashboard.
Persistence is a recommendation, not a numbered Phase13 requirement; it remains deferred.
The old acceptance wording about demonstrating benefits is interpreted as displaying
observed benefits AND costs, consistent with the standing prohibition on fabricated
or universal adaptive superiority. One UI pair is descriptive, not a controlled
multi-repetition Phase9 benchmark.

## Traceability and implementation plan

| Requirement | Existing implementation | Missing work / modules | Verification | Acceptance |
|---|---|---|---|---|
| Launch side-by-side fixed/adaptive | POST runs; normalized effective config | ComparisonView in History clones one retained configuration, changes strategy only, submits fixed then adaptive; preserves first ID if second fails | component + real browser launch, partial rejection | both real IDs/statuses shown |
| Historical comparative analysis | bounded in-memory History | URL query fixed/adaptive selectors; exact canonical config/metrics equality gate | mismatch, swapped strategies, missing/evicted IDs | comparisons only for matched completed successes |
| Throughput/latency/wait charts | final result endpoint; Recharts | three independent-unit bar charts + exact value table; adaptive-minus-fixed delta and zero-baseline unavailable percent | recorded native fixture, zero, negative, positive deltas | chart data agrees with returned result |
| Adaptation timeline and reason | AllocationEvents + useRun | reuse existing viewer for both selected runs; disclose backend/browser truncation and receipt-time fallback | native sequence correlation and real resize browser case | actual capacities/reasons only |
| CSV/JSON export | API results/telemetry | pure analysis module exports full JSON dataset and CSV metric rows + JSON context with run configurations/results/retained records/loss metadata | escaping, nulls, failed/partial runs, real downloads | truthful round-trip data |
| Tests/documentation | Vitest/Playwright/native/Python suites | analysis unit/component/browser tests; Phase13 contract/report; accurate roadmap/readmes | lint/types/build/regressions/preservation hashes | actual outcomes recorded |

## Architecture and interfaces (before implementation)

No new backend endpoint is necessary. The separately specified workflow contract is
PHASE13_API_CONTRACT.md. Existing Express validation/native subprocess ownership,
admission limits, cancellation, history eviction and API shapes remain authoritative.
No native code, algorithms, database, framework or historical artifact changes.

ComparisonView owns source selection, duplicate-submit guard, partial-launch errors,
and fixed/adaptive URL query IDs. Existing useRun instances each own one distinct
selected run's sequential polling, aborts, terminal draining, retry and cancellation.
Changing/unmounting the view stops requests, never pretends the process was cancelled.
Launch POSTs deliberately finish independently of navigation: submitted process IDs
remain in backend History. An unmounted launch must not initiate the second POST.

analysis.ts owns canonical matching (object key order ignored; streams sorted by ID),
finite whole-run metric rows and export serialization. Inputs are actual API objects;
outputs contain no invented samples or unavailable metrics. No interpolation or
significance testing. JSON includes configuration, statuses/errors, results or null,
retained native events, export timestamp, metric units and limitations. CSV includes
the same context serialized in a quoted field so provenance/loss is not discarded.
Downloads use browser Blob/object URLs with cleanup; no server filesystem writes.

Reuse shell/tokens/responsive table layout, RunStrip and AllocationEvents. Add no
route/page or duplicated polling implementation. Create and inspect analysis desktop
and mobile SVG wireframes before implementation; reference them in client/AGENTS.md.

## Preservation and publication

Save SHA256 baseline of engine/configs/data and existing source files before coding.
Compare protected files afterwards. Initial git has no commits; all supplied files
are untracked, origin is correct. Publication therefore needs an initial project
commit including the supplied source/docs/locked manifests/historical data, excluding
builds, dependencies, environments, credentials and transient logs. Inspect remote
history before committing; never overwrite remote commits. Record actual Git outcome.
