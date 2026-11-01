Phase 7 integration is now implemented separately in RuntimeResizeExecutor and opt-in adaptive Simulation. This controller still only recommends; [runtime documentation](RUNTIME_RESIZING_PHASE7.md) describes physical application and supersedes earlier future-resizing notes.

# Phase 6 implemented scope

The implemented controller generates recommendations only. It neither applies resource-manager bookkeeping nor resizes queues. The runtime resizing protocol and arrival-rate signals discussed below remain future design work. See [Phase 6 implementation definitions](CONTROLLER_PHASE6.md) for current interfaces, validation, defaults and limits.

---

# Adaptive Controller Design

This document details the theoretical foundation, multi-signal feedback algorithm, stability mechanisms, and explainability architecture for the **Adaptive Buffer Allocation Controller**.

---

## 1. Controller Objectives
The controller solves the dynamic resource allocation problem under a global constraint:
1. **Mitigate Backpressure**: Dynamically expand buffer capacity for streams experiencing high arrival bursts and producer blocking.
2. **Reclaim Idle Capital**: Contract buffer capacity for streams that are under-utilized or idle to return slots to the global pool.
3. **Prevent Thrashing / Oscillation**: Ensure stability by avoiding frequent, alternating expansion and contraction cycles ($C \to C+\Delta \to C$).
4. **Ensure Explainability**: Every allocation or reallocation decision must have an unambiguous, auditable causal explanation.

---

## 2. Controller Inputs (Telemetry Signals)
At each evaluation epoch $t$, the controller reads the following aggregated signals from the `MetricsEngine` for each stream $i$:

| Signal | Description | Source |
|---|---|---|
| $O_i(t)$ | Current buffer occupancy (slots) | Buffer State |
| $\bar{U}_{i}(W)$ | Average buffer utilization over window $W$ ($\%$) | Telemetry Window |
| $T_{\text{pwait}, i}(W)$ | Total time producer was blocked waiting during window $W$ (ms) | Telemetry Window |
| $\lambda_i(W)$ | Request arrival rate during window $W$ (req/s) | Workload Telemetry |
| $\mu_i(W)$ | Request service/drain rate during window $W$ (req/s) | Consumer Telemetry |
| $C_i(t)$ | Current capacity limit of stream $i$ (slots) | Buffer Manager |
| $B_{\text{free}}(t)$ | Available unallocated slots in global budget | Buffer Manager |

---

## 3. Tunable Parameters & Initial Defaults

All numerical values are **tunable hyperparameters** subject to experimental evaluation rather than hard-coded constants:

| Parameter | Notation | Proposed Initial Default | Description |
|---|---|---|---|
| **Observation Interval** | $\Delta t_{\text{obs}}$ | $100\text{ ms}$ | Frequency at which the controller wakes up and samples metrics |
| **Observation Window** | $K_{\text{obs}}$ | $3\text{ windows}$ | Number of consecutive windows a condition must persist before action |
| **Increase Utilization Threshold** | $\theta_{\text{inc}}$ | $80\%$ | Utilization above which expansion is considered |
| **Decrease Utilization Threshold** | $\theta_{\text{dec}}$ | $30\%$ | Utilization below which contraction is considered |
| **Producer Wait Threshold** | $\tau_{\text{wait}}$ | $15\text{ ms}$ | Minimum producer blocking time in a window to trigger expansion |
| **Cooldown Duration** | $T_{\text{cooldown}}$ | $500\text{ ms}$ ($5 \times \Delta t_{\text{obs}}$) | Minimum time a stream must wait after a resize before resizing again |
| **Capacity Step Size** | $\Delta C_{\text{step}}$ | $4\text{ slots}$ | Number of slots added or removed in a single reallocation action |
| **Minimum Stream Capacity** | $C_{\min}$ | $4\text{ slots}$ | Hard floor to guarantee base throughput and prevent starvation |
| **Maximum Stream Capacity** | $C_{\max}$ | $24\text{ slots}$ | Hard ceiling to prevent a single stream from monopolizing the budget |
| **Global Budget** | $B_{\text{total}}$ | $48\text{ slots}$ | Fixed total memory budget across all streams |

---

## 4. Stability Mechanisms

Dynamic feedback controllers in operating systems are vulnerable to **hunting** and **thrashing** if they react too aggressively to transient fluctuations. Three key stability mechanisms are employed:

```
        Under-utilized                Hysteresis Deadband                 Congested
    [0% ──────────── 30%]              [30% ──────── 80%]            [80% ────────── 100%]
         Contraction                      NO ACTION                        Expansion
          Candidate                      (Deadband)                        Candidate
```

### 1. Hysteresis (Deadband)
- A wide gap between the expansion threshold ($\theta_{\text{inc}} = 80\%$) and contraction threshold ($\theta_{\text{dec}} = 30\%$) prevents boundary oscillations.
- Streams operating within the deadband ($30\% \le \bar{U}_i \le 80\%$) trigger **no reallocation action**.

