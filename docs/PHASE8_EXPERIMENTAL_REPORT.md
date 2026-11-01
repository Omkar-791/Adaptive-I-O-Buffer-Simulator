# Phase 8 initial measured evaluation

This is an initial descriptive comparison from **30 actual successful runs**: five existing workload configurations, fixed_equal/adaptive, three repetitions each, experiment seed42. All15 pairs had identical effective configurations and producer-verified input fingerprints. No failed runs were omitted. The manifest, raw measurements and complete descriptive statistics are saved alongside the project.

[Manifest](../data/experiments/phase8_initial_seed42/manifest.json) · [30 raw records](../data/experiments/phase8_initial_seed42/runs.jsonl) · [Full statistics](../data/experiments/phase8_initial_seed42/summary.json) · [Executed build settings](../data/experiments/phase8_initial_seed42/build_metadata.json)

## Method

Fresh sequential processes, counterbalanced paired order, no concurrent benchmark jobs. C++17 GCC15.2.0 -O2; compiler/build marker and executable SHA256 are recorded. All source configs retain their original request counts, timing patterns, payload bounds and budgets; seed42 overrides source seeds consistently to42,142,242 by sorted stream index. Both strategies start at the same constrained equal allocations. Metrics use100ms sampling/1000ms sliding window; controller parameters are unchanged Phase6 defaults (three confirming nonoverlapping windows,100ms minimum update,500ms cooldown,4-slot steps). Limits1..64. Whole-run histograms/waits are used for results. No warmup runs, CPU pinning, thermal controls or statistical significance tests were applied.

Actual arrival times differ with scheduling/backpressure despite identical nominal request sequences. Three same-seed repetitions measure initial scheduling variability, not generality across random seeds. [Metric and methodology definitions](EXPERIMENTS_PHASE8.md) apply.

## Cases

| Workload | Streams | Budget | Total requests/run | Equal initial capacities |
|---|---:|---:|---:|---|
| steady | 2 | 16 | 400 | 8, 8 |
| burst | 2 | 32 | 400 | 16, 16 |
| periodic | 2 | 20 | 400 | 10, 10 |
| stochastic | 2 | 24 | 400 | 12, 12 |
| heterogeneous | 3 | 32 | 600 | 11, 11, 10 |

## Throughput

Mean ± sample SD, n=3 per strategy, units requests/s. Absolute and relative differences are adaptive_mean-fixed_mean and100*(adaptive_mean-fixed_mean)/fixed_mean.

| Workload | Fixed mean ± SD | Adaptive mean ± SD | Absolute change | Relative change |
|---|---:|---:|---:|---:|
| steady | 124.379 ± 4.825 | 127.538 ± 0.721 | +3.159 | +2.540% |
| burst | 121.876 ± 1.880 | 121.225 ± 1.484 | -0.651 | -0.534% |
| periodic | 96.791 ± 0.364 | 96.598 ± 1.064 | -0.193 | -0.199% |
| stochastic | 103.750 ± 1.258 | 103.449 ± 1.295 | -0.301 | -0.290% |
| heterogeneous | 127.881 ± 0.774 | 127.307 ± 0.629 | -0.573 | -0.448% |

## Mean completion latency

Mean ± sample SD, n=3 per strategy, units ms. Absolute and relative differences are adaptive_mean-fixed_mean and100*(adaptive_mean-fixed_mean)/fixed_mean.

| Workload | Fixed mean ± SD | Adaptive mean ± SD | Absolute change | Relative change |
|---|---:|---:|---:|---:|
| steady | 16.074 ± 0.616 | 15.678 ± 0.091 | -0.396 | -2.462% |
| burst | 15.699 ± 0.014 | 15.873 ± 0.184 | +0.173 | +1.105% |
| periodic | 15.804 ± 0.206 | 15.700 ± 0.107 | -0.104 | -0.660% |
| stochastic | 19.554 ± 0.639 | 19.089 ± 0.351 | -0.465 | -2.377% |
| heterogeneous | 16.551 ± 0.304 | 16.513 ± 0.118 | -0.038 | -0.228% |

