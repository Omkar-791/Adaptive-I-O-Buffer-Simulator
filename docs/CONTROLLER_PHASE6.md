Phase 7 integration is now implemented separately in RuntimeResizeExecutor and opt-in adaptive Simulation. This controller still only recommends; [runtime documentation](RUNTIME_RESIZING_PHASE7.md) describes physical application and supersedes earlier future-resizing notes.

# Phase 6: Adaptive allocation recommendations

## Scope and architecture

`AdaptiveController` is a deterministic stateful C++17 policy, independent of threads, CLI and instrumentation. It consumes the existing `MetricsSnapshot`, current `StreamAllocation` vector, global budget and exact per-stream `StreamLimits`. It returns `AllocationDecision` containing validity, evaluation status, originating snapshot sequence, sorted complete recommendations and reasons. `changed()` means a desired capacity differs from the supplied current capacity; it does not mean anything was applied.

The overload accepting a const `BufferResourceManager&` reads its locked allocation snapshot and immutable budget. Controller minima cannot relax the manager's minimum. Neither overload mutates resource accounting. No BoundedBuffer source or physical capacity is changed in Phase 6.

Three distinct concepts remain explicit:

1. Recommendation: desired integer capacities returned by evaluate.
2. Bookkeeping: resource-manager recorded allocations; legacy resize hooks change only these records.
3. Working capacity: physical queue limits reported by metrics. Runtime application and synchronization are the next milestone.

## Policy and definitions

For stream i, U_i is measured window utilization in percent, P_i = producer_wait_ms/window_ms, Q_i = consumer_wait_ms/window_ms, and R_i is completed requests per second. Producer wait is full-queue backpressure; consumer wait is empty-queue starvation. Cumulative full/empty event counters are not treated as window pressure or arrival rates.

A high-pressure observation satisfies U_i >= high_utilization_pct and P_i >= producer_pressure_ratio. A low-demand observation satisfies U_i <= low_utilization_pct and P_i <= producer_idle_ratio and (Q_i >= consumer_idle_ratio or R_i == 0). This uses throughput only to corroborate no completed service, not as a prediction of performance benefit. Consumer blocking alone never causes growth. Current queue occupancy limits how much a donor may release.

After the configured number of accepted confirming windows, donors can recommend releasing min(step_slots, current - max(minimum, observed occupancy)) slots. Eligible receivers can request up to min(step_slots, maximum - current). Original slack plus reclaimed slots are distributed in capped equal rounds; integer remainder priority rotates among sorted eligible receivers. The implementation uses bounded binary-search water filling rather than looping once per budget slot. Equal eligible streams receive equal grants up to a one-slot remainder; with stable eligibility and scarce slack, priority rotates deterministically.

Total desired slots never exceed the supplied budget; each desired capacity stays within its min/max. Unused budget is allowed. No forced stealing from busy streams occurs when donors cannot release slots. There is no claim that adding slots fixes an overloaded service device or increases throughput.

## Configuration

| Field | Default | Meaning |
|---|---:|---|
| high_utilization_pct | 80 | Growth threshold |
| low_utilization_pct | 30 | Reclaim threshold |
| producer_pressure_ratio | 0.05 | Minimum producer blocking fraction for growth |
| producer_idle_ratio | 0.01 | Maximum producer blocking fraction for reclaim |
| consumer_idle_ratio | 0.05 | Empty-queue waiting evidence for reclaim |
| confirmation_windows | 3 | Accepted windows confirming a condition |
| step_slots | 4 | Maximum absolute recommendation change per stream/evaluation |
| update_interval_ms | 100 | Minimum spacing between accepted evaluations |
| cooldown_ms | 500 | Recommendation cooldown per changed stream |
| StreamLimits minimum / maximum | 1 / 64 | Explicit per-stream hard limits |

Config construction rejects invalid/nonfinite thresholds, zero step/confirmation/update interval, or negative cooldown. evaluate returns valid=false with an explanation for invalid IDs, bounds, times, nonfinite/negative metrics, current allocations outside bounds, budget overflow or insufficient minimum budget. Invalid input does not advance controller state. Empty matching stream sets are valid, including budget zero.

## Stability and lifecycle

Only increasing sequence/time observations are accepted. Zero-window baseline and final snapshots hold. To avoid counting overlapping sliding windows as independent evidence, accepted observations are spaced by at least max(update_interval_ms, current observed window_ms). Gated/replayed observations do not change confirmation or cooldown. A neutral or opposite accepted signal resets the corresponding confirmation streak. Changed recommendations reset both streaks and start cooldown, whether or not a caller accepts them. An external current-capacity change resets accumulated evidence but retains any existing cooldown.

When bookkeeping differs from observed physical capacity, evaluate returns a valid hold without evaluating the policy; it never assumes an unapplied recommendation became real. Topology is fixed after first evaluation; call reset() for a new run or stream set. reset() clears history, cooldown and round-robin state. Storage is O(number of streams); there is no decision log retained internally. Evaluation costs O(N log N + N log S), where S is the largest requested integer grant (at most size_t range).

Use one coordinating caller per controller. evaluate/reset are not internally synchronized. Phase 5 callbacks are serialized and can feed the controller without a second monitor. Streams are measured sequentially; recommendations are not an atomic physical resize plan. Wait ratios/utilization are not hard-clamped to one/100 because measured windows may have sampling skew. Inputs must be finite/nonnegative; instantaneous occupancy cannot exceed physical capacity.

## Embedding example

```cpp
Simulation simulation(config);
AdaptiveController controller;
std::vector<StreamLimits> limits{{0, 1, 32}, {1, 1, 32}};
simulation.setMetricsCallback([&](const MetricsSnapshot& snapshot) {
    const AllocationDecision decision = controller.evaluate(
        snapshot, simulation.getResourceManager(), limits);
    // Inspect decision.valid, evaluated, changed(), streams and reasons.
    // No apply call: queues and resource records remain unchanged.
});
auto summary = simulation.run();
```

Include AdaptiveController.h and Simulation.h. Match limits to actual stream IDs. This is a library interface; no new CLI switch or JSON configuration/output change is introduced.

## Runtime-resizing handoff and limits

A future executor must verify the recommendation still matches current state, perform coordinated occupancy-safe queue resizing and resource accounting, and acknowledge resulting physical capacities. Snapshot occupancy is only a recommendation floor, not a concurrent shrink guarantee. Do not implement a multi-stream resize by blindly applying individual accounting-only requestResize calls. Pressure hysteresis, confirmations and cooldowns prevent adjacent-window reversal; they do not establish universal control-system stability. Fairness applies among eligible receivers; minimum capacities protect other streams.

Default 1000ms metric windows mean accepted policy observations are normally at least 1000ms apart. Three confirmations therefore take multiple seconds. Tune the metrics window deliberately for experiments; the controller does not claim 100ms responsiveness with 1000ms windows. No throughput, CPU overhead or runtime resizing improvement is claimed.
