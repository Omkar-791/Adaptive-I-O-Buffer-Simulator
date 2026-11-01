# Phase 9 controlled evaluation

Completed **128 actual runs, 64 matched pairs, zero failed runs**. Four profiles, budgets16/24, seeds42/101, four repetitions per strategy/seed/cell. Each strategy/configuration cell has eight observations. No measured results or Phase8 history were rewritten.

[Plan](../data/experiments/phase9_controlled/plan.json) · [Raw records](../data/experiments/phase9_controlled/runs.jsonl) · [Full statistics](../data/experiments/phase9_controlled/summary.json) · [CSV runs](../data/experiments/phase9_controlled/raw_runs.csv) · [CSV statistics](../data/experiments/phase9_controlled/aggregate_statistics.csv) · [Workflow definitions](EXPERIMENTS_PHASE9.md)

## Method and provenance

The full expanded plan was persisted before launch; initial execution used --plan-only followed by --resume. Simulations ran sequentially with alternating paired order. Both strategies used identical nominal request traces, equal initial allocations, limits1..64 and effective seeds. Active streams have80 requests; idle donors retain zero. Existing consumer/producer timing fields provide all rate control. Metrics sampling20ms/window100ms is identical across strategies; Phase6 controller defaults and Phase7 resizing logic were not changed. Build: GCC15.2.0, C++17, -O2, warnings enabled. Executable/config/workflow hashes and effective configurations are saved.

No warmup trimming, CPU pinning, timer-resolution adjustment or significance testing was applied. Seeds alter payloads and stochastic arrivals; sample SD mixes seed and scheduling variation. Nominal trace matching does not imply equal wall-clock arrivals because producer backpressure delays subsequent creations. These are descriptive measurements of the current closed-loop sleep-based model.

## Throughput and latency

Values are mean ± sample SD; n=8 per strategy/cell. Differences are100*(adaptive_mean-fixed_mean)/fixed_mean. Full absolute differences, medians/extrema and paired differences are retained in summary.json and paired_comparisons.csv.

| Case | Budget slots | Fixed req/s | Adaptive req/s | Throughput change | Fixed latency ms | Adaptive latency ms | Latency change |
|---|---:|---:|---:|---:|---:|---:|---:|
| reclamation | 16 | 63.675 ± 1.928 | 64.230 ± 1.072 | +0.871% | 0.038 ± 0.006 | 0.032 ± 0.003 | -15.218% |
| reclamation | 24 | 64.568 ± 0.647 | 64.095 ± 1.437 | -0.733% | 0.033 ± 0.004 | 0.033 ± 0.006 | -0.795% |
| backpressure | 16 | 63.682 ± 0.700 | 63.614 ± 0.684 | -0.108% | 148.127 ± 1.585 | 183.237 ± 14.656 | +23.703% |
| backpressure | 24 | 62.777 ± 2.134 | 63.133 ± 0.837 | +0.567% | 204.534 ± 6.745 | 240.937 ± 3.804 | +17.798% |
| balanced | 16 | 127.891 ± 0.859 | 126.955 ± 1.214 | -0.731% | 15.633 ± 0.104 | 15.748 ± 0.151 | +0.734% |
| balanced | 24 | 125.763 ± 3.063 | 126.901 ± 1.958 | +0.905% | 15.904 ± 0.398 | 15.759 ± 0.244 | -0.916% |
| heterogeneous | 16 | 187.789 ± 6.101 | 186.398 ± 4.886 | -0.741% | 58.853 ± 4.644 | 64.684 ± 7.363 | +9.907% |
| heterogeneous | 24 | 190.187 ± 2.804 | 188.315 ± 3.518 | -0.984% | 73.616 ± 6.513 | 76.016 ± 9.975 | +3.260% |

## Observed pressure and resizing

Producer waits are per-run totals summed over producers, in ms. Resize counts below are whole-plan successful/deferred transactions summed across eight adaptive runs; deferrals do not mean failed simulations.

