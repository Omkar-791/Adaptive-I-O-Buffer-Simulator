# Project Specification

## 1. Project Title
**Adaptive I/O Buffer Management & Performance Optimization System**

---

## 2. Abstract
Modern Operating Systems manage concurrent I/O operations across storage devices, network interfaces, and inter-process communication channels under strict memory constraints. Fixed-size I/O buffering schemes typically lead to either memory under-utilization during idle periods or severe head-of-line blocking and buffer starvation during high burst traffic. This project designs, implements, and evaluates an **Adaptive I/O Buffer Management System** that dynamically reallocates buffer capacities among multiple concurrent I/O streams under a global memory budget constraint. Built as an Operating Systems course project, the core simulation engine is implemented in native C++ using multithreading, mutexes, and condition variables, with a planned decoupled visualization layer.

---

## 3. Problem Statement
In an operating system, multiple I/O streams compete for bounded kernel buffer memory. Traditional buffer allocation schemes allocate static, fixed buffer capacities to individual streams or devices. This naive approach suffers from two complementary failure modes:
1. **Buffer Starvation / Backpressure**: Under heavy or bursty workloads, a fixed small buffer fills quickly, blocking producer threads and severely degrading ingestion throughput and request latency.
2. **Buffer Waste / Inefficiency**: Over-provisioning static large buffers to all streams wastes scarce physical memory, locking capacity that remains unused when streams idle.

The core systems problem addressed is:
> *How can limited I/O buffering capacity be dynamically allocated among changing concurrent workloads to maximize overall system throughput, minimize producer waiting time and request latency, while strictly respecting a shared global memory budget and preventing unstable buffer resizing oscillations?*

---

## 4. Motivation
Operating systems literature and real-world kernel subsystems (e.g., Linux TCP auto-tuning, kernel socket buffers `SO_RCVBUF`, and block layer request queues) demonstrate that static resource allocation cannot handle diverse, time-varying workloads. Dynamic buffer sizing under shared constraints illustrates key systems principles:
- Balancing contention vs. starvation.
- Ensuring thread safety and mutual exclusion during dynamic capacity adjustments.
- Decoupling synchronization primitives from high-level scheduling and allocation policies.
- Quantitatively evaluating system trade-offs through controlled experimentation.

---

## 5. Existing / Basic Approach vs. Proposed Approach

### Basic Approach (Traditional Course Projects)
- Standard Producer-Consumer problem using a single circular queue of fixed size.
- A single producer thread and a single consumer thread with binary semaphores or a single condition variable.
- No memory budget constraint; no stream competition.
- Static buffer size fixed at compile time or initialization.
- Inability to react to dynamic or bursty workloads.

### Proposed Approach
- **Multi-stream Concurrency**: Multiple independent I/O streams running concurrently on distinct threads.
- **Shared Memory Budget**: A global pool of buffer slots $\sum_{i=1}^N C_i \le B_{\text{total}}$ where individual stream capacities $C_i$ are dynamically partitioned.
- **Runtime Performance Telemetry**: Continuous measurement of buffer occupancy, producer wait times, consumer idle times, throughput, and latency.
- **Adaptive Allocation Controller**: A closed-loop feedback controller that evaluates telemetry over observation windows and reallocates buffer slots between streams using hysteresis, cooldown, and stability safeguards.
- **Controlled Comparative Evaluation**: Quantitative benchmarking of Fixed-Small, Fixed-Medium, Fixed-Large, and Adaptive strategies across reproducible synthetic workloads.

---

## 6. Project Objectives
1. Implement a robust, thread-safe bounded buffer supporting dynamic resizing without data corruption or deadlocks.
2. Simulate concurrent I/O producers and consumers modeling diverse device speeds and arrival patterns.
3. Enforce a shared memory budget across $N$ streams.
4. Design an adaptive feedback controller that reallocates capacity based on multi-signal runtime telemetry.
5. Provide a deterministic, reproducible workload generator supporting constant, bursty, increasing, and decreasing traffic patterns.
6. Conduct controlled quantitative experiments demonstrating the performance trade-offs of adaptive vs. fixed allocation.
7. Provide a clean interface for subsequent decoupled visualization (Node.js/WebSocket/React dashboard).

---

## 7. Scope & Explicit Non-Goals

### In Scope
- Simulation of I/O buffer management in user-space using standard C++ synchronization primitives (`std::thread`, `std::mutex`, `std::condition_variable`).
- Emulation of I/O request lifecycles (generation, buffering, consumption/storage).
- Runtime telemetry aggregation and metric calculations.
- Implementation and benchmarking of multiple buffer allocation policies.
- Modular architecture allowing file/socket-based IPC with visualization layers.

### Explicit Non-Goals
- **Kernel-space driver development**: The project does not modify Linux/Windows kernel source or implement kernel-level drivers.
- **Machine Learning / AI controllers**: Resource allocation uses deterministic, explainable heuristic control algorithms, not black-box neural networks.
- **Real disk / hardware benchmarking**: Physical disk latency and bus hardware are simulated/modeled via controlled sleep/spin mechanisms, avoiding physical hardware noise.
- **Premature database integration**: No relational or NoSQL database will be used; experiments serialize to standard JSON/CSV files.
- **Frontend-centric implementation**: The visualization layer will strictly consume telemetry and send control directives; no simulation logic will reside in JavaScript.

---

