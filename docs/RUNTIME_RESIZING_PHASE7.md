# Phase 7 runtime buffer resizing

## Implemented loop

MetricsEngine -> AdaptiveController -> AllocationDecision -> RuntimeResizeExecutor -> working BoundedBuffer capacities and BufferResourceManager accounting. Adaptive operation is opt-in through `Simulation::enableAdaptive` or `--adaptive`; existing CLI behavior remains fixed-capacity by default. Resizing executes on the existing serialized sampling callback path, without an additional worker/coordinator thread or metrics system.

Desired allocation is a recommendation. Physical queue capacity is the active ring limit. Resource records are the manager's accounted capacities. A deferred/failed transaction changes neither physical capacities nor records. `ResizeResult` reports success/deferred/stale, snapshot sequence, reason and previous/requested/actual capacities when available. Early malformed-input, allocation or manager-contention errors may have an empty streams vector because no authoritative capacity observation was acquired.

## Executor API and ownership

Construct `RuntimeResizeExecutor(manager, bindings)` where each `BufferBinding` supplies exact stream ID, queue pointer, minimum and maximum capacity. The manager, queues and fixed topology must outlive the executor. Bindings require one queue per stream, unique IDs and queue pointers, positive valid bounds, physical/record agreement and a valid budget total. Only one executor may own a manager/queue at a time. Bind before starting workers; concurrent binding may throw a busy error. Do not destroy an executor concurrently with apply, metrics callbacks or raw queue destruction.

The executor owns no queues and introduces no public uncoordinated queue-resize API. While bound, register/unregister/requestResize/reallocate reject changes and reset throws logic_error. Read-only resource inspection remains available. These guards preserve accounting/physical agreement; once detached, legacy accounting-only hooks retain their previous meaning and should not be used to resize live queues.

`apply(decision)` requires a valid, evaluated, complete decision and positive sequence. It validates ID membership, desired min/max and subtraction-safe budget totals. It stages replacements for changed rings before acquiring transaction locks. Allocation failure returns an explicit failure without mutation. Request copies are statically required to be nonthrowing.

## Lock order and transaction

The sole lock order is resource-manager mutex -> all queue mutexes in increasing stream-ID order. Apply uses try_lock for each: unavailable resource/queue locks return deferred with no waiting/retry loop. Workers and queue inspection only take their own queue mutex; they never acquire the resource mutex. No callbacks run inside internal locks. Construction/destruction also take resource before queues; binding/destruction belong to the coordinating lifecycle.

After all locks are held, apply rechecks expected capacities against physical and recorded values, sequence freshness, queue closure and live occupancy. The snapshot occupancy is not trusted for shrink safety. If any queue holds more items than its target, the whole decision defers. Closed queues cannot be resized and continue to drain under existing shutdown semantics.

For each changed ring, copy logical queue entries `(head+j)%old_capacity` into replacement storage in FIFO order while all original rings remain untouched. After all validation/copies complete, commit only no-throw swaps, scalar/index updates and existing map-entry updates. Shrinks commit before growth, so even the inaccessible intermediate active-capacity total stays within budget. Rebase head=0 and tail=count%new_capacity. Update occupancy/capacity integrals before changing limits. Complete resource total and success sequence under the same locks. Release locks, then notify all full-queue producer waiters for growth. Item counts, IDs, timestamps and order are retained.

This is all-or-nothing across the full stream plan. Any precommit rejection or staging failure leaves all rings/records unchanged. No rollback is needed after the nonthrowing commit begins. Staging temporarily retains both old and replacement rings: the budget limits logical active slots, not peak heap bytes. There is no hard-real-time latency guarantee for allocation, copying or mutex internals.

## Staleness, deferral and retries

A successful submission advances the bound manager's sequence watermark (including a successful no-op); equal/older submissions are stale. Expected current capacity must match both accounting and physical state. A newer transaction therefore invalidates older decisions even if capacities later return to the same values. Deferred/failed attempts do not advance the watermark and can be explicitly resubmitted after revalidation. The executor has no automatic retry queue or unbounded decision storage. Simulation evaluates fresh snapshots at the configured sampling rate; cooldown remains recommendation-based, so a deferred attempt may wait for subsequent confirmation.

A new executor is a new sequence epoch. Discard all old run/executor decisions and reset controllers when starting a new epoch. Capacity comparison and commit watermark are not a proof that an unchanged-capacity decision reflects the latest workload; occupancy is always checked live and callers should supply fresh observations.

## Metrics and summaries

Mutable capacity reads are synchronized. BufferObservation adds a cumulative capacity-time integral alongside occupancy time. Window utilization is `100 * delta(occupancy_ns) / delta(capacity_ns)`, correctly handling windows spanning a resize. Global capacity integrals sum stream integrals. Average occupancy remains occupancy-time divided by observed elapsed time. Stream completion summaries report actual final buffer capacity, time-weighted average utilization and peak occupancy fraction measured at push/resize events. Global average utilization uses summed average capacity; the legacy global max_occupancy_slots remains the largest individual stream peak, not a simultaneous system-wide peak.

Metrics snapshots are still sequential across streams, not atomic across all queues. ResizeResult acknowledges immediate actual capacities; the next metrics sample reflects them. Legacy worker counters remain post-join APIs. Simulation reuses acknowledged resource allocations if run again; controller/executor state is recreated for that run.

## Usage

```powershell
./build_phase7/adaptive_io_sim.exe --adaptive --streams 2 --capacity 2 --budget 32 --requests 100 --producer-ms 0 --consumer-ms 5 --telemetry --metrics-interval-ms 10 --metrics-window-ms 50
./build_phase7/adaptive_io_sim.exe --config configs/workload_heterogeneous.json --adaptive --telemetry --metrics-interval-ms 10 --metrics-window-ms 50
```

`--telemetry` additionally emits buffer_resize NDJSON records in adaptive mode, followed by the existing completion object. `--json` alone remains one completion object, including with --adaptive. Failed resize attempts without telemetry are explained on stderr. No resize event is represented as success merely because a recommendation exists.

Embedding: call `simulation.enableAdaptive(controllerConfig, limits)`, optionally `setResizeCallback`, and inspect `latestResizeResult()`. Empty limits default to each manager minimum and maximum=max(64,initial allocation). Sampling remains configured by existing setters/flags. Custom limits must match every stream. Default controller confirmation/update/cooldown settings are unchanged from Phase 6. For direct control, construct an executor using StreamManager queue bindings and apply controller decisions from the same serialized metrics callback.

## Limitations and next milestone

Try-lock deferral has no fairness or success deadline under sustained contention. Copying costs O(total queued items in changed queues); storage is proportional to requested ring capacities plus existing storage. Runtime lifecycle destruction must be externally serialized. A complete memory exhaustion can still prevent constructing result/error strings; no state has changed before commit. No measured throughput or CPU-overhead improvement is claimed. Race-detector availability and test results are recorded in PHASE7_COMPLETION_REPORT.md. The next milestone is fixed-versus-adaptive baseline strategies and reproducible comparative experiments.