| Case | Budget | Fixed producer wait mean ms | Adaptive producer wait mean ms | Adaptive success/deferred | Adaptive runs with actual changes |
|---|---:|---:|---:|---:|---:|
| reclamation | 16 | 0.000 | 0.000 | 16 / 0 | 8 / 8 |
| reclamation | 24 | 0.000 | 0.000 | 15 / 1 | 8 / 8 |
| backpressure | 16 | 1113.681 | 1060.533 | 8 / 8 | 7 / 8 |
| backpressure | 24 | 1063.129 | 999.625 | 8 / 8 | 8 / 8 |
| balanced | 16 | 0.000 | 0.000 | 0 / 0 | 0 / 8 |
| balanced | 24 | 0.000 | 0.000 | 0 / 0 | 0 / 8 |
| heterogeneous | 16 | 721.274 | 673.674 | 15 / 1 | 8 / 8 |
| heterogeneous | 24 | 637.817 | 617.750 | 19 / 2 | 8 / 8 |

Across the matrix:81 successful resize transactions,20 deferred,0 rejected. All fixed runs stayed fixed with zero resize calls. Every backpressure and heterogeneous run measured positive producer waiting; reclamation and balanced runs had zero producer full-queue waits. Final physical capacities agreed with accounting and all budgets/counts held.

## Interpretation

Backpressure was genuinely exercised: fixed producer waits averaged1113.681ms at budget16 and1063.129ms at budget24. Adaptive waits averaged1060.533ms and999.625ms respectively. However, adaptive mean completion latency increased35.110ms (+23.703%) and36.403ms (+17.798%). Throughput changed only-0.108%/+0.567%. This is a measured trade-off, not an adaptive victory. Larger queues permit earlier request creation/queuing in this closed-loop model while the configured consumer service rate remains unchanged.

Heterogeneous adaptive mean latency increased9.907% at budget16 and3.260% at budget24 while throughput means decreased0.741%/0.984%. Reported producer waiting was lower, but that does not establish better end-to-end performance.

Reclamation at budget16 reduced both capacities from8 to1 in all eight adaptive runs. At budget24, allocations were reduced from12 each to4 each (one observed outcome remained at8 each); no producer full-queue waiting was introduced in these measured reclaim runs. This demonstrates real reclaimed capacity, not a measured throughput improvement. Reclamation latency is only tens of microseconds, so percentage changes must be read alongside small absolute values.

Balanced runs performed no resizes under either strategy. Their positive/negative throughput/latency differences cannot be attributed to physical resizing. Scheduling variation and the presence of adaptive evaluation still affect measurements; no significance or universal-superiority claim is made. No slow/negative run was trimmed.

Whole-run p50/p95 remain histogram upper bounds, exact global peak is unavailable, and consumer idle time includes lifecycle waiting. The full exports retain these fields with units and missing-value definitions.

## Recovery and independent checks

After completion, a deliberately torn derived runs.jsonl cache was recovered with --resume. All128 completed identities were skipped, zero simulations reran,128 immutable attempt files remained, and the regenerated raw-byte SHA256 exactly matched the original. Native lock/provenance/malformed and failed-attempt recovery paths are additionally covered by automated fixtures.

The main orchestrator recomputed all240 group/paired descriptive-statistic dictionaries using a separate verification calculation and checked all64 paired configurations/fingerprints, fixed invariants, physical/accounting/count/budget consistency, CSV row counts and unchanged historical hashes. A specialized subagent independently reviewed the final workflow implementation and found no remaining blocker; its later requested statistics pass was unavailable, so these numeric checks are attributed to the orchestrator.

## Reproduction and limits

Use the exact command in EXPERIMENTS_PHASE9.md, with a new output directory for a new matrix. Resume requires the same ordered plan, executable/source/workflow hashes and readable bootstrap artifacts. Rebuilding or moving files may intentionally prevent resume. Runtime metrics/resize outcomes need not reproduce bit-for-bit.

CMake/CTest were unavailable; the strongest available verification was a fresh GCC build and all suites. A ThreadSanitizer probe failed to link because libtsan is absent. Ordinary concurrency tests do not prove race freedom. No isolated CPU-overhead benchmark, controlled hardware-I/O study or broader-seed significance analysis was performed.