## Other measured outcomes

F/A values are fixed/adaptive means across runs. p50/p95 columns average per-run quantized whole-run histogram upper bounds, in ms; they are not exact percentiles of a pooled request population. Peak usage means the largest individual stream peak fraction; exact global peak is unavailable (null in raw records).

| Workload | p50 F/A | p95 F/A | Producer wait F/A ms | Consumer wait F/A ms | Average utilization F/A % | Adaptive successful transactions (total/3 runs) |
|---|---:|---:|---:|---:|---:|---:|
| steady | 16.383 / 16.383 | 21.844 / 16.383 | 0.000 / 0.000 | 10.736 / 10.290 | 0.017 / 0.021 | 0 |
| burst | 16.383 / 16.383 | 16.383 / 21.844 | 0.000 / 0.000 | 291.822 / 264.609 | 0.013 / 0.015 | 0 |
| periodic | 16.383 / 16.383 | 16.383 / 16.383 | 0.000 / 0.000 | 1955.031 / 2014.335 | 0.016 / 0.020 | 3 |
| stochastic | 16.383 / 16.383 | 43.690 / 32.767 | 0.000 / 0.000 | 1365.447 / 1367.010 | 1.611 / 1.424 | 2 |
| heterogeneous | 16.383 / 16.383 | 27.306 / 32.767 | 0.000 / 0.000 | 4581.128 / 4658.270 | 0.312 / 0.340 | 6 |

All fixed runs reported zero resize transactions and unchanged capacities. The matrix observed11 successful adaptive transactions,1 deferred transaction and0 rejected transactions. Deferred attempts remain explicit in raw records and statistical summaries; a completed simulation need not apply every recommendation. Every run consumed its declared number of requests, physical final capacities matched resource records, and all budgets held. Full median/minimum/maximum/sample-SD statistics for all measured fields and paired differences are in summary.json.

## Interpretation

Adaptive did not show consistent throughput improvement: throughput means were lower for burst, periodic, stochastic and heterogeneous. Burst mean latency was also higher. These small changes must be considered alongside run variability, not represented as proof of improvement or degradation.

Steady mean throughput was higher under the adaptive label, but **neither steady strategy performed any resizing**. Fixed steady throughput ranged from118.809 to127.207requests/s (SD4.825), versus126.746 to128.157 (SD0.721) for adaptive. The difference cannot be attributed to resizing. The raw data are retained without trimming the slow fixed run.

The adaptive policy performed real changes for periodic, stochastic and heterogeneous cases. These counts demonstrate exercised behavior, not a performance benefit. The service model is a fixed sleep per request; payload size does not alter device service time. Windows and timer resolution can limit responsiveness or make buffering changes ineffective. All30 runs measured zero producer full-queue wait. Thus this seed/configuration matrix exercised allocation reclamation, not sustained backpressure relief; growth under pressure is validated separately by tests. The initial corpus does not establish that adaptive is universally superior.

## Reproduce

Build with consistent -O2 C++17 flags, then run (choose a new output directory):

```powershell
python scripts/run_experiments.py --exe build_phase8/experiment_runner.exe --configs configs/workload_steady.json configs/workload_burst.json configs/workload_periodic.json configs/workload_stochastic.json configs/workload_heterogeneous.json --seeds 42 --repetitions 3 --output data/experiments/phase8_repeat_seed42
```

Expected reproducibility means matching nominal input fingerprints/configuration and valid completed runs; runtime metrics and resize counts may differ. The manifest records executable SHA256/environment, each raw run records compiler/build markers, and build_metadata.json records the actual compiler flags and source hashes. No p-values or significance claims are made. Additional seeds, more repetitions and controlled hardware conditions are needed before broader conclusions.
