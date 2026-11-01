#include "Simulation.h"
#include "StreamManager.h"
#include <chrono>
#include <algorithm>
#include <limits>
#include <stdexcept>

namespace {

std::vector<IOStreamConfig> buildConfigs(
    const SimulationConfig& config,
    const std::vector<size_t>& allocated_capacities) {

    const size_t count = std::max<size_t>(1, config.num_streams);
    std::vector<IOStreamConfig> configs;
    configs.reserve(count);

    for (size_t i = 0; i < count; ++i) {
        IOStreamConfig sc;
        sc.stream_id = static_cast<uint32_t>(i);
        sc.name = "Stream-" + std::to_string(i);
        sc.buffer_capacity = allocated_capacities[i];
        sc.num_requests = config.num_requests;
        sc.producer_interval_ms = config.producer_interval_ms;
        sc.consumer_processing_ms = config.consumer_processing_ms;
        sc.min_payload_bytes = config.min_payload_bytes;
        sc.max_payload_bytes = config.max_payload_bytes;
        // Unique deterministic seed per stream
        sc.random_seed = config.random_seed + static_cast<uint32_t>(i * 100);
        if (config.use_workload_config) {
            sc.use_workload_config = true;
            sc.workload = config.workload;
            sc.workload.stream_id = sc.stream_id;
            sc.workload.seed = sc.random_seed;
        }
        configs.push_back(sc);
    }
    return configs;
}

} // anonymous namespace

Simulation::Simulation(SimulationConfig config)
    : base_config_(config),
      is_custom_configs_(false) {

    const size_t count = std::max<size_t>(1, config.num_streams);

    // Auto-calculate budget if not specified (backwards-compatible with Phase 1 & 2)
    size_t effective_budget = config.global_buffer_budget;
    if (effective_budget == 0) {
        effective_budget = count * config.buffer_capacity;
    }

    const size_t min_cap = std::max<size_t>(1, config.min_buffer_capacity);
    const size_t min_required = count * min_cap;

    if (effective_budget < min_required) {
        throw std::invalid_argument(
            "Simulation: Global buffer budget (" + std::to_string(effective_budget) +
            ") is insufficient for " + std::to_string(count) +
            " streams with minimum capacity " + std::to_string(min_cap) +
            " (requires at least " + std::to_string(min_required) + " slots)");
    }

    resource_manager_ = std::make_shared<BufferResourceManager>(effective_budget, min_cap);

    std::vector<size_t> capacities;
    if (config.capacity_explicitly_set) {
        const size_t total_explicit = count * config.buffer_capacity;
        if (total_explicit > effective_budget) {
            throw std::invalid_argument(
                "Simulation: Explicit capacity (" + std::to_string(config.buffer_capacity) +
                " slots * " + std::to_string(count) + " streams = " + std::to_string(total_explicit) +
                ") exceeds global buffer budget (" + std::to_string(effective_budget) + ")");
        }
        capacities.assign(count, config.buffer_capacity);
    } else {
        // Equal distribution with deterministic remainder allocation
        capacities = resource_manager_->allocateEqual(count);
    }

    // Register all streams with the resource manager
    for (size_t i = 0; i < count; ++i) {
        std::string err;
        if (!resource_manager_->registerStream(static_cast<uint32_t>(i), capacities[i], &err)) {
            throw std::invalid_argument("Simulation: Failed to register stream " + std::to_string(i) + ": " + err);
        }
    }

    stream_configs_ = buildConfigs(config, capacities);
}

Simulation::Simulation(std::vector<IOStreamConfig> stream_configs, size_t global_budget)
    : stream_configs_(std::move(stream_configs)),
      is_custom_configs_(true) {

    size_t total_explicit_capacity = 0;
    for (const auto& sc : stream_configs_) {
        total_explicit_capacity += sc.buffer_capacity;
    }

    const size_t effective_budget = (global_budget == 0) ? total_explicit_capacity : global_budget;

    if (total_explicit_capacity > effective_budget) {
        throw std::invalid_argument(
            "Simulation: Total stream capacity (" + std::to_string(total_explicit_capacity) +
            ") exceeds global buffer budget (" + std::to_string(effective_budget) + ")");
    }

    resource_manager_ = std::make_shared<BufferResourceManager>(effective_budget, 1);

    for (const auto& sc : stream_configs_) {
        std::string err;
        if (!resource_manager_->registerStream(sc.stream_id, sc.buffer_capacity, &err)) {
            throw std::invalid_argument(
                "Simulation: Failed to register stream " + std::to_string(sc.stream_id) + ": " + err);
        }
    }
}

