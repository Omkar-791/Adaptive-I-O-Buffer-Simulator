Phase 5 implementation definitions: [METRICS_PHASE5.md](METRICS_PHASE5.md). The following formulas also include future design goals.

# Metrics Specification

This document provides formal definitions, mathematical formulas, aggregation methodologies, and visualization plans for all performance metrics collected by the **Adaptive I/O Buffer Management System**.

---

## Metric Summary Table

| Metric Name | Symbol | Unit | Scope | Primary Purpose |
|---|---|---|---|---|
| **Throughput** | $X$ | req/s, MB/s | Per-stream & Global | Measures data completion rate |
| **Request Latency** | $L$ | ms | Per-stream & Global | Measures end-to-end request turnaround |
| **Buffer Occupancy** | $O$ | slots, bytes | Per-stream | Measures current queue length |
| **Buffer Capacity** | $C$ | slots, bytes | Per-stream & Global | Tracks allocated resource limit |
| **Buffer Utilization** | $U$ | % | Per-stream & Global | Quantifies buffer memory efficiency |
| **Producer Waiting Time** | $T_{\text{pwait}}$ | ms | Per-stream & Global | Measures producer blocking due to full buffer |
| **Consumer Idle Time** | $T_{\text{cidle}}$ | ms | Per-stream & Global | Measures device under-utilization due to empty buffer |
| **Total Memory Usage** | $M_{\text{total}}$ | slots, bytes | Global | Verifies adherence to global budget constraint |
| **Buffer Resize Count** | $N_{\text{resize}}$ | count | Per-stream & Global | Evaluates controller stability and churn |
| **Processed Requests** | $R_{\text{proc}}$ | count | Per-stream & Global | Quantifies total workload delivered |
| **Dropped / Rejected Requests** | $R_{\text{drop}}$ | count | Per-stream & Global | Tracks buffer overflow drops (if non-blocking mode enabled) |

---

## Detailed Metric Definitions

### 1. Throughput ($X$)
- **Definition**: The rate at which I/O requests are completely processed and drained by the consumer thread over a given time interval.
- **Unit**: Requests per second ($\text{req/s}$) and megabytes per second ($\text{MB/s}$).
- **Formula**:
  $$\text{Throughput}_{\Delta t} = \frac{\Delta R_{\text{proc}}}{\Delta t}$$
  $$\text{ByteThroughput}_{\Delta t} = \frac{\sum_{k=1}^{\Delta R_{\text{proc}}} \text{Size}(k)}{\Delta t \times 10^6}$$
- **Data Source**: Consumer thread completion counter and timestamp deltas.
- **Scope**: Per-stream ($X_i$) and Global ($X_{\text{total}} = \sum_{i=1}^N X_i$).
- **Why It Matters**: Throughput is the primary measure of system bandwidth. Dynamic buffer expansion must maintain or increase throughput under bursty traffic.
- **Visualization**: Real-time line chart showing throughput over time per stream and stacked global aggregate.

---

### 2. Request Latency ($L$)
- **Definition**: The total elapsed time from when an I/O request is created by the producer until it is completely serviced by the consumer.
- **Unit**: Milliseconds ($\text{ms}$).
- **Formula**:
  $$L_k = t_{\text{completed}}(k) - t_{\text{created}}(k)$$
  $$L_k = t_{\text{wait\_buffer}}(k) + t_{\text{queue\_residence}}(k) + t_{\text{service}}(k)$$
- **Summary Statistics**:
  - Mean Latency: $\bar{L} = \frac{1}{K}\sum_{k=1}^K L_k$
  - Tail Latency: 95th and 99th percentiles ($P_{95}$, $P_{99}$) computed over sliding window.
- **Data Source**: `IORequest` lifecycle timestamps (`t_created`, `t_enqueued`, `t_dequeued`, `t_completed`).
- **Scope**: Per-stream and Global.
- **Why It Matters**: Essential metric for SLA compliance. High buffer capacity can cause "bufferbloat" (increased queuing latency), which the adaptive controller must balance against throughput.
- **Visualization**: Multi-line chart (Mean vs. P95) and boxplot / latency histogram.

