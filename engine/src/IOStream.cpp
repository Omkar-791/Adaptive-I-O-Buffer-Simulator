#include "IOStream.h"
#include <chrono>

namespace {
WorkloadConfig resolveWorkloadConfig(const IOStreamConfig& cfg) {
    if (cfg.use_workload_config) {
        WorkloadConfig w = cfg.workload;
        w.stream_id = cfg.stream_id;
        return w;
    }
    WorkloadConfig w;
    w.type = WorkloadType::STEADY;
    w.base_interval_ms = cfg.producer_interval_ms;
    w.min_payload_bytes = cfg.min_payload_bytes;
    w.max_payload_bytes = cfg.max_payload_bytes;
    w.seed = cfg.random_seed;
    w.stream_id = cfg.stream_id;
    return w;
}
} // namespace

IOStream::IOStream(IOStreamConfig config)
    : config_(config),
      buffer_(config.buffer_capacity),
      producer_(buffer_,
                config.num_requests,
                resolveWorkloadConfig(config)),
      consumer_(buffer_,
                config.consumer_processing_ms,
                config.stream_id) {}

IOStream::~IOStream() {
    join();
}

void IOStream::start() {
    if (started_) {
        return;
    }
    started_ = true;
    producer_thread_ = std::thread(&Producer::run, &producer_);
    consumer_thread_ = std::thread(&Consumer::run, &consumer_);
}

void IOStream::joinProducer() {
    if (producer_thread_.joinable() && !producer_joined_) {
        producer_thread_.join();
        producer_joined_ = true;
    }
}

void IOStream::closeBuffer() {
    buffer_.close();
}

void IOStream::joinConsumer() {
    if (consumer_thread_.joinable() && !consumer_joined_) {
        consumer_thread_.join();
        consumer_joined_ = true;
    }
}

void IOStream::join() {
    joinProducer();
    closeBuffer();
    joinConsumer();
}

StreamMetrics IOStream::getMetrics(double simulation_time_sec) const {
    StreamMetrics sm;
    sm.stream_id = config_.stream_id;
    sm.name = config_.name;
    sm.buffer_capacity = buffer_.capacity();
    sm.target_requests = config_.num_requests;
    sm.producer_interval_ms = config_.producer_interval_ms;
    sm.consumer_processing_ms = config_.consumer_processing_ms;
    sm.random_seed = config_.random_seed;
    sm.workload_type = workloadTypeToString(producer_.getWorkloadGenerator().getConfig().type);

    sm.workload_fingerprint = producer_.getWorkloadFingerprint();
    sm.total_produced = producer_.getProducedCount();
    sm.total_consumed = consumer_.getConsumedCount();
    sm.total_bytes = consumer_.getTotalBytesConsumed();

    if (simulation_time_sec > 0.0) {
        sm.throughput_req_per_sec = static_cast<double>(sm.total_consumed) / simulation_time_sec;
        sm.throughput_mb_per_sec = (static_cast<double>(sm.total_bytes) / (1024.0 * 1024.0)) / simulation_time_sec;
    }

    if (sm.total_consumed > 0) {
        sm.avg_latency_ms = consumer_.getTotalLatencyMs() / static_cast<double>(sm.total_consumed);
        sm.min_latency_ms = consumer_.getMinLatencyMs();
        sm.max_latency_ms = consumer_.getMaxLatencyMs();
    }

    sm.total_producer_wait_ms = std::chrono::duration<double, std::milli>(producer_.getTotalBlockedTime()).count();
    if (sm.total_produced > 0) {
        sm.avg_producer_wait_ms = sm.total_producer_wait_ms / static_cast<double>(sm.total_produced);
    }

    sm.avg_occupancy_slots = buffer_.getAverageOccupancy();
    const double avg_capacity = buffer_.getAverageCapacity();
    sm.avg_capacity_slots = avg_capacity;
    if (avg_capacity > 0) sm.avg_occupancy_pct = sm.avg_occupancy_slots / avg_capacity * 100;

    sm.max_occupancy_slots = buffer_.getMaxOccupancy();
    sm.max_occupancy_pct = buffer_.getMaxOccupancyPct();

    sm.success = (sm.total_produced == config_.num_requests &&
                  sm.total_consumed == sm.total_produced);
    return sm;
}
