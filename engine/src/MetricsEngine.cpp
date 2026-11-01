#include "MetricsEngine.h"
#include <stdexcept>
#include <sstream>
#include <iomanip>
#include <cmath>
namespace {
void derive(StreamObservation& out, const BufferObservation& base, double ms) {
    const auto& t = out.totals;
    if (ms <= 0) return;
    const auto completed = t.consumed - base.consumed;
    out.throughput_req_per_sec = completed * 1000.0 / ms;
    out.throughput_mb_per_sec = (t.bytes - base.bytes) * 1000.0 / (ms * 1048576.0);
    auto quantile = [&](double q) {
        if (!completed) return 0.0;
        uint64_t count=0;
        for(size_t k=0;k<64;++k) {
            count += t.latency_histogram[k]-base.latency_histogram[k];
            if(count >= static_cast<uint64_t>(std::ceil(q*completed)))
                return (std::ldexp(1.0,static_cast<int>(k+1))-1.0)/1000.0;
        }
        return 0.0;
    };
    out.p50_latency_upper_ms=quantile(0.50);
    out.p95_latency_upper_ms=quantile(0.95);
    out.avg_latency_ms = completed ? (t.latency_sum_ms - base.latency_sum_ms) / completed : 0;
    out.avg_occupancy_slots = (t.occupancy_ns - base.occupancy_ns) / (ms * 1e6);
    const double capacity_time = t.capacity_ns - base.capacity_ns;
    out.utilization_pct = capacity_time > 0 ? (t.occupancy_ns-base.occupancy_ns)*100/capacity_time : 0;
    out.producer_wait_ms = (t.producer_wait_ns - base.producer_wait_ns) / 1e6;
    out.consumer_wait_ms = (t.consumer_wait_ns - base.consumer_wait_ns) / 1e6;
}
void add(BufferObservation& a, const BufferObservation& b) {
    a.produced+=b.produced; a.consumed+=b.consumed; a.bytes+=b.bytes;
    a.occupancy+=b.occupancy; a.capacity+=b.capacity;
    a.producer_wait_ns+=b.producer_wait_ns; a.consumer_wait_ns+=b.consumer_wait_ns;
    a.full_events+=b.full_events; a.empty_events+=b.empty_events;
    for(size_t k=0;k<64;++k) a.latency_histogram[k]+=b.latency_histogram[k];
    a.capacity_ns+=b.capacity_ns;
    a.occupancy_ns+=b.occupancy_ns; a.latency_sum_ms+=b.latency_sum_ms;
}
void json(std::ostream& s, const StreamObservation& o) {
    s << "{\"stream_id\":" << o.stream_id << ",\"produced\":" << o.totals.produced
      << ",\"consumed\":" << o.totals.consumed << ",\"bytes\":" << o.totals.bytes
      << ",\"occupancy\":" << o.totals.occupancy << ",\"capacity\":" << o.totals.capacity
      << ",\"full_events\":" << o.totals.full_events << ",\"empty_events\":" << o.totals.empty_events
      << ",\"throughput_req_per_sec\":" << o.throughput_req_per_sec
      << ",\"throughput_mb_per_sec\":" << o.throughput_mb_per_sec
      << ",\"avg_latency_ms\":" << o.avg_latency_ms
      << ",\"avg_occupancy_slots\":" << o.avg_occupancy_slots
      << ",\"utilization_pct\":" << o.utilization_pct
      << ",\"producer_wait_ms\":" << o.producer_wait_ms
      << ",\"p50_latency_upper_ms\":" << o.p50_latency_upper_ms
      << ",\"p95_latency_upper_ms\":" << o.p95_latency_upper_ms
      << ",\"consumer_wait_ms\":" << o.consumer_wait_ms << "}";
}
}
std::string MetricsSnapshot::toJson() const {
    std::ostringstream s; s << std::setprecision(12);
    s << "{\"type\":\"metrics_snapshot\",\"sequence\":" << sequence
      << ",\"elapsed_ms\":" << elapsed_ms << ",\"window_ms\":" << window_ms
      << ",\"final_sample\":" << (final_sample ? "true":"false") << ",\"global\":";
    json(s,global); s << ",\"streams\":[";
    for(size_t i=0;i<streams.size();++i) { if(i) s << ','; json(s,streams[i]); }
    s << "]}"; return s.str();
}
MetricsEngine::MetricsEngine(StreamManager& manager, MetricsConfig config, Callback callback)
    : manager_(manager), config_(config), callback_(std::move(callback)) {
    if (!config.interval_ms || config.window_ms < config.interval_ms ||
        config.window_ms / config.interval_ms > 100000 || config.window_ms > 86400000)
        throw std::invalid_argument("Invalid metrics interval/window (maximum window: one day, maximum 100000 intervals)");
}
MetricsEngine::~MetricsEngine() { try { stop(); } catch (...) {} }
MetricsSnapshot MetricsEngine::latest() const { std::lock_guard<std::mutex> lock(mutex_); return latest_; }
void MetricsEngine::collect(bool final_sample) {
    MetricsSnapshot s;
    s.elapsed_ms = std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-epoch_).count();
    s.final_sample = final_sample;
    for(size_t i=0;i<manager_.size();++i) {
        StreamObservation o; o.stream_id=manager_.getStream(i).getId();
        o.totals=manager_.getStream(i).getBuffer().observe();
        add(s.global.totals,o.totals); s.streams.push_back(o);
    }
    {
        std::lock_guard<std::mutex> lock(mutex_);
        s.sequence=latest_.sequence+1;
        // Retain the boundary immediately before the requested cutoff.
        while(history_.size()>1 && history_[1].elapsed_ms <= s.elapsed_ms-config_.window_ms) history_.pop_front();
        if(!history_.empty()) {
            const auto& b=history_.front(); s.window_ms=s.elapsed_ms-b.elapsed_ms;
            for(size_t i=0;i<s.streams.size();++i) derive(s.streams[i],b.streams[i].totals,s.window_ms);
            derive(s.global,b.global.totals,s.window_ms);
        }
        latest_=s; history_.push_back(s);
        const size_t limit=config_.window_ms/config_.interval_ms+3;
        while(history_.size()>limit) history_.pop_front();
    }
    if(callback_ && !failure_) {
        try { callback_(s); } catch (...) { failure_=std::current_exception(); }
    }
}
void MetricsEngine::start() {
    if(started_) return;
    if(finished_) throw std::logic_error("MetricsEngine is single-use");
    started_=true; epoch_=std::chrono::steady_clock::now(); collect(false);
    thread_=std::thread([this] {
        std::unique_lock<std::mutex> lock(mutex_);
        while(!cv_.wait_for(lock,std::chrono::milliseconds(config_.interval_ms),[this]{return stopping_;})) {
            lock.unlock();
            try { collect(false); } catch (...) { failure_=std::current_exception(); }
            lock.lock();
            if(failure_) break;
        }
    });
}
void MetricsEngine::stop() {
    if(!started_) return;
    { std::lock_guard<std::mutex> lock(mutex_); stopping_=true; }
    cv_.notify_all(); if(thread_.joinable()) thread_.join();
    started_=false; finished_=true;
    collect(true);
    if(failure_) std::rethrow_exception(failure_);
}