---

### 3. Buffer Occupancy ($O$)
- **Definition**: The number of I/O request slots (or total bytes) currently held in a stream's bounded circular buffer at instant $t$.
- **Unit**: Slots (integer count) or Bytes ($\text{KB}/\text{MB}$).
- **Formula**:
  $$O_i(t) = \text{EnqueuedCount}_i(t) - \text{DequeuedCount}_i(t)$$
  $$\text{Time-Average Occupancy}: \bar{O}_{i,\Delta t} = \frac{1}{\Delta t} \int_{t}^{t+\Delta t} O_i(\tau) \, d\tau$$
- **Data Source**: Internal atomic counter or protected size of `BoundedBuffer`.
- **Scope**: Per-stream.
- **Why It Matters**: Direct signal of backlog and congestion. When $O_i(t) \to C_i(t)$, the stream is at risk of blocking the producer.
- **Visualization**: Gauge chart and stacked area chart showing real-time queue depth.

---

### 4. Buffer Capacity ($C$)
- **Definition**: The maximum number of slots currently allocated to an individual buffer by the buffer manager.
- **Unit**: Slots.
- **Formula**:
  $$C_i(t) \in [C_{\min}, C_{\max}]$$
  $$\sum_{i=1}^N C_i(t) \le B_{\text{total}}$$
- **Data Source**: `BoundedBuffer::getCapacity()` managed by `BufferManager`.
- **Scope**: Per-stream and Global ($B_{\text{total}}$).
- **Why It Matters**: Visualizes how the adaptive controller shifts buffering resources between competing streams.
- **Visualization**: Stepped line chart showing dynamic capacity adjustments over time.

---

### 5. Buffer Utilization ($U$)
- **Definition**: The percentage of allocated buffer capacity currently occupied by pending requests.
- **Unit**: Percentage ($\%$).
- **Formula**:
  $$U_i(t) = \left( \frac{O_i(t)}{C_i(t)} \right) \times 100\%$$
  $$\text{Global Utilization}: U_{\text{global}}(t) = \left( \frac{\sum_{i=1}^N O_i(t)}{B_{\text{total}}} \right) \times 100\%$$
- **Data Source**: Ratio of instantaneous or window-averaged occupancy to capacity.
- **Scope**: Per-stream and Global.
- **Why It Matters**: Identifies under-provisioned streams ($U > 85\%$) that need more capacity and over-provisioned streams ($U < 20\%$) from which memory can be reclaimed.
- **Visualization**: Heatmap or gauge progress bar with green/yellow/red thresholds.

---

### 6. Producer Waiting Time ($T_{\text{pwait}}$)
- **Definition**: The cumulative time a producer thread remains blocked on the `not_full` condition variable waiting for an available buffer slot.
- **Unit**: Milliseconds ($\text{ms}$) or percentage of total run time ($\%$ blocked).
- **Formula**:
  $$T_{\text{pwait}, i} = \sum_{j} (t_{\text{unblocked}, j} - t_{\text{blocked\_full}, j})$$
  $$\text{Blocked Ratio}: \rho_{\text{pwait}, i} = \frac{T_{\text{pwait}, i}}{\text{Total Elapsed Time}} \times 100\%$$
- **Data Source**: High-resolution clock measurement wrapped around `condition_variable.wait()` calls in producer.
- **Scope**: Per-stream and Global.
- **Why It Matters**: High producer wait time signifies severe I/O backpressure. A primary objective of adaptive allocation is minimizing producer wait time without increasing the total memory budget.
- **Visualization**: Bar chart comparing baseline vs. adaptive, and real-time timeline spike indicator.

---

