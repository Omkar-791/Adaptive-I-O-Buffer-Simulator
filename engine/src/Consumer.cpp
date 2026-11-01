#include "Consumer.h"
#include <thread>
#include <algorithm>

Consumer::Consumer(BoundedBuffer& buffer, uint32_t processing_time_ms, uint32_t stream_id)
    : buffer_(buffer),
      processing_time_ms_(processing_time_ms),
      stream_id_(stream_id) {}

void Consumer::run() {
    Request req;
    while (buffer_.pop(req)) {
        req.recordDequeue();

        // Simulate device hardware processing latency
        if (processing_time_ms_ > 0) {
            std::this_thread::sleep_for(std::chrono::milliseconds(processing_time_ms_));
        }

        req.recordCompletion();

        const double latency = req.getTotalLatencyMs();
        buffer_.recordCompletion(req.getPayloadBytes(), latency);
        total_latency_ms_ += latency;

        if (consumed_count_ == 0) {
            min_latency_ms_ = latency;
            max_latency_ms_ = latency;
        } else {
            min_latency_ms_ = std::min(min_latency_ms_, latency);
            max_latency_ms_ = std::max(max_latency_ms_, latency);
        }

        // Bounded recent sample ring; cumulative aggregates above retain all requests.
        // getLatencies() retains its vector API; after wrap, order is ring order.
        constexpr size_t max_latency_samples = 4096;
        if (latencies_.size() < max_latency_samples) {
            latencies_.push_back(latency);
        } else {
            latencies_[consumed_count_ % max_latency_samples] = latency;
        }
        consumed_count_++;
        total_bytes_consumed_ += req.getPayloadBytes();
    }
}
