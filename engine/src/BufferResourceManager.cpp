#include "BufferResourceManager.h"
#include <stdexcept>
#include <algorithm>

BufferResourceManager::BufferResourceManager(size_t total_budget, size_t min_capacity)
    : total_budget_(total_budget),
      min_capacity_(min_capacity) {
    if (total_budget_ == 0) {
        throw std::invalid_argument("BufferResourceManager: total_budget must be greater than 0");
    }
    if (min_capacity_ == 0) {
        throw std::invalid_argument("BufferResourceManager: min_capacity must be greater than 0");
    }
}

size_t BufferResourceManager::getTotalBudget() const noexcept {
    return total_budget_;
}

size_t BufferResourceManager::getMinCapacity() const noexcept {
    return min_capacity_;
}

size_t BufferResourceManager::getTotalAllocated() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return total_allocated_;
}

size_t BufferResourceManager::getFreeBudget() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return (total_allocated_ <= total_budget_) ? (total_budget_ - total_allocated_) : 0;
}

bool BufferResourceManager::isBudgetExceeded() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return total_allocated_ > total_budget_;
}

std::vector<size_t> BufferResourceManager::allocateEqual(size_t num_streams) const {
    if (num_streams == 0) {
        throw std::invalid_argument("allocateEqual: num_streams must be greater than 0");
    }

    const size_t min_required = num_streams * min_capacity_;
    if (total_budget_ < min_required) {
        throw std::invalid_argument(
            "allocateEqual: Total buffer budget (" + std::to_string(total_budget_) +
            ") is insufficient for " + std::to_string(num_streams) +
            " streams with minimum capacity " + std::to_string(min_capacity_) +
            " (requires at least " + std::to_string(min_required) + " slots)");
    }

    std::vector<size_t> capacities(num_streams);
    const size_t base = total_budget_ / num_streams;
    const size_t remainder = total_budget_ % num_streams;

    for (size_t i = 0; i < num_streams; ++i) {
        capacities[i] = (i < remainder) ? (base + 1) : base;
    }

    return capacities;
}

bool BufferResourceManager::registerStream(uint32_t stream_id, size_t capacity, std::string* error_msg) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (resize_owner_) { if (error_msg) *error_msg="Runtime executor owns allocation changes"; return false; }

    if (capacity < min_capacity_) {
        if (error_msg) {
            *error_msg = "Requested capacity (" + std::to_string(capacity) +
                         ") is below minimum capacity (" + std::to_string(min_capacity_) + ")";
        }
        return false;
    }

    auto it = allocations_.find(stream_id);
    const size_t current_capacity = (it != allocations_.end()) ? it->second : 0;
    const size_t new_total = total_allocated_ - current_capacity + capacity;

    if (new_total > total_budget_) {
        if (error_msg) {
            *error_msg = "Allocating " + std::to_string(capacity) + " slots to stream " +
                         std::to_string(stream_id) + " would exceed total budget (new total: " +
                         std::to_string(new_total) + ", budget: " + std::to_string(total_budget_) + ")";
        }
        return false;
    }

    allocations_[stream_id] = capacity;
    total_allocated_ = new_total;
    return true;
}

bool BufferResourceManager::unregisterStream(uint32_t stream_id) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (resize_owner_) return false;
    auto it = allocations_.find(stream_id);
    if (it == allocations_.end()) {
        return false;
    }
    total_allocated_ -= it->second;
    allocations_.erase(it);
    return true;
}

bool BufferResourceManager::hasStream(uint32_t stream_id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    return allocations_.find(stream_id) != allocations_.end();
}

size_t BufferResourceManager::getStreamCapacity(uint32_t stream_id) const {
    std::lock_guard<std::mutex> lock(mutex_);
    auto it = allocations_.find(stream_id);
    return (it != allocations_.end()) ? it->second : 0;
}

std::vector<StreamAllocation> BufferResourceManager::getAllocations() const {
    std::lock_guard<std::mutex> lock(mutex_);
    std::vector<StreamAllocation> result;
    result.reserve(allocations_.size());
    for (const auto& pair : allocations_) {
        result.push_back({pair.first, pair.second});
    }
    return result;
}

