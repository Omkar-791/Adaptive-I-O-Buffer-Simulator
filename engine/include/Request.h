#ifndef ADAPTIVE_IO_REQUEST_H
#define ADAPTIVE_IO_REQUEST_H

#include <chrono>
#include <cstdint>
#include <cstddef>

/**
 * @brief Represents an individual I/O request in the simulation.
 *
 * Tracks the complete lifecycle of a request from creation through
 * enqueueing, dequeueing, and I/O completion.
 */
class Request {
public:
    using TimePoint = std::chrono::steady_clock::time_point;

    Request();
    Request(uint64_t id, size_t payload_bytes, uint32_t stream_id = 0);

    // Lifecycle timestamp recorders
    void recordCreation();
    void recordEnqueue();
    void recordDequeue();
    void recordCompletion();

    // Getters
    uint64_t getId() const noexcept { return id_; }
    size_t getPayloadBytes() const noexcept { return payload_bytes_; }
    uint32_t getStreamId() const noexcept { return stream_id_; }

    TimePoint getCreationTime() const noexcept { return creation_time_; }
    TimePoint getEnqueueTime() const noexcept { return enqueue_time_; }
    TimePoint getDequeueTime() const noexcept { return dequeue_time_; }
    TimePoint getCompletionTime() const noexcept { return completion_time_; }

    // Derived latency metrics in milliseconds
    double getTotalLatencyMs() const;
    double getQueueResidenceMs() const;
    double getServiceTimeMs() const;

private:
    uint64_t id_{0};
    size_t payload_bytes_{0};
    uint32_t stream_id_{0};

    TimePoint creation_time_{};
    TimePoint enqueue_time_{};
    TimePoint dequeue_time_{};
    TimePoint completion_time_{};
};

#endif // ADAPTIVE_IO_REQUEST_H
