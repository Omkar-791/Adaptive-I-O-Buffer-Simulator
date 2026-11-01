#ifndef ADAPTIVE_IO_CONSUMER_H
#define ADAPTIVE_IO_CONSUMER_H

#include "BoundedBuffer.h"
#include "Request.h"
#include <cstdint>
#include <cstddef>
#include <vector>
#include <chrono>

/**
 * @brief Simulates an I/O consumer thread draining requests from the buffer
 * and modeling storage or network hardware device processing latency.
 */
class Consumer {
public:
    Consumer(BoundedBuffer& buffer, uint32_t processing_time_ms, uint32_t stream_id = 0);

    /**
     * @brief Main thread execution loop for the consumer.
     * Pops requests until the buffer is closed and empty.
     */
    void run();

    // Telemetry getters
    uint32_t getStreamId() const noexcept { return stream_id_; }
    size_t getConsumedCount() const noexcept { return consumed_count_; }
    size_t getTotalBytesConsumed() const noexcept { return total_bytes_consumed_; }
    double getTotalLatencyMs() const noexcept { return total_latency_ms_; }
    double getMinLatencyMs() const noexcept { return min_latency_ms_; }
    double getMaxLatencyMs() const noexcept { return max_latency_ms_; }
    const std::vector<double>& getLatencies() const noexcept { return latencies_; }

private:
    BoundedBuffer& buffer_;
    const uint32_t processing_time_ms_;
    const uint32_t stream_id_{0};

    // Telemetry metrics
    size_t consumed_count_{0};
    size_t total_bytes_consumed_{0};
    double total_latency_ms_{0.0};
    double min_latency_ms_{0.0};
    double max_latency_ms_{0.0};
    std::vector<double> latencies_;
};

#endif // ADAPTIVE_IO_CONSUMER_H
