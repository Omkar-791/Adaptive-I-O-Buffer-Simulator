# Phase 13 — Experiment and Analysis Interface

Completed and verified on 1 November 2026. Git publication is recorded below.

## Scope, dependencies and interpretation

DEVELOPMENT_ROADMAP.md's opening Phase11 override and Phase11 completion report
establish that the old Phase12 dashboard was already delivered. The next genuinely
incomplete numbered milestone was Phase13: experiment launch, comparative metrics,
adaptation timeline and CSV/JSON export. No comparison implementation existed.
The pre-implementation plan and requirement mapping are in PHASE13_PLAN.md.

The original acceptance wording about demonstrating benefits is clarified to show
measured benefits and costs, as required by the user's standing evidence rules and
Phase8/9 methodology. Persistence was a recommendation, not a Phase13 deliverable;
no database was added. Phase14 was not started.

## Architecture and implementation

History now embeds ComparisonView. A retained source effective configuration can
launch fixed then adaptive through the existing typed POST API, changing only strategy.
Independent admission and possible concurrent execution are explicit. A rejected
second launch preserves the first ID and its process controls. Duplicate submissions
are blocked. Unmounting during the first POST prevents a second POST; admitted native
processes remain in backend History rather than being falsely reported cancelled.

Existing useRun handles each distinct selected ID's sequential polling, aborts,
cursor/retention, terminal results, retry and cancellation. URL parameters preserve
selection. An identical-ID URL cannot start duplicate observation loops. RunStrip and
AllocationEvents are reused, including actual resize outcomes, capacities, reasons,
native sequence timing and explicit receipt-time fallback for missing snapshots.

analysis.ts compares canonical effective input/metrics, ignoring object-key and stream
ordering. It requires fixed/adaptive roles, completed successes and equal measured
global/per-stream counts and bytes. Three charts use separate units for whole-run
throughput, mean latency and cumulative producer wait. The table exposes exact displayed
values, adaptive-minus-fixed deltas and unavailable percentages for zero baselines.
No result is inferred from a telemetry event or failed lifecycle state.

JSON exports include requested IDs (including missing/evicted IDs), effective config,
actual status/error, successful result or null, retained native events, source and
timestamp, units, loss flags and observation errors. CSV contains metric rows plus the
same complete context in quoted context_json fields; missing values are NA. Large-field
CSV readers may need a larger field limit. Browser object URLs are revoked after use.
Exports are observed snapshots and may be incomplete while a run is active or after
retention loss. No new backend/native endpoint, dependency or algorithm was introduced.
PHASE13_API_CONTRACT.md specified this workflow before implementation.

## Files added and modified for Phase13

Added client/src/components/ComparisonView.tsx and analysis.ts; analysis and component
test files; a verbatim copy of the existing recorded Phase10 native fixture under
client/src/tests/fixtures; client/e2e/comparison.spec.ts; desktop/mobile analysis SVGs;
PHASE13_PLAN.md, PHASE13_API_CONTRACT.md and this report.

Modified History.tsx, existing app.css tokens-based responsive layouts, client/AGENTS.md,
the wireframe inventory test (nine instead of seven layouts), wireframe README,
root/client/server READMEs, ARCHITECTURE.md, DEVELOPMENT_ROADMAP.md and .gitignore.
Added .gitattributes to preserve native/workflow/configuration/historical artifact bytes
in Git: the initial index audit detected automatic newline normalization, which would
otherwise alter provenance hashes even though working files were unchanged.
Native sources, server implementation/API, scripts and historical experiment artifacts
were not edited. Initial publication necessarily includes the supplied pre-Phase13
project because the local repository had no commits and all files were untracked.

## Actual verification

| Check | Command or method | Actual result |
|---|---|---|
| Frontend tests | npm.cmd --prefix client test | 67 passed in 7 files; includes 45 existing + 22 added cases |
| Strict TypeScript | npm.cmd --prefix client run typecheck | Passed |
| Lint | npm.cmd --prefix client run lint | Passed |
| Production bundle | npm.cmd --prefix client run build | Passed; largest chunk 397.10 kB before gzip; no size warning |
| Real browser suite | client: npm.cmd run test:e2e, installed Edge | 6 passed in 33.9 s, zero failed/skipped |
| Backend regression | server: npm.cmd test with host localhost access | 40 passed, zero failed/skipped, including real native runs/cancel/startup/shutdown |
| Python workflow | python scripts/test_workflow_phase9.py | 25 passed |
| Python statistics | python scripts/test_experiments.py with host temp access | 9 passed |
| Python exports | python scripts/test_exports_phase9.py | 6 passed |
| Native regressions | Execute each build_phase10/test_*.exe, check exit code | All 9 existing suites exited 0; this was not a native rebuild |
| CSV independent audit | Python csv.DictReader, increased field limit, JSON context round-trip | 3 rows agree exactly with JSON metrics/results/events |
| Preservation | SHA256 pre/post map of engine/configs/data | 211 files checked, zero changes |
| Publication byte preservation | Compare each protected staged blob with working file | 204 staged native/configuration/historical files byte-identical after .gitattributes |
| Source hygiene | Candidate-file inventory and secret-pattern scan | No matching token/private-key patterns; dependencies/builds/private env files excluded |
| Independent review | Separate read-only reviewer of implementation/contracts/tests | One missing-ID export provenance issue fixed with regression test |

