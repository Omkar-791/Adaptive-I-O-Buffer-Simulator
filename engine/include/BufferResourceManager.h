#ifndef ADAPTIVE_IO_BUFFER_RESOURCE_MANAGER_H
#define ADAPTIVE_IO_BUFFER_RESOURCE_MANAGER_H

#include <cstddef>
#include <cstdint>
#include <vector>
#include <map>
#include <mutex>
#include <string>
#include <memory>

/**
 * @brief Represents an individual stream's capacity allocation.
 */
struct StreamAllocation {
    uint32_t stream_id{0};
    size_t capacity{0};
};

/**
 * @brief Manages the shared global buffer budget across all concurrent I/O streams.
 *
 * Invariants:
 *   1. sum(capacity[i]) <= total_budget_
 *   2. capacity[i] >= min_capacity_ for all registered streams
 *
 * Thread-safety:
 *   All methods are protected by an internal mutex to ensure thread-safe
 *   queries, allocations, and future dynamic reallocations.
 */
class BufferResourceManager {
public:
    /**
     * @brief Constructs a resource manager with a fixed global buffer budget.
     * @param total_budget Maximum total slots allocatable across all streams.
     * @param min_capacity Minimum legal capacity per stream (must be >= 1).
     * @throws std::invalid_argument if total_budget == 0 or min_capacity == 0.
     */
    explicit BufferResourceManager(size_t total_budget, size_t min_capacity = 1);
    ~BufferResourceManager() = default;

    // Non-copyable, non-movable resource owner
    BufferResourceManager(const BufferResourceManager&) = delete;
    BufferResourceManager& operator=(const BufferResourceManager&) = delete;
    BufferResourceManager(BufferResourceManager&&) = delete;
    BufferResourceManager& operator=(BufferResourceManager&&) = delete;

    // Budget Inspection
    size_t getTotalBudget() const noexcept;
    size_t getMinCapacity() const noexcept;
    size_t getTotalAllocated() const;
    size_t getFreeBudget() const;
    bool isBudgetExceeded() const;

    // Initial Allocation Strategies
    /**
     * @brief Computes initial allocation for num_streams using equal distribution with remainder.
     *
     * Remainder Allocation Rule:
     *   base = total_budget / num_streams
     *   remainder = total_budget % num_streams
     *   Streams 0 .. (remainder - 1) receive (base + 1) slots.
     *   Streams remainder .. (num_streams - 1) receive base slots.
     *
     * @param num_streams Number of streams to allocate capacity for.
     * @return Vector of allocated capacities for stream indices 0 .. num_streams - 1.
     * @throws std::invalid_argument if num_streams == 0 or total_budget < num_streams * min_capacity.
     */
    std::vector<size_t> allocateEqual(size_t num_streams) const;

    // Stream Registration and Tracking
    /**
     * @brief Registers an initial capacity for a stream under the global budget.
     * @param stream_id Unique stream identifier.
     * @param capacity Capacity to allocate.
     * @param error_msg Optional pointer to receive failure details.
     * @return true if registered successfully, false on violation.
     */
    bool registerStream(uint32_t stream_id, size_t capacity, std::string* error_msg = nullptr);

    /**
     * @brief Unregisters a stream, releasing its allocated capacity back to the global budget.
     * @param stream_id Unique stream identifier.
     * @return true if stream was found and removed, false otherwise.
     */
    bool unregisterStream(uint32_t stream_id);

    bool hasStream(uint32_t stream_id) const;
    size_t getStreamCapacity(uint32_t stream_id) const;
    std::vector<StreamAllocation> getAllocations() const;
    size_t getStreamCount() const;

    // Phase 6 Interface Preparation: Dynamic Resizing & Reallocation Hooks
    /**
     * @brief Validates whether a proposed stream capacity change is legal under global budget.
     */
    bool canResize(uint32_t stream_id, size_t new_capacity, std::string* error_msg = nullptr) const;

    /**
     * @brief Adjusts the recorded capacity for a stream if valid under the global budget.
     * Updates internal resource accounting.
     */
    bool requestResize(uint32_t stream_id, size_t new_capacity, std::string* error_msg = nullptr);

    /**
     * @brief Reallocates capacity from one stream to another.
     * Validates that from_stream capacity remains >= min_capacity and total budget is preserved.
     */
    bool reallocate(uint32_t from_stream_id, uint32_t to_stream_id, size_t delta, std::string* error_msg = nullptr);

    /**
     * @brief Clears all stream registrations, resetting allocated capacity to zero.
     */
    void reset();

private:
    friend class RuntimeResizeExecutor;
    const void* resize_owner_{nullptr};
    uint64_t last_resize_sequence_{0};
    const size_t total_budget_;
    const size_t min_capacity_;

    mutable std::mutex mutex_;
    std::map<uint32_t, size_t> allocations_; // stream_id -> allocated capacity
    size_t total_allocated_{0};
};

#endif // ADAPTIVE_IO_BUFFER_RESOURCE_MANAGER_H
