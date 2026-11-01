#ifndef ADAPTIVE_IO_METRICS_ENGINE_H
#define ADAPTIVE_IO_METRICS_ENGINE_H
#include "StreamManager.h"
#include <functional>
#include <deque>
#include <condition_variable>
#include <thread>
#include <exception>
struct MetricsConfig { size_t interval_ms{100}; size_t window_ms{1000}; };
struct StreamObservation {
    uint32_t stream_id{0};
    BufferObservation totals{};
    double throughput_req_per_sec{0}, throughput_mb_per_sec{0}, avg_latency_ms{0};
    double avg_occupancy_slots{0}, utilization_pct{0};
    double producer_wait_ms{0}, consumer_wait_ms{0};
    double p50_latency_upper_ms{0}, p95_latency_upper_ms{0};
};
struct MetricsSnapshot {
    uint64_t sequence{0};
    double elapsed_ms{0}, window_ms{0};
    bool final_sample{false};
    std::vector<StreamObservation> streams;
    StreamObservation global;
    std::string toJson() const;
};
class MetricsEngine {
public:
    using Callback = std::function<void(const MetricsSnapshot&)>;
    MetricsEngine(StreamManager& manager, MetricsConfig config = {}, Callback callback = {});
    ~MetricsEngine();
    void start();
    void stop();
    MetricsSnapshot latest() const;
private:
    void collect(bool final_sample);
    StreamManager& manager_;
    MetricsConfig config_;
    Callback callback_;
    std::chrono::steady_clock::time_point epoch_;
    mutable std::mutex mutex_;
    std::condition_variable cv_;
    std::thread thread_;
    bool stopping_{false}, started_{false}, finished_{false};
    std::exception_ptr failure_;
    MetricsSnapshot latest_;
    std::deque<MetricsSnapshot> history_;
};
#endif
