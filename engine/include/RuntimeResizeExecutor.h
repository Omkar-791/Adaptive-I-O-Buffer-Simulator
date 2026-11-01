#ifndef ADAPTIVE_IO_RUNTIME_RESIZE_EXECUTOR_H
#define ADAPTIVE_IO_RUNTIME_RESIZE_EXECUTOR_H
#include "AdaptiveController.h"
#include "BoundedBuffer.h"
struct BufferBinding {
    uint32_t stream_id;
    BoundedBuffer* buffer;
    size_t min_capacity{1}, max_capacity{64};
};
struct StreamResizeResult {
    uint32_t stream_id;
    size_t previous_capacity, requested_capacity, actual_capacity;
};
struct ResizeResult {
    bool success{false}, deferred{false}, stale{false};
    uint64_t snapshot_sequence{0};
    std::string reason;
    std::vector<StreamResizeResult> streams;
    std::string toJson() const;
};
// RM and buffers must outlive this object; no concurrent destruction/apply.
class RuntimeResizeExecutor {
public:
    RuntimeResizeExecutor(BufferResourceManager&, std::vector<BufferBinding>);
    ~RuntimeResizeExecutor();
    RuntimeResizeExecutor(const RuntimeResizeExecutor&) = delete;
    RuntimeResizeExecutor& operator=(const RuntimeResizeExecutor&) = delete;
    ResizeResult apply(const AllocationDecision&);
private:
    BufferResourceManager& manager_;
    std::vector<BufferBinding> bindings_;
};
#endif
