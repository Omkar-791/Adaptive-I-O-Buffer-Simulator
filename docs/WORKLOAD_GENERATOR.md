# Realistic Workload Generator Subsystem
**Adaptive I/O Buffer Management & Performance Optimization System**
**Specification Version**: 1.0.0 (Phase 4 Milestone)

---

## 1. Executive Summary & Purpose

In real-world operating systems and distributed storage systems, I/O workloads are rarely constant or predictable. Real storage controllers, file system buffer caches, and network interface queues encounter diverse and dynamic arrival patterns:
- Background batch transfers run at steady, predictable speeds.
- Interactive user actions, page faults, and database flushes produce rapid bursts.
- Multimedia streaming and cyclic polling generate periodic fluctuations.
- Microservices, web servers, and network packets arrive stochastically according to Poisson arrival processes.

The **Workload Generator Subsystem** in the Adaptive I/O Simulator replaces simplistic fixed-delay loops with a mathematically rigorous, configurable synthetic workload generator. It equips the simulation engine with realistic traffic generation required to benchmark and stress dynamic buffer allocation algorithms in later phases.

---

## 2. Architectural Design & Separation of Concerns

### 2.1 The Decision vs. Execution Decoupling Invariant
A critical architectural principle of the simulation engine is that **timing decisions are strictly separated from thread execution**:

```
+-------------------------------------------------------------+
|                   WorkloadGenerator Subsystem               |
|                                                             |
|  • Mathematical arrival models (Poisson, Sinusoidal, etc.)   |
|  • Phase transition state machines                          |
|  • Deterministic PRNG payload generation (std::mt19937)     |
|                                                             |
|  getNextRequest(sequence_num) -> WorkloadRequest            |
+------------------------------+------------------------------+
                               |
                               | returns plain data struct:
                               | {request_id, payload_bytes,
                               |  inter_arrival_ms, phase_name}
                               v
+-------------------------------------------------------------+
|                     Producer Thread Loop                    |
|                                                             |
|  • Sleeps for w_req.inter_arrival_ms                        |
|  • Constructs Request(id, payload, stream_id)               |
|  • Pushes into thread-safe BoundedBuffer                    |
|  • Tracks producer wait/blocking telemetry                  |
+-------------------------------------------------------------+
```

Because `WorkloadGenerator` contains zero `std::this_thread::sleep_for` calls, it is:
1. **100% Deterministic**: Given the same seed, calling `getNextRequest(i)` returns the exact same sequence across any platform or execution speed.
2. **Fast Unit Testing**: Millions of request decisions can be validated in milliseconds without sleeping.
3. **Inspectable & Pure**: The generator operates as a mathematical state machine.

---

## 3. Supported Workload Patterns

The subsystem supports five distinct synthetic workload patterns:

### 3.1 Steady Workload (`STEADY`)
* **Behavior**: Constant inter-arrival spacing between requests.
* **Model**: 
  $$\Delta t = T_{\text{base}}$$
* **Use Case**: Emulates continuous streaming or background batch operations with predictable cadence.

### 3.2 Burst Workload (`BURST`)
* **Behavior**: Alternates between a low-activity "Normal" phase and a high-activity "Burst" phase.
* **Model**: Let $L_{\text{cycle}} = L_{\text{normal}} + L_{\text{burst}}$. For request index $i$:
  $$\Delta t(i) = \begin{cases} T_{\text{base}} & \text{if } (i \pmod{L_{\text{cycle}}}) < L_{\text{normal}} \\ T_{\text{burst}} & \text{otherwise} \end{cases}$$
* **Use Case**: Simulates transactional database checkpointing, page cache flushes, and user spikes where requests surge rapidly, overflowing fixed buffers.

### 3.3 Periodic Workload (`PERIODIC`)
* **Behavior**: Smooth sinusoidal modulation of inter-arrival delays over a configured period length.
* **Model**:
  $$\theta(i) = \frac{2\pi \cdot (i \pmod P)}{P}$$
  $$\Delta t(i) = \text{round}\left(T_{\text{base}} \cdot \left[1.0 + \frac{A}{100} \cdot \sin(\theta(i))\right]\right)$$
  where $P$ is `period_length` and $A$ is `amplitude_pct`.
* **Discrete Alternative**: Alternatively, a discrete cyclic sequence `periodic_intervals_ms` can be configured.
* **Use Case**: Emulates periodic audio/video rendering frames or telemetry sensor sweeps.

### 3.4 Stochastic Workload (`STOCHASTIC`)
* **Behavior**: Memoryless Poisson arrival process where inter-arrival times follow an exponential distribution.
* **Model**:
  $$f(t) = \lambda e^{-\lambda t}, \quad t \ge 0$$
  $$\lambda = \begin{cases} \lambda_{\text{config}} & \text{if } \lambda_{\text{config}} > 0 \\ \frac{1}{T_{\text{base}}} & \text{otherwise} \end{cases}$$
  Inter-arrival delays are generated using `std::exponential_distribution<double>` seeded with `std::mt19937`.
* **Use Case**: Real-world queuing systems, web servers, and uncoordinated client network requests.