SimulationMetrics Simulation::run() {
    const auto sim_start = std::chrono::steady_clock::now();

    StreamManager manager;
    manager.setResourceManager(resource_manager_);

    for (auto sc : stream_configs_) {
        // Preserve allocations acknowledged by a previous adaptive run.
        sc.buffer_capacity=resource_manager_->getStreamCapacity(sc.stream_id);
        manager.addStream(sc);
    }

    MetricsConfig sampling_config;
    MetricsEngine::Callback callback;
    bool adaptive;
    ControllerConfig controller_config;
    std::vector<StreamLimits> limits;
    std::function<void(const ResizeResult&)> resize_callback;
    { std::lock_guard<std::mutex> lock(snapshot_mutex_);
      sampling_config=metrics_config_; callback=metrics_callback_;
      adaptive=adaptive_enabled_; controller_config=controller_config_;
      limits=adaptive_limits_; resize_callback=resize_callback_;
      latest_resize_=ResizeResult{};
    }
    std::unique_ptr<AdaptiveController> controller;
    std::unique_ptr<RuntimeResizeExecutor> executor;
    if(adaptive) {
        if(limits.empty()) for(const auto& allocation:resource_manager_->getAllocations())
            limits.push_back({allocation.stream_id,resource_manager_->getMinCapacity(),std::max<size_t>(64,allocation.capacity)});
        std::vector<BufferBinding> bindings;
        for(const auto& limit:limits) {
            auto* stream=manager.getStreamById(limit.stream_id);
            if(!stream) throw std::invalid_argument("Adaptive limits reference an unknown stream");
            bindings.push_back({limit.stream_id,&stream->getBuffer(),limit.min_capacity,limit.max_capacity});
        }
        controller=std::make_unique<AdaptiveController>(controller_config);
        executor=std::make_unique<RuntimeResizeExecutor>(*resource_manager_,std::move(bindings));
    }
    MetricsEngine monitor(manager, sampling_config, [this, callback, &controller, &executor, &limits, resize_callback](const MetricsSnapshot& snapshot) {
        { std::lock_guard<std::mutex> lock(snapshot_mutex_); latest_snapshot_ = snapshot; }
        if (callback) callback(snapshot);
        if(controller) {
            const auto decision=controller->evaluate(snapshot,*resource_manager_,limits);
            if(!decision.valid) throw std::runtime_error("Adaptive decision invalid: "+decision.reason);
            if(decision.changed()) {
                const auto result=executor->apply(decision);
                { std::lock_guard<std::mutex> lock(snapshot_mutex_); latest_resize_=result; }
                if(resize_callback) resize_callback(result);
            }
        }
    });
    monitor.start();

    // Concurrently launch all streams (2N worker threads)
    manager.startAll();

    // Orchestrate synchronized shutdown
    manager.joinAll();
    monitor.stop();

    const auto sim_end = std::chrono::steady_clock::now();
    const double sim_duration_sec = std::chrono::duration<double>(sim_end - sim_start).count();

    // Collect per-stream metrics
    std::vector<StreamMetrics> per_stream = manager.collectMetrics(sim_duration_sec);

    SimulationMetrics metrics;
    metrics.stream_count = per_stream.size();
    metrics.stream_metrics = per_stream;
    metrics.simulation_time_sec = sim_duration_sec;

    // Phase 3 Global Budget Telemetry
    if (resource_manager_) {
        metrics.global_buffer_budget = resource_manager_->getTotalBudget();
        metrics.total_allocated_capacity = resource_manager_->getTotalAllocated();
        metrics.free_buffer_budget = resource_manager_->getFreeBudget();
        metrics.min_buffer_capacity = resource_manager_->getMinCapacity();
    }

    if (!is_custom_configs_) {
        metrics.buffer_capacity = base_config_.buffer_capacity;
        metrics.target_requests = base_config_.num_requests;
        metrics.producer_interval_ms = base_config_.producer_interval_ms;
        metrics.consumer_processing_ms = base_config_.consumer_processing_ms;
        metrics.random_seed = base_config_.random_seed;
        if (base_config_.use_workload_config) {
            metrics.workload_type = workloadTypeToString(base_config_.workload.type);
        } else if (!per_stream.empty()) {
            metrics.workload_type = per_stream[0].workload_type;
        }
    } else if (!per_stream.empty()) {
        metrics.buffer_capacity = per_stream[0].buffer_capacity;
        metrics.target_requests = per_stream[0].target_requests;
        metrics.producer_interval_ms = per_stream[0].producer_interval_ms;
        metrics.consumer_processing_ms = per_stream[0].consumer_processing_ms;
        metrics.random_seed = per_stream[0].random_seed;
        bool all_same_workload = true;
        for (const auto& sm : per_stream) {
            if (sm.workload_type != per_stream[0].workload_type) {
                all_same_workload = false;
                break;
            }
        }
        metrics.workload_type = all_same_workload ? per_stream[0].workload_type : "HETEROGENEOUS";
    }

    double total_latency_sum = 0.0;
    double min_lat = std::numeric_limits<double>::max();
    double max_lat = 0.0;
    size_t total_capacity = 0;
    double average_total_capacity = 0;
    bool all_succeeded = true;

    for (const auto& sm : per_stream) {
        metrics.total_produced += sm.total_produced;
        metrics.total_consumed += sm.total_consumed;
        metrics.total_bytes += sm.total_bytes;
        metrics.total_producer_wait_ms += sm.total_producer_wait_ms;
        metrics.avg_occupancy_slots += sm.avg_occupancy_slots;
        metrics.max_occupancy_slots = std::max(metrics.max_occupancy_slots, sm.max_occupancy_slots);

        total_capacity += sm.buffer_capacity;
        average_total_capacity += sm.avg_capacity_slots;
        total_latency_sum += (sm.avg_latency_ms * static_cast<double>(sm.total_consumed));

        if (sm.total_consumed > 0) {
            min_lat = std::min(min_lat, sm.min_latency_ms);
            max_lat = std::max(max_lat, sm.max_latency_ms);
        }

        if (!sm.success) {
            all_succeeded = false;
        }
    }

    if (sim_duration_sec > 0.0) {
        metrics.throughput_req_per_sec = static_cast<double>(metrics.total_consumed) / sim_duration_sec;
        metrics.throughput_mb_per_sec = (static_cast<double>(metrics.total_bytes) / (1024.0 * 1024.0)) / sim_duration_sec;
    }

    if (metrics.total_consumed > 0) {
        metrics.avg_latency_ms = total_latency_sum / static_cast<double>(metrics.total_consumed);
        metrics.min_latency_ms = (min_lat == std::numeric_limits<double>::max()) ? 0.0 : min_lat;
        metrics.max_latency_ms = max_lat;
    }

    if (metrics.total_produced > 0) {
        metrics.avg_producer_wait_ms = metrics.total_producer_wait_ms / static_cast<double>(metrics.total_produced);
    }

    if (total_capacity > 0) {
        metrics.avg_occupancy_pct = average_total_capacity > 0 ? metrics.avg_occupancy_slots / average_total_capacity * 100.0 : 0;
        metrics.max_occupancy_pct = (static_cast<double>(metrics.max_occupancy_slots) / static_cast<double>(total_capacity)) * 100.0;
    }

    if(!per_stream.empty()) metrics.buffer_capacity=per_stream[0].buffer_capacity;
    metrics.success = all_succeeded && (metrics.total_produced == metrics.total_consumed);

    return metrics;
}