## 8. Academic Context: Why This Qualifies as an OS Course Project
This project goes significantly beyond standard textbook programming assignments by demonstrating core OS systems programming concepts:
- **Thread Concurrency & Scheduling**: Managing lifetimes and execution of multiple concurrent producer and consumer threads.
- **Mutual Exclusion & Synchronization**: Preventing race conditions via fine-grained mutexes and handling empty/full conditions via condition variables.
- **Deadlock Avoidance**: Enforcing strict lock ordering during inter-buffer reallocation and capacity adjustments.
- **Bounded Buffer Problem**: Generalizing circular bounded buffers to support runtime dynamic resizing under concurrent read/write operations.
- **Resource Management & Budgeting**: Managing a global memory constraint with contention among heterogeneous processes.
- **Feedback & Control**: Applying classic operating system concepts of hysteresis, smoothing, and admission control to prevent thrashing.
- **Performance Evaluation**: Conducting rigorous empirical benchmarking with controlled variables, reproducibility, and quantitative analysis.

---

## 9. Functional Requirements
1. **Configurable Streams**: Support $N$ concurrent I/O streams ($N \ge 1$), each with dedicated producer and consumer threads.
2. **Dynamic Buffer Resizing**: Safely increase or decrease individual buffer capacities at runtime while active I/O is ongoing.
3. **Shared Budget Enforcement**: Total allocated slots across all active streams must never exceed the configured global budget $B_{\text{total}}$.
4. **Workload Generation**: Generate synthetic request patterns:
   - Constant arrival rate
   - Bursty / Poisson arrivals
   - Linear ramp (increasing / decreasing)
   - Dynamic mixed phases
5. **Telemetry Aggregation**: Collect and log per-stream and global metrics over configurable sample intervals.
6. **Strategy Execution**: Run simulations under Fixed (Small, Medium, Large) and Adaptive policies.
7. **Telemetry Streaming**: Output metrics in structured JSON format to stdout or IPC socket.

---

## 10. Non-Functional Requirements
1. **Thread Safety**: Zero race conditions, data races, or deadlocks under high thread contention.
2. **Determinism & Reproducibility**: Given the same random seed and configuration, workload generation and baseline simulation runs must yield identical traces.
3. **Low Telemetry Overhead**: Metrics collection must introduce negligible lock contention and minimal CPU overhead.
4. **Modularity**: Clean separation of concerns between Buffer, Synchronization, Controller, Telemetry, and Workload modules.
5. **Portability**: Standards-compliant C++ (C++17 or C++20) compiling cleanly on Windows and POSIX systems.

---

## 11. Expected Inputs & Outputs

### Inputs
- Configuration file (JSON/text) or CLI parameters:
  - Total buffer budget ($B_{\text{total}}$)
  - Number of streams ($N$)
  - Initial buffer capacities ($C_1, \dots, C_N$)
  - Producer arrival profiles (rate, burst factor, payload size)
  - Consumer service profiles (processing latency, variance)
  - Buffer allocation policy (`FixedSmall`, `FixedMedium`, `FixedLarge`, `Adaptive`)
  - Controller hyperparameters (observation interval, thresholds, hysteresis)
  - Simulation duration and random seed

### Outputs
- Real-time telemetry feed (JSON stream over stdout/socket).
- Experiment summary report (CSV and JSON) containing:
  - Aggregate throughput (requests/sec, bytes/sec)
  - Latency distributions (mean, median, 95th percentile)
  - Producer wait times and blocked durations
  - Consumer idle times
  - Buffer occupancy and utilization timelines
  - Reallocation log with explainability annotations

---

## 12. Implementation Status: Current vs. Planned

| Component | Status | Description |
|---|---|---|
| **Directory & Build Scaffolding** | **CURRENTLY IMPLEMENTED** | Project folder structure, CMake build setup, documentation. |
| **Minimal Entry Point** | **CURRENTLY IMPLEMENTED** | Phase 0 verification executable. |
| **Bounded Buffer with Mutex/CV** | **CURRENTLY IMPLEMENTED (Phase 1)** | Single stream thread-safe bounded buffer. |
| **Multi-Stream Orchestration** | **CURRENTLY IMPLEMENTED (Phase 2)** | Concurrent execution of $N$ streams. |
| **Shared Budget Allocator** | **CURRENTLY IMPLEMENTED (Phase 3)** | Global memory budget management (`BufferResourceManager`), initial allocation, and resizing preparation. |
| **Synthetic Workload Generator** | **CURRENTLY IMPLEMENTED (Phase 4)** | Deterministic multi-pattern traffic generator (Steady, Burst, Periodic, Stochastic, Mixed) with strict seeds and JSON config loader. |
| **Metrics Engine** | *PLANNED (Phase 5)* | Lock-free / low-overhead telemetry collector. |
| **Adaptive Controller** | *PLANNED (Phase 6)* | Multi-signal feedback controller with hysteresis. |
| **Baseline Benchmark Runner** | *PLANNED (Phase 7–8)* | Automated execution of comparative experiment matrices. |
| **Node.js + WebSocket Gateway** | *PLANNED (Phase 9–10)* | Telemetry proxy and IPC bridge. |
| **React Dashboard UI** | *PLANNED (Phase 11–12)* | Real-time charts, controls, and comparative analysis views. |

---

## 13. Expected Evaluation Methodology
The project will be evaluated by running identical workload profiles against the four primary strategies:
1. **Fixed-Small Allocation**: Total budget equally divided with small capacity per stream.
2. **Fixed-Medium Allocation**: Balanced static capacity.
3. **Fixed-Large Allocation**: Streams statically over-provisioned (subject to budget).
4. **Adaptive Allocation**: Dynamically reallocating capacity towards congested streams.

Key evaluation criteria:
- **Throughput gain**: Percentage increase in request completion under bursty conditions.
- **Latency reduction**: Reduction in 95th percentile request queuing latency.
- **Producer blocking time**: Total time producer threads spent blocked waiting for free buffer slots.
- **Memory efficiency**: Average buffer utilization vs. peak allocation.
- **Resizing stability**: Total resize count and verification of zero oscillation.