### 3.5 Mixed Workload (`MIXED`)
* **Behavior**: Multi-phase sequential pipeline with custom named phases, independent durations, inter-arrival times, and payload bounds.
* **Phases**: A vector of `WorkloadPhase` structs (e.g. `WARMUP` $\to$ `STRESS` $\to$ `COOLDOWN`).
* **Use Case**: End-to-end operational lifecycle testing and stress benchmarks.

---

## 4. Request Payload Distribution

Every generated request decision computes a payload size:
- **Uniform Bounds**: Samples uniformly between `min_payload_bytes` and `max_payload_bytes` using `std::uniform_int_distribution<size_t>`.
- **Per-Phase Bounds**: Mixed workloads can override payload bounds on a per-phase basis.
- **Invariance**: If $\text{min\_payload} \ge \text{max\_payload}$, the fixed size is returned without branching.

---

## 5. Seed Determinism & Multi-Stream Heterogeneity

1. **Strict Reproducibility**: Generators initialized with the same `WorkloadConfig::seed` produce bit-for-bit identical sequences of inter-arrival times and payload sizes.
2. **Stream Disambiguation**: In multi-stream uniform configurations, each stream derives a unique deterministic seed:
   $$\text{stream\_seed}_i = \text{seed}_{\text{base}} + (i \cdot 100)$$
3. **Heterogeneous Concurrency**: Multiple streams can run entirely different workload types simultaneously (e.g. Stream 0 = `PERIODIC`, Stream 1 = `BURST`, Stream 2 = `STOCHASTIC`) under a shared global buffer budget.

---

## 6. Configuration Schema & JSON Specification

Workloads can be configured via CLI flags or JSON configuration files.

### 6.1 Uniform Configuration Example (`configs/workload_burst.json`)
```json
{
  "num_streams": 2,
  "buffer_capacity": 16,
  "num_requests": 200,
  "consumer_processing_ms": 10,
  "workload": {
    "type": "BURST",
    "base_interval_ms": 15,
    "burst_interval_ms": 1,
    "burst_length": 20,
    "normal_length": 80,
    "min_payload_bytes": 512,
    "max_payload_bytes": 4096,
    "seed": 101
  }
}
```

### 6.2 Heterogeneous Configuration Example (`configs/workload_heterogeneous.json`)
```json
{
  "global_buffer_budget": 32,
  "streams": [
    {
      "stream_id": 0,
      "name": "Audio-Stream",
      "buffer_capacity": 8,
      "num_requests": 200,
      "consumer_processing_ms": 10,
      "workload": {
        "type": "PERIODIC",
        "base_interval_ms": 15,
        "period_length": 30,
        "amplitude_pct": 50.0,
        "min_payload_bytes": 1024,
        "max_payload_bytes": 2048,
        "seed": 1001
      }
    },
    {
      "stream_id": 1,
      "name": "Video-Stream",
      "buffer_capacity": 16,
      "num_requests": 200,
      "consumer_processing_ms": 5,
      "workload": {
        "type": "BURST",
        "base_interval_ms": 12,
        "burst_interval_ms": 1,
        "burst_length": 25,
        "normal_length": 75,
        "min_payload_bytes": 2048,
        "max_payload_bytes": 8192,
        "seed": 2002
      }
    },
    {
      "stream_id": 2,
      "name": "Telemetry-Stream",
      "buffer_capacity": 8,
      "num_requests": 200,
      "consumer_processing_ms": 12,
      "workload": {
        "type": "STOCHASTIC",
        "lambda": 0.1,
        "base_interval_ms": 10,
        "min_payload_bytes": 256,
        "max_payload_bytes": 512,
        "seed": 3003
      }
    }
  ]
}
```

---

## 7. Command Line Interface Reference

```
Options:
  --workload <type>     Workload pattern: steady, burst, periodic, stochastic, mixed (default: steady)
  --burst-interval <ms> Interval during burst phase in milliseconds (default: 1)
  --burst-length <n>    Requests per burst (default: 20)
  --normal-length <n>   Requests per normal period (default: 80)
  --config <path>       Load simulation and workload configuration from JSON file
  --json                Output machine-readable JSON telemetry to stdout
```

---

## 8. Verification and Test Results

The subsystem is validated by a 12-test suite in `engine/tests/test_workload_generator.cpp`:
- **TEST 1**: Steady workload fixed interval and bounded payload validation.
- **TEST 2**: Burst phase cycling and interval transitions.
- **TEST 3**: Periodic sinusoidal interval modulation.
- **TEST 4**: Stochastic Poisson / exponential mean arrival validation.
- **TEST 5**: Mixed custom phases with per-phase payload sizing.
- **TEST 6**: Strict PRNG seed reproducibility (bit-for-bit identical sequences).
- **TEST 7**: Seed differentiation across independent streams.
- **TEST 8**: Producer integration with `BoundedBuffer` push loop.
- **TEST 9**: Multi-stream `Simulation` execution with `BURST` traffic.
- **TEST 10**: Multi-stream `Simulation` execution with heterogeneous streams.
- **TEST 11**: `ConfigParser` JSON file and in-memory parsing.
- **TEST 12**: Serialization of workload metrics and event model notifications.

All 12 tests pass with 0 errors and 0 compiler warnings under `-std=c++17 -Wall -Wextra -Wpedantic`.