### 2. Multi-Window Confirmation
- An alert state must be sustained across $K_{\text{obs}}$ consecutive observation windows.
- A transient burst lasting only $50\text{ ms}$ will not trigger an expansion; a sustained burst over $3 \times 100\text{ ms} = 300\text{ ms}$ will.

### 3. Cooldown Timers
- Following any capacity change for stream $i$, an operational cooldown timer ($T_{\text{cooldown}}$) is activated.
- During cooldown, further resize decisions for that stream are inhibited, allowing the system to stabilize and reflect the new capacity in queue dynamics.

---

## 5. Allocation & Reallocation Decision Logic

At every observation interval $\Delta t_{\text{obs}}$, the controller runs the following structured evaluation:

```
For each stream i in [1..N]:
  1. Check Cooldown:
     If (currentTime - lastResizeTime[i] < T_cooldown) -> SKIP (Cooldown active)

  2. Evaluate Expansion Condition:
     If (U_avg[i] >= theta_inc AND T_pwait[i] > tau_wait) for K_obs consecutive windows:
       If C_i < C_max:
         Candidate for EXPANSION by Delta_C

  3. Evaluate Contraction Condition:
     If (U_avg[i] <= theta_dec AND T_pwait[i] == 0) for K_obs consecutive windows:
       If C_i > C_min:
         Candidate for CONTRACTION by Delta_C
```

### Budget Resolution Strategy
When one or more streams qualify for expansion:
1. **Direct Allocation from Free Pool**:
   - If $B_{\text{free}} \ge \Delta C_{\text{step}}$, allocate directly from the free budget without disturbing other streams.
2. **Inter-Stream Reallocation**:
   - If $B_{\text{free}} < \Delta C_{\text{step}}$, search for a donor stream $j$ meeting the Contraction Condition.
   - If a donor exists, contract stream $j$ by $\Delta C_{\text{step}}$ and grant the reclaimed slots to congested stream $i$.
   - If no donor exists (all streams are actively utilized), expansion is gracefully suppressed, logging a "Resource Constrained: Reallocation Denied" notice.

---

## 6. Safe Dynamic Resizing Protocol

Dynamic resizing in a concurrent environment requires careful lock coordination:

### Expansion ($C_i \to C_i + \Delta C$)
1. Acquire stream $i$'s buffer mutex.
2. Expand capacity limit: $C_i \leftarrow C_i + \Delta C$.
3. Decrement global free budget: $B_{\text{free}} \leftarrow B_{\text{free}} - \Delta C$.
4. Broadcast `not_full.notify_all()` to immediately wake any blocked producer threads.
5. Release mutex and update cooldown timestamp.

### Contraction ($C_i \to C_i - \Delta C$)
1. Acquire stream $i$'s buffer mutex.
2. If current occupancy $O_i > C_i - \Delta C$:
   - Do NOT drop enqueued requests.
   - Set virtual capacity target; allow consumer to drain excess items naturally before lowering the hard limit.
3. Once $O_i \le C_i - \Delta C$, commit capacity reduction.
4. Increment global free budget: $B_{\text{free}} \leftarrow B_{\text{free}} + \Delta C$.
5. Release mutex and update cooldown timestamp.

---

## 7. Explainability Framework

Every controller action produces an explicit, structured audit record:

```json
{
  "timestampMs": 14200,
  "streamId": 1,
  "action": "EXPAND",
  "previousCapacity": 8,
  "newCapacity": 12,
  "justification": "Stream 1 buffer utilization averaged 86.4% (threshold: 80%) and producer wait time reached 34ms (threshold: 15ms) across 3 consecutive 100ms observation windows.",
  "budgetState": {
    "totalBudget": 48,
    "allocated": 44,
    "freeRemaining": 4
  }
}
```

---

## 8. Walkthrough Scenarios

### Scenario A: Localized Sudden Traffic Burst
- **Initial State**: Streams A, B, C each allocated 8 slots ($24/48$ used, 24 free).
- **Event**: Stream A experiences a $4\times$ arrival surge; Stream B and C maintain light steady traffic.
- **Controller Action**:
  - Windows 1–3: Stream A occupancy reaches 8/8 ($100\%$), producer wait time surges to $45\text{ ms}$.
  - Window 3 evaluation: Condition met for 3 windows. Stream A expanded from 8 to 12 slots from free budget.
  - Window 4: Stream A producer unblocks; queue stabilizes. Cooldown initiated for Stream A.
- **Result**: Throughput maintained without dropping requests or penalizing Streams B and C.

### Scenario B: Fully Contended Budget Reallocation
- **Initial State**: Streams A, B, C each allocated 16 slots ($48/48$ slots used, 0 free).
- **Event**: Stream C transitions to idle; Stream B experiences heavy burst.
- **Controller Action**:
  - Stream B requests expansion but $B_{\text{free}} = 0$.
  - Stream C shows $5\%$ utilization and $0\text{ ms}$ producer wait across 3 windows.
  - Controller identifies Stream C as a donor: contracts Stream C by 4 slots ($16 \to 12$).
  - Controller reallocates the 4 reclaimed slots to Stream B ($16 \to 20$).
- **Result**: Capacity transferred adaptively under a strict global invariant.