### 7. Consumer / Device Idle Time ($T_{\text{cidle}}$)
- **Definition**: The cumulative time a consumer/device thread remains blocked on the `not_empty` condition variable because the buffer has no requests to process.
- **Unit**: Milliseconds ($\text{ms}$) or percentage of total run time ($\%$ idle).
- **Formula**:
  $$T_{\text{cidle}, i} = \sum_{j} (t_{\text{unblocked}, j} - t_{\text{blocked\_empty}, j})$$
  $$\text{Device Starvation Ratio}: \rho_{\text{cidle}, i} = \frac{T_{\text{cidle}, i}}{\text{Total Elapsed Time}} \times 100\%$$
- **Data Source**: High-resolution clock measurement wrapped around `condition_variable.wait()` calls in consumer.
- **Scope**: Per-stream and Global.
- **Why It Matters**: In real systems, device idle time represents wasted I/O hardware bandwidth. If a buffer drains completely while an upstream burst is pending, the device is starved.
- **Visualization**: Timeline ribbon showing busy vs. idle device states.

---

### 8. Total Memory / Buffer Usage ($M_{\text{total}}$)
- **Definition**: The total number of buffer slots currently allocated across all active streams.
- **Unit**: Slots and Kilobytes ($\text{KB}$).
- **Formula**:
  $$M_{\text{allocated}}(t) = \sum_{i=1}^N C_i(t)$$
  $$\text{Budget Slack}: B_{\text{free}}(t) = B_{\text{total}} - M_{\text{allocated}}(t) \ge 0$$
- **Telemetry Fields**: `global_buffer_budget`, `total_allocated_capacity`, `free_buffer_budget`, `min_buffer_capacity`.
- **Data Source**: `BufferResourceManager` internal accounting ledger.
- **Scope**: Global.
- **Why It Matters**: Ensures the simulation engine strictly adheres to the physical memory budget invariant ($\sum C_i \le B_{\text{total}}$). Demonstrates that adaptive gains do not rely on unlimited memory expansion.
- **Visualization**: Donut chart / stacked bar showing allocated per stream vs. unallocated free budget.

---

### 9. Buffer Resize Count ($N_{\text{resize}}$)
- **Definition**: The total number of dynamic capacity expansion and contraction events executed by the controller.
- **Unit**: Integer count.
- **Formula**:
  $$N_{\text{resize}} = \sum_{k} \mathbb{I}(C(t_k) \neq C(t_{k-1}))$$
- **Data Source**: `BufferManager` resize audit counter.
- **Scope**: Per-stream and Global.
- **Why It Matters**: Evaluates controller stability. Excessive resizing indicates instability (thrashing/oscillation) which incurs locking overhead and memory fragmentation.
- **Visualization**: Step line and counter metric badge.

---

### 10. Processed Requests ($R_{\text{proc}}$)
- **Definition**: The total count of completed I/O requests from simulation start to time $t$.
- **Unit**: Count.
- **Formula**:
  $$R_{\text{proc}, i}(t) = \sum \text{Completed Requests for stream } i$$
- **Data Source**: Consumer completion counters.
- **Scope**: Per-stream and Global.
- **Why It Matters**: Primary denominator for aggregate statistical averages and workload completion tracking.
- **Visualization**: Big Number KPI card and cumulative progress bar.

---

### 11. Dropped / Rejected Requests ($R_{\text{drop}}$)
- **Definition**: Requests discarded or rejected when non-blocking enqueue mode is selected and the buffer is full. *(Note: in blocking producer-consumer mode, $R_{\text{drop}} = 0$ as producers wait on condition variables instead of dropping).*
- **Unit**: Count.
- **Formula**:
  $$R_{\text{drop}, i}(t) = \sum \text{Rejected Enqueue Attempts for stream } i$$
- **Data Source**: Producer rejected attempt counters.
- **Scope**: Per-stream and Global.
- **Why It Matters**: Crucial metric when modeling lossy or real-time network packet queues where dropping is preferred over blocking.
- **Visualization**: Warning indicator and error rate chart.
