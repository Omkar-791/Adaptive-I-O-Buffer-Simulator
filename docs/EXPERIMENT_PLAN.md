# Phase 8 implemented evaluation

The actual implementation and initial30 measured runs are documented in [EXPERIMENTS_PHASE8.md](EXPERIMENTS_PHASE8.md) and [PHASE8_EXPERIMENTAL_REPORT.md](PHASE8_EXPERIMENTAL_REPORT.md). They compare Fixed Equal and Adaptive with three same-seed repetitions across five existing configs. The larger matrix, pinned affinity, duration60s cases and extra baseline policies below are an older proposed plan, not executed results or implemented claims.

---

# Experiment Plan

This document establishes the experimental methodology, benchmarking matrices, variable controls, and comparative analysis framework for the **Adaptive I/O Buffer Management System**.

---

## 1. Research & Evaluation Objective
The experimental objective is to quantitatively evaluate how the **Adaptive Buffer Allocation Strategy** performs relative to traditional **Fixed Buffer Baselines** under heterogeneous and dynamic workloads, subject to a fixed global memory budget.

---

## 2. Experimental Variables

### Independent Variables
1. **Buffer Allocation Policy**:
   - `FixedSmall`: Static allocation with minimal buffer slots ($C_i = C_{\min}$).
   - `FixedMedium`: Static allocation with balanced, equal division of budget ($C_i = B_{\text{total}} / N$).
   - `FixedLarge`: Static allocation with maximum feasible slots per stream without exceeding budget.
   - `Adaptive`: Dynamic reallocation using multi-signal closed-loop feedback controller.
2. **Workload Profile**:
   - `Constant`: Uniform, predictable request arrival rate.
   - `Bursty`: Alternating phases of low baseline traffic and short, intense high-volume surges.
   - `IncreasingRamp`: Linearly increasing request rate over time.
   - `DecreasingRamp`: Linearly decreasing request rate over time.
   - `MixedPhased`: Realistic multi-phase workload (Low $\to$ Burst $\to$ High $\to$ Low).
3. **Contention Level**: Total active streams ($N \in \{3, 6, 12\}$) competing for the budget.

### Dependent Variables (Observed Metrics)
- Aggregate Throughput ($\text{req/s}$, $\text{MB/s}$)
- Mean and 95th Percentile Request Latency ($\text{ms}$)
- Total Producer Waiting Time ($\text{ms}$)
- Total Device / Consumer Idle Time ($\text{ms}$)
- Average Buffer Utilization ($\%$)
- Peak and Average Memory Footprint ($\text{slots}$)
- Total Buffer Resize Operations ($N_{\text{resize}}$)

### Controlled Variables (Held Constant Across Benchmark Pairs)
- Hardware platform and OS environment (Windows 11, fixed thread affinity).
- Total global memory budget ($B_{\text{total}} = 48\text{ slots}$).
- Consumer device service time distribution (e.g. $10\text{ ms} \pm 2\text{ ms}$).
- Pseudo-random number generator seeds (`seed = 42, 101, 777, 1337, 2026`).
- Total benchmark duration ($T_{\text{run}} = 60\text{ seconds}$ per run).

---

## 3. Experiment Matrix

A total of **20 core benchmark configurations** will be executed across 5 distinct random seeds (totaling 100 benchmark runs) to ensure statistical validity:

