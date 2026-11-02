# Reproducible Phase15 figures

From repository root: `python scripts/plot_phase15.py`.
Uses existing matplotlib (verified3.10.8), the128 tracked Phase9 runs, and no simulator
execution. `python scripts/test_phase15.py` validates input/aggregation failures.

| Figure | Meaning | Resolution |
|---|---|---|
| [throughput_workload.png](throughput_workload.png) | Whole-run throughput by profile and budget; mean/sample SD/all observations |3900x1440,300DPI|
| [latency_bounds.png](latency_bounds.png) | Per-run histogram p50/p95 upper bounds and mean of bounds; independent logarithmic panels |4200x2100,300DPI|
| [resource_allocation.png](resource_allocation.png) | Final allocated logical-budget fraction and occupancy/capacity-time utilization |3900x2400,300DPI|

[manifest.json](manifest.json) binds source/script/figure hashes and records the command,
tool versions, run/pair counts and unavailable metrics. [figure_data.csv](figure_data.csv)
contains112 derived metric summaries, including means/sample SD/min/max/n. Raw inputs
remain in [the existing tracked corpus](../experiments/phase9_controlled/runs.jsonl).

No trimming or significance test is applied. Dots preserve all eight runs per cell.
Percentile bounds are not exact or pooled request percentiles; p99 is unavailable.
Logical slots/utilization are not process RAM. Phase13 UI and Phase14 stress results
are not mixed into these controlled comparisons. Outputs may be regenerated in place;
no historical raw measurements are rewritten. Required plots are intentionally tracked.
