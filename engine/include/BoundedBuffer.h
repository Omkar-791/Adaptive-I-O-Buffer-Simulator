#ifndef ADAPTIVE_IO_BOUNDED_BUFFER_H
#define ADAPTIVE_IO_BOUNDED_BUFFER_H

#include "Request.h"
#include <vector>
#include <mutex>
#include <condition_variable>
#include <chrono>
#include <cstddef>
#include <cstdint>
#include <array>

struct BufferObservation {
    size_t produced{0}, consumed{0}, bytes{0}, occupancy{0}, capacity{0};
    uint64_t producer_wait_ns{0}, consumer_wait_ns{0}, full_events{0}, empty_events{0};
    double occupancy_ns{0.0}, capacity_ns{0.0}, latency_sum_ms{0.0};
    // Bucket k = floor(log2(latency_us + 1)), capped at 63.
    // k < 63 covers [2^k - 1, 2^(k+1) - 1) microseconds;
    // bucket 63 covers [2^63 - 1, infinity) microseconds.
    std::array<uint64_t, 64> latency_histogram{};
};

/**
 * @brief Thread-safe bounded circular buffer for I/O requests.
 *
 * Synchronization Invariant:
 * The buffer's internal state (count_, head_, tail_, ring_buffer_, closed_,
 * and occupancy metrics) is strictly protected by mutex_.
 * Threads must hold a std::unique_lock<std::mutex> on mutex_ before accessing
 * or mutating any of these members.
 *
 * Blocking Behavior:
 * - Producers block on not_full_ when count_ == capacity_ (until space is freed or closed).
 * - Consumers block on not_empty_ when count_ == 0 (until an item arrives or closed).
 *
 * Shutdown Semantics:
 * Calling close() sets closed_ = true and notifies all waiting producers and consumers.
 * - Enqueue attempts after close are rejected (returns false).
 * - Dequeue attempts after close continue draining enqueued items until count_ == 0,
 *   at which point pop() returns false to signal end-of-stream.
 */
class BoundedBuffer {
public:
    explicit BoundedBuffer(size_t capacity);
    ~BoundedBuffer();

    // Non-copyable, non-movable synchronization primitive
    BoundedBuffer(const BoundedBuffer&) = delete;
    BoundedBuffer& operator=(const BoundedBuffer&) = delete;
    BoundedBuffer(BoundedBuffer&&) = delete;
    BoundedBuffer& operator=(BoundedBuffer&&) = delete;

    /**
     * @brief Enqueue a request into the buffer.
     * Blocks if the buffer is full until space becomes available or the buffer is closed.
     * @param req The request to enqueue (moved in).
     * @param wait_duration Optional pointer to receive duration spent blocked (ns).
     * @return true if successfully inserted, false if buffer was closed/rejected.
     */
    bool push(Request req, std::chrono::nanoseconds* wait_duration = nullptr);

    /**
     * @brief Dequeue a request from the buffer.
     * Blocks if the buffer is empty until an item is enqueued or the buffer is closed.
     * @param out_req Destination reference for the dequeued request.
     * @return true if an item was dequeued, false if buffer is closed and empty.
     */
    bool pop(Request& out_req);

    /**
     * @brief Close the buffer, unblocking all waiting producers and consumers.
     */
    void close();

    // State inspection
    bool isClosed() const;
    size_t size() const;
    size_t capacity() const;
    bool isEmpty() const;
    bool isFull() const;

    // Metrics & Telemetry
    // Safe live cumulative snapshot; never reads worker-owned counters.
    BufferObservation observe() const;
    void recordCompletion(size_t bytes, double latency_ms);
    size_t getMaxOccupancy() const;
    double getAverageOccupancy() const;
    double getAverageCapacity() const;
    double getMaxOccupancyPct() const;
    std::chrono::nanoseconds getTotalProducerWaitTime() const;

private:
    friend class RuntimeResizeExecutor;
    const void* resize_owner_{nullptr};
    void updateOccupancyStatsUnderLock();
    void updateWaitStatsUnderLock();

    size_t capacity_;
    std::vector<Request> ring_buffer_;
    size_t head_{0};
    size_t tail_{0};
    size_t count_{0};
    bool closed_{false};

    mutable std::mutex mutex_;
    std::condition_variable not_full_;
    std::condition_variable not_empty_;

    BufferObservation observation_{};
    size_t waiting_producers_{0}, waiting_consumers_{0};
    std::chrono::steady_clock::time_point last_wait_time_{std::chrono::steady_clock::now()};
    uint64_t producer_wait_ns_{0}, consumer_wait_ns_{0};

    // Performance telemetry
    std::chrono::nanoseconds total_producer_wait_{0};
    size_t max_occupancy_{0};
    double max_occupancy_pct_{0.0};
    double cumulative_capacity_ns_{0.0};
    std::chrono::steady_clock::time_point start_time_;
    std::chrono::steady_clock::time_point last_occupancy_time_;
    std::chrono::nanoseconds cumulative_occupancy_ns_{0};
};

#endif // ADAPTIVE_IO_BOUNDED_BUFFER_H