size_t BufferResourceManager::getStreamCount() const {
    std::lock_guard<std::mutex> lock(mutex_);
    return allocations_.size();
}

bool BufferResourceManager::canResize(uint32_t stream_id, size_t new_capacity, std::string* error_msg) const {
    std::lock_guard<std::mutex> lock(mutex_);

    if (new_capacity < min_capacity_) {
        if (error_msg) {
            *error_msg = "New capacity (" + std::to_string(new_capacity) +
                         ") is below minimum capacity (" + std::to_string(min_capacity_) + ")";
        }
        return false;
    }

    auto it = allocations_.find(stream_id);
    if (it == allocations_.end()) {
        if (error_msg) {
            *error_msg = "Stream " + std::to_string(stream_id) + " is not registered";
        }
        return false;
    }

    const size_t current_capacity = it->second;
    const size_t new_total = total_allocated_ - current_capacity + new_capacity;

    if (new_total > total_budget_) {
        if (error_msg) {
            *error_msg = "Resizing stream " + std::to_string(stream_id) + " to " +
                         std::to_string(new_capacity) + " would exceed total budget (" +
                         std::to_string(new_total) + " > " + std::to_string(total_budget_) + ")";
        }
        return false;
    }

    return true;
}

bool BufferResourceManager::requestResize(uint32_t stream_id, size_t new_capacity, std::string* error_msg) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (resize_owner_) { if (error_msg) *error_msg="Runtime executor owns allocation changes"; return false; }

    if (new_capacity < min_capacity_) {
        if (error_msg) {
            *error_msg = "New capacity (" + std::to_string(new_capacity) +
                         ") is below minimum capacity (" + std::to_string(min_capacity_) + ")";
        }
        return false;
    }

    auto it = allocations_.find(stream_id);
    if (it == allocations_.end()) {
        if (error_msg) {
            *error_msg = "Stream " + std::to_string(stream_id) + " is not registered";
        }
        return false;
    }

    const size_t current_capacity = it->second;
    const size_t new_total = total_allocated_ - current_capacity + new_capacity;

    if (new_total > total_budget_) {
        if (error_msg) {
            *error_msg = "Resizing stream " + std::to_string(stream_id) + " to " +
                         std::to_string(new_capacity) + " would exceed total budget (" +
                         std::to_string(new_total) + " > " + std::to_string(total_budget_) + ")";
        }
        return false;
    }

    it->second = new_capacity;
    total_allocated_ = new_total;
    return true;
}

bool BufferResourceManager::reallocate(uint32_t from_stream_id, uint32_t to_stream_id, size_t delta, std::string* error_msg) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (resize_owner_) { if (error_msg) *error_msg="Runtime executor owns allocation changes"; return false; }

    if (delta == 0) {
        return true;
    }

    auto from_it = allocations_.find(from_stream_id);
    if (from_it == allocations_.end()) {
        if (error_msg) {
            *error_msg = "Source stream " + std::to_string(from_stream_id) + " not registered";
        }
        return false;
    }

    auto to_it = allocations_.find(to_stream_id);
    if (to_it == allocations_.end()) {
        if (error_msg) {
            *error_msg = "Destination stream " + std::to_string(to_stream_id) + " not registered";
        }
        return false;
    }

    if (from_it->second < min_capacity_ + delta) {
        if (error_msg) {
            *error_msg = "Cannot deduct " + std::to_string(delta) + " from stream " +
                         std::to_string(from_stream_id) + " (current: " + std::to_string(from_it->second) +
                         ", minimum: " + std::to_string(min_capacity_) + ")";
        }
        return false;
    }

    from_it->second -= delta;
    to_it->second += delta;
    // Total allocated remains unchanged, invariant guaranteed
    return true;
}

void BufferResourceManager::reset() {
    std::lock_guard<std::mutex> lock(mutex_);
    if (resize_owner_) throw std::logic_error("Runtime executor owns allocation changes");
    allocations_.clear();
    total_allocated_ = 0;
}
