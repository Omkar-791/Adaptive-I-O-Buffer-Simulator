#ifndef ADAPTIVE_IO_PRODUCER_H
#define ADAPTIVE_IO_PRODUCER_H

#include "BoundedBuffer.h"
#include "WorkloadGenerator.h"
#include "WorkloadFingerprint.h"
#include <cstdint>
#include <cstddef>
#include <chrono>

/**
 * @brief Simulates an I/O producer thread generating synthetic write requests
 * according to a configurable WorkloadGenerator profile.
 */
class Producer {
public:
    // Legacy constructor (backwards-compatible with Phase 1-3)
    Producer(BoundedBuffer& buffer,
             size_t num_requests,
             uint32_t interval_ms,
             size_t min_payload_bytes,
             size_t max_payload_bytes,
             uint32_t random_seed,
             uint32_t stream_id = 0);

    // Phase 4 constructor with dedicated WorkloadConfig
    Producer(BoundedBuffer& buffer,
             size_t num_requests,
             WorkloadConfig workload_config);

    /**
     * @brief Main thread execution loop for the producer.
     * Generates requests, simulates production intervals, and pushes to the buffer.
     */
    void run();

    // Post-join workload checksum; excludes allocation and wall-clock timestamps.
    uint64_t getWorkloadFingerprint() const noexcept { return workload_fingerprint_; }

    // Telemetry getters
    uint32_t getStreamId() const noexcept { return stream_id_; }
    size_t getProducedCount() const noexcept { return produced_count_; }
    size_t getTotalBytesProduced() const noexcept { return total_bytes_produced_; }
    std::chrono::nanoseconds getTotalBlockedTime() const noexcept { return total_blocked_time_; }
    const WorkloadGenerator& getWorkloadGenerator() const noexcept { return workload_gen_; }

private:
    BoundedBuffer& buffer_;
    const size_t num_requests_;
    const uint32_t stream_id_{0};
    WorkloadGenerator workload_gen_;

    // Telemetry metrics
    uint64_t workload_fingerprint_{WORKLOAD_FINGERPRINT_OFFSET};
    size_t produced_count_{0};
    size_t total_bytes_produced_{0};
    std::chrono::nanoseconds total_blocked_time_{0};
};

#endif // ADAPTIVE_IO_PRODUCER_H