| Exp ID | Policy | Workload Type | Stream Count ($N$) | Budget ($B_{\text{total}}$) | Initial Allocation ($C_i$) |
|---|---|---|---|---|---|
| **EXP-01** | FixedSmall | Constant | 3 | 48 | [4, 4, 4] |
| **EXP-02** | FixedMedium | Constant | 3 | 48 | [16, 16, 16] |
| **EXP-03** | FixedLarge | Constant | 3 | 48 | [20, 20, 8] |
| **EXP-04** | Adaptive | Constant | 3 | 48 | [16, 16, 16] initial |
| **EXP-05** | FixedSmall | Bursty | 3 | 48 | [4, 4, 4] |
| **EXP-06** | FixedMedium | Bursty | 3 | 48 | [16, 16, 16] |
| **EXP-07** | FixedLarge | Bursty | 3 | 48 | [20, 20, 8] |
| **EXP-08** | Adaptive | Bursty | 3 | 48 | [16, 16, 16] initial |
| **EXP-09** | FixedSmall | IncreasingRamp | 3 | 48 | [4, 4, 4] |
| **EXP-10** | FixedMedium | IncreasingRamp | 3 | 48 | [16, 16, 16] |
| **EXP-11** | FixedLarge | IncreasingRamp | 3 | 48 | [20, 20, 8] |
| **EXP-12** | Adaptive | IncreasingRamp | 3 | 48 | [16, 16, 16] initial |
| **EXP-13** | FixedSmall | MixedPhased | 3 | 48 | [4, 4, 4] |
| **EXP-14** | FixedMedium | MixedPhased | 3 | 48 | [16, 16, 16] |
| **EXP-15** | FixedLarge | MixedPhased | 3 | 48 | [20, 20, 8] |
| **EXP-16** | Adaptive | MixedPhased | 3 | 48 | [16, 16, 16] initial |
| **EXP-17** | FixedSmall | Bursty | 6 | 48 | [4, 4, 4, 4, 4, 4] |
| **EXP-18** | FixedMedium | Bursty | 6 | 48 | [8, 8, 8, 8, 8, 8] |
| **EXP-19** | FixedLarge | Bursty | 6 | 48 | [12, 12, 8, 8, 4, 4] |
| **EXP-20** | Adaptive | Bursty | 6 | 48 | [8, 8, 8, 8, 8, 8] initial |

---

## 4. Reproducibility & Determinism

To guarantee reproducible experiments:
1. **Configurable PRNG Seed**: All arrival intervals and payload variations are generated using `std::mt19937` seeded with an explicit integer argument.
2. **Pre-Generated Workload Traces (Optional)**: Workloads can optionally be pre-generated into trace files (`.trace`) to ensure identical request arrival times across policies down to the nanosecond.
3. **Headless Execution**: Experiments run via command-line batch runner scripts with pinned thread priorities where possible.

---

## 5. Data Storage & Output Artifacts

Raw benchmark results and telemetry traces are stored in structured machine-readable formats under the `data/` directory:

```
data/
├── runs/
│   ├── run_20260929_140001_adaptive_bursty.json
│   ├── run_20260929_140001_adaptive_bursty.csv
│   └── run_20260929_140001_fixed_bursty.csv
└── summary/
    └── benchmark_comparison_summary.csv
```

### Raw Telemetry Schema (CSV)
`timestamp_ms, stream_id, policy, arrival_rate, service_rate, occupancy, capacity, utilization_pct, producer_wait_ms, consumer_idle_ms, latency_avg_ms, latency_p95_ms, throughput_req_s`

---

## 6. Expected Graphs & Analytical Plots

The following publication-grade comparative graphs will be generated from experimental data:

1. **Throughput vs. Workload Intensity**: Bar chart comparing aggregate throughput achieved by each policy across Constant, Bursty, and Mixed workloads.
2. **Producer Blocked Time**: Grouped bar chart demonstrating producer wait time reduction under the Adaptive policy during burst phases.
3. **Latency CDF (Cumulative Distribution Function)**: Request latency distribution curve comparing tail latencies ($P_{95}$, $P_{99}$).
4. **Dynamic Capacity Allocation Timeline**: Multi-line timeline illustrating how the adaptive controller reallocates slots in response to traffic bursts across streams.
5. **Memory Efficiency Trade-off**: Scatter plot of Throughput per allocated buffer slot, demonstrating resource efficiency.

---

## 7. Comparative Analysis Framework

To quantitatively evaluate if the adaptive controller succeeds, performance trade-offs will be calculated using normalized improvement ratios:

$$\Delta \text{Throughput} = \frac{X_{\text{adaptive}} - X_{\text{baseline}}}{X_{\text{baseline}}} \times 100\%$$
$$\Delta T_{\text{wait}} = \frac{T_{\text{wait, baseline}} - T_{\text{wait, adaptive}}}{T_{\text{wait, baseline}}} \times 100\%$$

### Success Criteria
- Under **Bursty Workloads**: Adaptive strategy must demonstrate $\ge 20\%$ reduction in producer blocked time compared to `FixedMedium` while maintaining equivalent or higher throughput.
- Under **Steady-State Workloads**: Adaptive strategy must exhibit zero thrashing ($< 2$ resizes per minute) and within $2\%$ throughput parity with `FixedMedium`.
