Phase 7 update: capacity can change through the runtime executor. Window utilization now divides occupancy-time delta by capacity-time delta, and completion summaries report actual final capacity. See [runtime metrics definitions](RUNTIME_RESIZING_PHASE7.md). Earlier fixed-capacity text below describes Phase 5.

# Phase 5 metrics engine

`MetricsEngine` observes `StreamManager` through synchronized buffer observations. It never reads the producer or consumer's unsynchronized legacy summary counters while workers run. Existing completion summaries and their JSON fields remain available.

## Sampling and controller interface

`MetricsConfig` defaults to a 100 ms sampling interval and a 1000 ms sliding window. Both values must be positive, the window must be at least the interval, and the window/interval ratio is limited to prevent excessive retained history. `MetricsEngine::start()` takes an initial baseline; its monitor thread sleeps on a condition variable between collections. `stop()` wakes and joins the thread and takes the final observation, including simulations shorter than one interval.

`latest()` returns a synchronized copy of the latest `MetricsSnapshot`. The snapshot contains a monotonic sequence, elapsed milliseconds, observed window length, final-sample flag, per-stream observations, and a global aggregate. This is the Phase 6 controller interface; capacity changes and controller policy are outside Phase 5.

`Simulation::setMetricsConfig()`, `setMetricsCallback()`, and `latestMetrics()` expose the same functionality to embedding applications. Configure before `run()`. Callbacks are serialized on the sampling/start/stop paths: keep them short and do not throw or call lifecycle methods from a callback. Slow callbacks delay sampling; timing calculations use elapsed clock time, never the requested sleep interval.

## Definitions

All timing uses `std::chrono::steady_clock`. Each buffer observation is internally consistent under its queue mutex; streams are collected sequentially, so the aggregate is not an atomic transaction across all queues.

| Observation | Definition |
|---|---|
| Produced | Cumulative successful queue insertions |
| Consumed / completed | Cumulative requests whose device service has completed |
| Bytes | Sum of payload sizes of completed requests |
| Occupancy / capacity | Queued requests and fixed queue limit, in slots; excludes the request in service |
| Average occupancy | Change in cumulative occupancy-time integral divided by observed window duration |
| Utilization | Average occupied slots as a percentage of allocated slots |
| Throughput | Completed-count difference divided by observed window seconds |
| Byte throughput | Completed-byte difference divided by observed seconds and 1024 squared (MiB/s, preserving the existing MB/s convention) |
| Average latency | Difference in cumulative completion latency divided by completed-count difference; zero when no request completed in the window |
| Producer wait | Time blocked waiting for a full queue to gain space, including an ongoing wait |
| Consumer wait | Time blocked waiting for an empty queue to receive work, including an ongoing wait |
| Full / empty events | Entries into a blocked full/empty wait episode, rather than polling observations or spurious wakeups |

Latency runs from request creation through completion and therefore includes producer backpressure, queue residence, and service. The global latency mean is completion weighted, not an unweighted mean of stream means. Global counts, bytes, occupancy, capacity, and wait durations sum stream values. Waits summed across threads may exceed wall-clock elapsed time.

Window calculations use differences between cumulative observations retained in a bounded deque. The observed baseline follows sample boundaries; this is a sampled window, not a promise of exact interpolation at an arbitrary millisecond cutoff. Initial windows contain only elapsed history. Old completed work expires from window rates while cumulative totals remain available. No completions yields zero throughput and zero window latency. A request already in service can make `produced - consumed` differ from queue occupancy.

The legacy request latency vector retains at most 4096 entries in ring order. Window p50/p95 use differences of a fixed 64-bucket cumulative histogram. Bucket k covers [2^k-1, 2^(k+1)-1) microseconds (last bucket saturates). `p50_latency_upper_ms` and `p95_latency_upper_ms` report the selected bucket upper boundary, not exact percentiles. This intentionally exposes quantization. Empty windows return zero. Histogram storage is constant per stream.

Create all streams before starting the monitor and keep topology unchanged until stop. Lifecycle methods belong to one coordinating thread; `latest()` supports concurrent readers. Engines are single-use (restart is rejected). Callback exceptions are captured, the sampler exits, final collection still runs, and explicit `stop()` rethrows on the coordinator. Destructors perform non-throwing cleanup. The window is at most one day and at most 100000 sampling intervals. Legacy Producer/Consumer getters remain post-join APIs.

CLI: `--metrics-interval-ms 100 --metrics-window-ms 1000` configures sampling for uniform or heterogeneous JSON configurations. `--telemetry` emits initial, periodic, and final snapshots followed by the compatible completion JSON object. Without this flag, existing text and `--json` output formats are preserved. Metrics settings currently use CLI or C++ setters, not JSON configuration keys. No overhead percentage or race-detector certification is claimed.

## Validation

`test_metrics_engine` covers invalid intervals/windows, immediate shutdown, empty workloads, periodic callbacks, monotonic timestamps and sequences, per-stream/global count and byte agreement, full-buffer waiting, concurrent snapshot readers, final collection, and expiration of old work from sliding-window rates. Timing-sensitive tests use a bounded wait for an observable result rather than asserting a precise scheduler wakeup time. Existing suites continue to cover deterministic workload generation and queue synchronization.
