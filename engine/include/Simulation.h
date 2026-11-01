#ifndef ADAPTIVE_IO_SIMULATION_H
#define ADAPTIVE_IO_SIMULATION_H

#include "Metrics.h"
#include "MetricsEngine.h"
#include "RuntimeResizeExecutor.h"
#include "IOStream.h"
#include "BufferResourceManager.h"
#include "WorkloadGenerator.h"
#include <vector>
#include <memory>
#include <cstddef>
#include <cstdint>

/**
 * @brief Configuration parameters for a simulation run.
 * Supports single-stream (num_streams = 1) or uniform multi-stream runs,
 * with optional global buffer budget constraints (Phase 3).
 */
struct SimulationConfig {
    size_t num_streams{1};
    size_t buffer_capacity{8};
    size_t num_requests{1000};
    uint32_t producer_interval_ms{5};
    uint32_t consumer_processing_ms{10};
    size_t min_payload_bytes{512};
    size_t max_payload_bytes{4096};
    uint32_t random_seed{42};

    // Phase 3: Global Buffer Budget & Resource Management
    size_t global_buffer_budget{0};      // 0 = auto-calculate as (num_streams * buffer_capacity)
    size_t min_buffer_capacity{1};       // Minimum slots per stream (default: 1)
    bool capacity_explicitly_set{false}; // Set true when --capacity was passed on CLI

    // Phase 4: Realistic Workload Generator
    WorkloadConfig workload{};
    bool use_workload_config{false};
};

/**
 * @brief Orchestrates concurrent I/O simulation runs with shared resource management.
 *
 * Utilizes StreamManager to manage 1 to N independent I/O streams,
 * coordinates concurrent thread lifecycles and clean shutdown,
 * enforces global buffer budget constraints via BufferResourceManager,
 * and produces unified per-stream and global aggregate metrics.
 */
class Simulation {
public:
    explicit Simulation(SimulationConfig config);
    explicit Simulation(std::vector<IOStreamConfig> stream_configs, size_t global_budget = 0);

    /**
     * @brief Executes the simulation across all configured streams to completion.
     * @return Aggregated metrics and performance telemetry.
     */
    SimulationMetrics run();
    void setMetricsConfig(MetricsConfig config) { std::lock_guard<std::mutex> lock(snapshot_mutex_); metrics_config_ = config; }
    void setMetricsCallback(MetricsEngine::Callback callback) { std::lock_guard<std::mutex> lock(snapshot_mutex_); metrics_callback_ = std::move(callback); }
    MetricsSnapshot latestMetrics() const { std::lock_guard<std::mutex> lock(snapshot_mutex_); return latest_snapshot_; }

    void enableAdaptive(ControllerConfig config = {}, std::vector<StreamLimits> limits = {}) {
        std::lock_guard<std::mutex> lock(snapshot_mutex_);
        adaptive_enabled_=true; controller_config_=config; adaptive_limits_=std::move(limits);
    }
    void setResizeCallback(std::function<void(const ResizeResult&)> callback) {
        std::lock_guard<std::mutex> lock(snapshot_mutex_); resize_callback_=std::move(callback);
    }
    ResizeResult latestResizeResult() const { std::lock_guard<std::mutex> lock(snapshot_mutex_); return latest_resize_; }

    // Resource Manager Inspection (Phase 3)
    const BufferResourceManager& getResourceManager() const noexcept { return *resource_manager_; }
    BufferResourceManager& getResourceManager() noexcept { return *resource_manager_; }
    std::shared_ptr<BufferResourceManager> getResourceManagerPtr() const noexcept { return resource_manager_; }

private:
    bool adaptive_enabled_{false};
    ControllerConfig controller_config_{};
    std::vector<StreamLimits> adaptive_limits_;
    std::function<void(const ResizeResult&)> resize_callback_;
    ResizeResult latest_resize_;
    MetricsConfig metrics_config_{};
    MetricsEngine::Callback metrics_callback_;
    mutable std::mutex snapshot_mutex_;
    MetricsSnapshot latest_snapshot_;
    std::vector<IOStreamConfig> stream_configs_;
    SimulationConfig base_config_{};
    bool is_custom_configs_{false};
    std::shared_ptr<BufferResourceManager> resource_manager_;
};

#endif // ADAPTIVE_IO_SIMULATION_H