Initial sandbox backend tests failed because localhost fetch was denied; host rerun
passed all40. One Python statistics test could not create its temporary fixture .exe
in the sandbox; host rerun passed all9. A cross-root raw fixture import was denied
by Vite, so tests use a byte-identical test-local fixture. An initial browser suite
passed its five functional cases but the existing seven-wireframe assertion failed
after adding two layouts; the required inventory is now nine and the final suite
passes all6. A test command invoked from the root without package.json failed and was
rerun from the correct client directory. No failed attempt is counted as passing.

## Integration and visual evidence

The final browser comparison created:

- Source: 04dce2ba-fa08-4773-92dd-cb566c886629.
- Fixed: aa8c2cc8-da87-481f-8ed7-53b9d5c11608.
- Adaptive: 55445355-2011-4aae-883f-7c9ded05296e.

Each member consumed400 requests and37842 bytes. The browser verified each chart/table
measurement against the native result endpoint, four actual applied adaptive resize
events, both downloaded formats and bookmark/reload restoration. Normal-flow console
and page errors were zero. Viewport checks covered1440/1280/1024/768/390 pixels.
The existing browser suite separately exercised real launch/terminal results/cancel,
empty/error/retry, missing run and keyboard mobile navigation.

| Whole-run native measurement | Fixed | Adaptive |
|---|---:|---:|
| Throughput (req/s) |126.2979|126.2714|
| Mean latency (ms) |62.4564|171.8221|
| Producer waiting (ms) |6205.1998|5766.5321|

These are integration observations, not an isolated benchmark. Reduced producer waiting
coincided with increased latency; no speedup, significance or universal benefit is claimed.
Machine-readable comparison evidence/downloads remain in ignored client/test-results/.

Both analysis wireframes were rendered and directly inspected before coding. The
desktop wireframe canvas was extended to avoid clipping its last panel. Final real
analysis-desktop.png and analysis-mobile.png were directly inspected after fixing stale
selected-run labels. The layout preserves the graphite/teal hierarchy, uses stacked
mobile charts and internal table/event scrolling, and has no viewport-wide overflow
in executed checks. This is not a formal accessibility or cross-browser certification.

## Acceptance matrix

| Requirement | Implementation evidence | Verification | Status |
|---|---|---|---|
| Next incomplete phase accurately identified | Roadmap override, Phase11 report, absent comparison modules | Repository reconnaissance and plan | PASS |
| Real matched pair launch / historical selection | ComparisonView, existing POSTs, URL selectors | Component launch/partial failure/duplicate/unmount tests; real browser pair/reload | PASS |
| Truthful comparative charts | Canonical input/result gate, 3 independent-unit bars and exact table | Recorded native fixture and mismatch/zero/failure/nonfinite cases; browser endpoint checks | PASS |
| Actual adaptation timeline | Reused AllocationEvents and useRun retention | Four actual resize events with native times/reasons in inspected browser | PASS |
| CSV/JSON datasets | analysisDataset/analysisCsv, requested IDs and loss/errors | Native browser downloads, unit escaping/missing-ID tests, independent CSV audit | PASS |
| Existing system preserved | No native/server implementation edits; existing components reused | 211 hashes; backend/Python/native/browser regressions | PASS |
| Documentation and review | Plan/contract/wireframes/report/readmes/roadmap | Independent review and inspected layouts | PASS |
| Persistent database | Not in current numbered phase; deferred explicitly | No new storage/dependency | NOT APPLICABLE |
| Native rebuild/sanitizers/stress hardening | No native change; separate Phase14 scope | Existing native suite execution only | NOT APPLICABLE |

## Limitations and deferred work

History/results still disappear on backend restart/eviction. Telemetry and exports may
be partial; the UI exposes loss flags. Selected runs use existing authoritative process
states; cancellation is termination, not graceful native shutdown. Admission is not
transactional and configured concurrency/history/time limits still apply. Per-member
errors and any admitted partial pair remain inspectable/exportable.

Concurrent pairs have scheduling contention and one observation per strategy. API
counts/bytes and seeded configurations are checked, but native producer checksums,
executable hashes, plan IDs and significance are not exposed; Phase9 remains the
controlled evaluation workflow. No historical disk-artifact importer or persistence
is claimed. No fresh C++ build, CMake/CTest, sanitizer, sustained stress, CPU overhead or
cross-platform/cross-browser certification was performed in this phase.

## Git publication

Initial inspection: main branch, no commits, all project files untracked. Existing
origin already matched https://github.com/Omkar-791/Adaptive-I-O-Buffer-Simulator.git.
A host git ls-remote origin completed with no refs; no remote history
was replaced. Existing data/audit_* scratch artifacts and data/validate_json.js/vjs.js
are preserved locally and excluded from staging, as are all builds/dependencies/logs,
private environments and runtime locks. Publication outcome will be recorded after
commit/push verification; no success is assumed at the time this report is authored.

The complete initial staged diff was scanned (approximately5.9 MB) for credentials and
unwanted generated artifacts. git diff --cached --check reports inherited whitespace
in supplied files (for example WORKLOAD_GENERATOR.md and run-manager.js, plus blank
lines at EOF); unrelated source was preserved rather than reformatted. These formatting
diagnostics do not change the passing functional checks above.

Next numbered milestone: **Phase14 Testing and Integration**, not started.
