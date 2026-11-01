#ifndef ADAPTIVE_IO_METRICS_H
#define ADAPTIVE_IO_METRICS_H

#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>
#include <iostream>

/**
 * @brief Telemetry and performance metrics for an individual I/O stream.
 */
struct StreamMetrics {
    uint32_t stream_id{0};
    std::string name{"Stream"};

    // Configuration
    size_t buffer_capacity{0};
    size_t target_requests{0};
    uint32_t producer_interval_ms{0};
    uint32_t consumer_processing_ms{0};
    uint32_t random_seed{0};
    std::string workload_type{"STEADY"};

    uint64_t workload_fingerprint{0}; // Post-join actual input checksum; experiment export only.

    // Execution counts
    size_t total_produced{0};
    size_t total_consumed{0};
    size_t total_bytes{0};

    // Rates
    double throughput_req_per_sec{0.0};
    double throughput_mb_per_sec{0.0};

    // Latency metrics (ms)
    double avg_latency_ms{0.0};
    double min_latency_ms{0.0};
    double max_latency_ms{0.0};

    // Producer wait metrics (ms)
    double total_producer_wait_ms{0.0};
    double avg_producer_wait_ms{0.0};

    // Occupancy metrics
    double avg_capacity_slots{0.0};
    double avg_occupancy_slots{0.0};
    double avg_occupancy_pct{0.0};
    size_t max_occupancy_slots{0};
    double max_occupancy_pct{0.0};

    bool success{false};

    /**
     * @brief Generates a canonical JSON representation of this stream's metrics.
     */
    std::string toJson() const;
};

/**
 * @brief Aggregated telemetry and performance metrics for the entire simulation run.
 */
struct SimulationMetrics {
    // Multi-stream scope
    size_t stream_count{1};
    std::vector<StreamMetrics> stream_metrics{};

    // Single-stream / Primary configuration echo (backwards-compatible)
    size_t buffer_capacity{0};
    size_t target_requests{0};
    uint32_t producer_interval_ms{0};
    uint32_t consumer_processing_ms{0};
    uint32_t random_seed{0};
    std::string workload_type{"STEADY"};

    // Phase 3: Global Buffer Budget & Resource Management
    size_t global_buffer_budget{0};
    size_t total_allocated_capacity{0};
    size_t min_buffer_capacity{1};
    size_t free_buffer_budget{0};

    // Aggregate execution counts
    size_t total_produced{0};
    size_t total_consumed{0};
    size_t total_bytes{0};

    // Timing & Global Rates
    double simulation_time_sec{0.0};
    double throughput_req_per_sec{0.0};
    double throughput_mb_per_sec{0.0};

    // Global Latency metrics (ms)
    double avg_latency_ms{0.0};
    double min_latency_ms{0.0};
    double max_latency_ms{0.0};

    // Global Producer blocking metrics (ms)
    double total_producer_wait_ms{0.0};
    double avg_producer_wait_ms{0.0};

    // Buffer occupancy metrics
    double avg_occupancy_slots{0.0};
    double avg_occupancy_pct{0.0};
    size_t max_occupancy_slots{0};
    double max_occupancy_pct{0.0};

    bool success{false};

    /**
     * @brief Generates a canonical JSON representation of global simulation metrics.
     */
    std::string toJson() const;

    /**
     * @brief Print human-readable summary report to the output stream.
     */
    void printReport(std::ostream& os) const;
};

#endif // ADAPTIVE_IO_METRICS_H
