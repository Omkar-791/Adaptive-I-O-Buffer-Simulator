#include "BoundedBuffer.h"
#include <algorithm>

BoundedBuffer::BoundedBuffer(size_t capacity)
    : capacity_(std::max<size_t>(1, capacity)),
      ring_buffer_(capacity_),
      start_time_(std::chrono::steady_clock::now()),
      last_occupancy_time_(start_time_) {}

BoundedBuffer::~BoundedBuffer() {
    close();
}

bool BoundedBuffer::push(Request req, std::chrono::nanoseconds* wait_duration) {
    std::unique_lock<std::mutex> lock(mutex_);

    const auto wait_start = std::chrono::steady_clock::now();
    bool waited = false;

    // Predicate: wait while buffer is full and not closed
    while (count_ == capacity_ && !closed_) {
        if (!waited) {
            updateWaitStatsUnderLock();
            ++waiting_producers_;
            ++observation_.full_events;
        }
        waited = true;
        not_full_.wait(lock);
    }

    if (waited) {
        updateWaitStatsUnderLock();
        --waiting_producers_;
        const auto wait_end = std::chrono::steady_clock::now();
        const auto blocked_ns = std::chrono::duration_cast<std::chrono::nanoseconds>(wait_end - wait_start);
        total_producer_wait_ += blocked_ns;
        if (wait_duration != nullptr) {
            *wait_duration = blocked_ns;
        }
    } else if (wait_duration != nullptr) {
        *wait_duration = std::chrono::nanoseconds{0};
    }

    // Rejection on closed buffer
    if (closed_) {
        return false;
    }

    updateOccupancyStatsUnderLock();

    req.recordEnqueue();
    ring_buffer_[tail_] = std::move(req);
    tail_ = (tail_ + 1) % capacity_;
    count_++;
    ++observation_.produced;

    if (count_ > max_occupancy_) {
        max_occupancy_ = count_;
    }

    max_occupancy_pct_ = std::max(max_occupancy_pct_, count_ * 100.0 / capacity_);

    // Notify waiting consumer
    not_empty_.notify_one();
    return true;
}

bool BoundedBuffer::pop(Request& out_req) {
    std::unique_lock<std::mutex> lock(mutex_);

    bool waited = false;
    // Predicate: wait while buffer is empty and not closed
    while (count_ == 0 && !closed_) {
        if (!waited) {
            updateWaitStatsUnderLock();
            ++waiting_consumers_;
            ++observation_.empty_events;
            waited = true;
        }
        not_empty_.wait(lock);
    }

    if (waited) {
        updateWaitStatsUnderLock();
        --waiting_consumers_;
    }

    // Buffer closed and drained
    if (count_ == 0 && closed_) {
        return false;
    }

    updateOccupancyStatsUnderLock();

    out_req = std::move(ring_buffer_[head_]);
    head_ = (head_ + 1) % capacity_;
    count_--;

    // Notify waiting producer
    not_full_.notify_one();
    return true;
}

void BoundedBuffer::close() {
    {
        std::lock_guard<std::mutex> lock(mutex_);
        if (closed_) {
            return;
        }
        updateOccupancyStatsUnderLock();
        closed_ = true;
    }
    // Wake up all blocked threads so they can evaluate the closed state
    not_full_.notify_all();
    not_empty_.notify_all();
}

bool BoundedBuffer::isClosed() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return closed_;
}

size_t BoundedBuffer::size() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return count_;
}

size_t BoundedBuffer::capacity() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return capacity_;
}

bool BoundedBuffer::isEmpty() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return count_ == 0;
}

bool BoundedBuffer::isFull() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return count_ == capacity_;
}

size_t BoundedBuffer::getMaxOccupancy() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return max_occupancy_;
}

double BoundedBuffer::getAverageOccupancy() const {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto now = std::chrono::steady_clock::now();
    const auto total_elapsed = std::chrono::duration_cast<std::chrono::nanoseconds>(now - start_time_);
    if (total_elapsed.count() <= 0) {
        return 0.0;
    }

    const auto delta = std::chrono::duration_cast<std::chrono::nanoseconds>(now - last_occupancy_time_);
    const auto current_cumulative = cumulative_occupancy_ns_ + (count_ * delta);

    return static_cast<double>(current_cumulative.count()) / static_cast<double>(total_elapsed.count());
}

std::chrono::nanoseconds BoundedBuffer::getTotalProducerWaitTime() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return total_producer_wait_;
}

void BoundedBuffer::updateOccupancyStatsUnderLock() {
    const auto now = std::chrono::steady_clock::now();
    const auto delta = std::chrono::duration_cast<std::chrono::nanoseconds>(now - last_occupancy_time_);
    cumulative_occupancy_ns_ += count_ * delta;
    cumulative_capacity_ns_ += static_cast<double>(capacity_) * static_cast<double>(delta.count());
    last_occupancy_time_ = now;
}

void BoundedBuffer::updateWaitStatsUnderLock() {
    const auto now = std::chrono::steady_clock::now();
    const auto delta = static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(now - last_wait_time_).count());
    producer_wait_ns_ += waiting_producers_ * delta;
    consumer_wait_ns_ += waiting_consumers_ * delta;
    last_wait_time_ = now;
}

BufferObservation BoundedBuffer::observe() const {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto now = std::chrono::steady_clock::now();
    const auto wait_delta = static_cast<uint64_t>(std::chrono::duration_cast<std::chrono::nanoseconds>(now - last_wait_time_).count());
    auto result = observation_;
    result.occupancy = count_;
    result.capacity = capacity_;
    result.producer_wait_ns = producer_wait_ns_ + waiting_producers_ * wait_delta;
    result.consumer_wait_ns = consumer_wait_ns_ + waiting_consumers_ * wait_delta;
    result.occupancy_ns = static_cast<double>(cumulative_occupancy_ns_.count()) +
        static_cast<double>(count_) * std::chrono::duration<double, std::nano>(now - last_occupancy_time_).count();
    result.capacity_ns = cumulative_capacity_ns_ + static_cast<double>(capacity_) *
        std::chrono::duration<double, std::nano>(now - last_occupancy_time_).count();
    return result;
}

void BoundedBuffer::recordCompletion(size_t bytes, double latency_ms) {
    std::lock_guard<std::mutex> lock(mutex_);
    ++observation_.consumed;
    observation_.bytes += bytes;
    observation_.latency_sum_ms += latency_ms;
    // Compare in floating point to avoid overflow converting large durations.
    double shifted_us = std::max(0.0, latency_ms) * 1000.0 + 1.0;
    size_t bucket = 0;
    while (shifted_us >= 2.0 && bucket < 63) {
        shifted_us *= 0.5;
        ++bucket;
    }
    ++observation_.latency_histogram[bucket];
}


double BoundedBuffer::getAverageCapacity() const {
    std::lock_guard<std::mutex> lock(mutex_);
    const auto now = std::chrono::steady_clock::now();
    const double elapsed = std::chrono::duration<double, std::nano>(now-start_time_).count();
    if (elapsed<=0) return static_cast<double>(capacity_);
    return (cumulative_capacity_ns_ + capacity_ *
        std::chrono::duration<double, std::nano>(now-last_occupancy_time_).count()) / elapsed;
}
double BoundedBuffer::getMaxOccupancyPct() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return max_occupancy_pct_;
}
