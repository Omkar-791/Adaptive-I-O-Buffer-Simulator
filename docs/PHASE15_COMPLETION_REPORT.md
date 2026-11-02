# Phase15 final evaluation, report and viva — completion record

**Status: COMPLETE**,2 November2026. Scope source: DEVELOPMENT_ROADMAP.md Phase15
and the user's Phase15 master instructions. No next phase was started.

## Deliverables and acceptance

| Roadmap deliverable | Status | Evidence | Limitation |
|---|---|---|---|
| Formal academic report | PASS | FINAL_REPORT.md covers problem, OS architecture, actual models/metrics, setup, results, tradeoffs, validation, conclusions and references | Repository-grounded; no invented author/institution or external bibliography |
| Throughput vs workload | PASS | data/plots/throughput_workload.png,3900x1440,300DPI; all128 runs, separated budgets, n8/cell, means/sample SD/dots | Workload categories, not an invented rate sweep |
| Latency percentile figure | PASS | latency_bounds.png,4200x2100,300DPI; all per-run p50/p95 upper bounds | Histogram bounds, not exact or pooled percentiles; p99 unavailable |
| Memory/resource efficiency figure | PASS | resource_allocation.png,3900x2400,300DPI | Logical final allocation and capacity-time utilization; no process RSS/heap data |
| Reproducible chart pipeline | PASS | scripts/plot_phase15.py,figure_data.csv,manifest.json,plot README | Raster bytes may vary with tool versions; same environment rerun was byte-identical |
| Presentation | PASS | VIVA_PRESENTATION.md:15 slides, each with content, visual recommendation and speaker notes | Markdown presentation content as requested; no binary deck claimed |
| Live demonstration/viva guide | PASS | VIVA_DEMO_GUIDE.md, scripts/demo_phase15.py; prerequisites, exact commands, expected states, shutdown, fallback and12 Q&A | Actual resize counts/timing vary; history ephemeral |
| Complete demonstration dry-run | PASS | build_phase15/viva-dry-run/integration/report.json: real backend2 and real browser2 passed | Bounded rehearsal, not a new controlled benchmark or hour run |

## Evidence sources and methodology

Primary comparison source: tracked data/experiments/phase9_controlled/runs.jsonl,
128 successful runs/64 pairs; four profiles, budgets16/24, seeds42/101, four repeats.
Effective configurations, fingerprints, initial allocations, metrics/controller settings,
counts and bytes are checked before pairing. All128 immutable attempt envelopes and
their record SHA256 checksums matched the derived raw records. Recomputing the complete
stored summary with the existing experiment code produced exact equality.

All128 observations are retained, with zero exclusions and no significance claim.
The earlier tracked Phase8 corpus was inspected:30 successful runs across five workload
types, one seed,three repeats/strategy; it is context, not mixed into Phase9 cells.
The local interface export contains one completed descriptive fixed/adaptive pair with
53/57 retained records and no truncation flags. It lacks controlled CLI provenance and
is not added to the comparative corpus. Phase14 raw hour and burst/audit files remain
local/ignored; the original hour SHA256 was rechecked unchanged without executing it.
See PHASE15_EVIDENCE.md for inventory, source schemas, intended uses and qualifications.

## Actual validation

| Command / method | Result |
|---|---|
| python scripts/plot_phase15.py |128 runs/64 pairs validated; three figures generated from actual data |
| python scripts/test_phase15.py |8 tests passed: aggregation plus invalid/incomplete/mismatched/nonfinite inputs and capacity accounting |
| Same plot command repeated | Identical PNG SHA256 values in the same installed environment |
| Independent source/CSV/table audit | All128 attempt checksums, complete stored summary,112 figure-data rows and report throughput/latency values verified |
| PNG decoder and direct visual inspection | All three images opened; actual sizes above; embedded resolution approximately300DPI; labels/legends inspected |
| Markdown relative-link audit | All deliverable figure/file links resolve |
| python scripts/demo_phase15.py --native build_phase14/adaptive_io_sim.exe --output build_phase15/viva-dry-run | PASS: backend2, browser2 (26.1s), zero active runs, backendGraceful=true,frontendStopped=true |
| Browser evidence preservation | All25 original files restored byte-for-byte; new evidence retained separately in dry-run output |
| Native-only guide commands, using retained Phase14 executable | Fixed/adaptive each consumed400 requests and38358 bytes; fixed0/adaptive3 applied resizes; both exit0 |
| Native and experiment --help inspection | Simulator flags verified; experiment flags verified with existing build_phase9/experiment_runner.exe |
| git diff --check and protected inventory | Passed; no production/native/historical changes |

The initial experiment --help inspection used a nonexistent Phase14 experiment binary;
it failed and was corrected to the retained Phase9 executable. No experiment matrix,
historical binary rebuild, dependency installation, Phase14 hour or sanitizer/full CI
matrix rerun was needed. The plotting stack already installed was matplotlib3.10.8
with Python3.14.3. Demo services used the existing Node24/native environment.

The dry-run's recorded comparison IDs were fixed3d012e28-0970-4d08-8767-642af3b04252
and adaptive08a234cb-13c0-4793-b3de-67c6ca324dd9. Browser normal-flow errors were zero.
It exercised real launches/results, resize events, matched values, history/URL restore,
CSV/JSON downloads, cancellation and responsive rendering. Those are new demonstration
observations, not statistical proof or persistent registry entries.

## Preservation and publication

Started on main at8753cfb with no tracked modifications and six existing untracked
audit/validation scratch files. SHA256 inventory covered all tracked files before work.
Only the intentional README/roadmap/.gitignore updates differ among those files; native,
backend/client, existing scripts/tests, Phase14 report and historical data remain unchanged.
New plotting/demo/test scripts, academic documents and sub-megabyte figures are intended
publication artifacts. No raw local stress data, builds, dependencies, logs or scratch
files are staged. data/plots is not ignored; required plots are intentionally deliverable.

The publication commit uses [skip ci] to avoid an unnecessary repeat of the Phase14 native
matrix for this academic-only change. Relevant new tests and actual demo ran locally;
the previously verified Phase14 scope is preserved. Commit/push and remote hash are
confirmed in the final task response rather than assumed here.

## Remaining measurement limits

Exact request percentiles, p99, process memory and exact global peak utilization are
unavailable. Figures use supported histogram bounds and explicitly labelled logical
allocation metrics. Sample SD is descriptive; no confidence/significance or universal
adaptive improvement is asserted. Phase13 concurrent pairs and Phase14 stress are kept
separate from Phase9 controlled comparisons. Hard-crash orphan containment, Windows
interruption-signal delivery, ephemeral history and bounded telemetry remain limitations,
as documented in Phase14; no claim was rewritten to say they were solved.

No required Phase15 deliverable remains blocked. The roadmap ends at Phase15; no Phase16
or unrelated work is proposed as an automatic next milestone.
