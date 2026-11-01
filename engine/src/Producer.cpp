#include "Producer.h"
#include <thread>
#include <utility>

namespace {

WorkloadConfig createDefaultConfig(uint32_t interval_ms,
                                   size_t min_payload_bytes,
                                   size_t max_payload_bytes,
                                   uint32_t random_seed,
                                   uint32_t stream_id) {
    WorkloadConfig wc;
    wc.type = WorkloadType::STEADY;
    wc.base_interval_ms = interval_ms;
    wc.min_payload_bytes = min_payload_bytes;
    wc.max_payload_bytes = std::max(min_payload_bytes, max_payload_bytes);
    wc.seed = random_seed;
    wc.stream_id = stream_id;
    return wc;
}

} // anonymous namespace

Producer::Producer(BoundedBuffer& buffer,
                   size_t num_requests,
                   uint32_t interval_ms,
                   size_t min_payload_bytes,
                   size_t max_payload_bytes,
                   uint32_t random_seed,
                   uint32_t stream_id)
    : buffer_(buffer),
      num_requests_(num_requests),
      stream_id_(stream_id),
      workload_gen_(createDefaultConfig(interval_ms, min_payload_bytes, max_payload_bytes, random_seed, stream_id)) {}

Producer::Producer(BoundedBuffer& buffer,
                   size_t num_requests,
                   WorkloadConfig workload_config)
    : buffer_(buffer),
      num_requests_(num_requests),
      stream_id_(workload_config.stream_id),
      workload_gen_(std::move(workload_config)) {}

void Producer::run() {
    for (size_t i = 1; i <= num_requests_; ++i) {
        if (buffer_.isClosed()) {
            break;
        }

        const WorkloadRequest w_req = workload_gen_.getNextRequest(i - 1);

        // Simulate inter-arrival spacing between successive requests
        if (w_req.inter_arrival_ms > 0 && i > 1) {
            std::this_thread::sleep_for(std::chrono::milliseconds(w_req.inter_arrival_ms));
        }

        Request req(i, w_req.payload_bytes, stream_id_);
        req.recordCreation();
        req.recordEnqueue();

        std::chrono::nanoseconds wait_time{0};
        const bool pushed = buffer_.push(std::move(req), &wait_time);

        if (!pushed) {
            // Buffer closed or shutdown initiated
            break;
        }

        updateWorkloadFingerprint(workload_fingerprint_,w_req);
        total_blocked_time_ += wait_time;
        produced_count_++;
        total_bytes_produced_ += w_req.payload_bytes;
    }
}
