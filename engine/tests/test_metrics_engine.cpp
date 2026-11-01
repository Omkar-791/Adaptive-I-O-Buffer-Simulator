#include "MetricsEngine.h"
#include "Simulation.h"
#include <cassert>
#include <cmath>
#include <iostream>
#include <thread>
#include <atomic>
#include <stdexcept>

namespace {
void controlled_metric_math() {
    StreamManager manager;
    IOStreamConfig config;
    config.num_requests = 0;
    auto& buffer = manager.addStream(config).getBuffer();
    MetricsEngine engine(manager, MetricsConfig{100, 1000});
    engine.start();
    for (size_t i = 1; i <= 3; ++i) {
        assert(buffer.push(Request(i, i * 100)));
        Request request;
        assert(buffer.pop(request));
        buffer.recordCompletion(request.getPayloadBytes(), static_cast<double>(i * 2));
    }
    engine.stop();
    const auto sample = engine.latest();
    assert(sample.window_ms > 0);
    assert(sample.global.totals.produced == 3);
    assert(sample.global.totals.consumed == 3);
    assert(sample.global.totals.bytes == 600);
    assert(std::abs(sample.global.avg_latency_ms - 4.0) < 1e-9);
    assert(std::abs(sample.global.p50_latency_upper_ms - 4.095) < 1e-9);
    assert(std::abs(sample.global.p95_latency_upper_ms - 8.191) < 1e-9);
    assert(std::abs(sample.global.throughput_req_per_sec - 3000.0 / sample.window_ms) < 1e-6);
    assert(std::abs(sample.global.throughput_mb_per_sec -
                    600000.0 / (sample.window_ms * 1048576.0)) < 1e-9);
    assert(sample.global.avg_occupancy_slots >= 0);
    assert(sample.global.utilization_pct >= 0);
    assert(sample.toJson().find("\"type\":\"metrics_snapshot\"") != std::string::npos);
}

void invalid_configuration() {
    StreamManager manager;
    for (const MetricsConfig config : {MetricsConfig{0, 100}, MetricsConfig{100, 10},
                                       MetricsConfig{1, 100002}}) {
        bool rejected = false;
        try { MetricsEngine engine(manager, config); }
        catch (const std::invalid_argument&) { rejected = true; }
        assert(rejected);
    }
}

void empty_and_short_runs() {
    StreamManager manager;
    MetricsEngine engine(manager, MetricsConfig{10, 30});
    engine.start();
    engine.stop();
    const auto final = engine.latest();
    assert(final.final_sample);
    assert(final.streams.empty());
    assert(final.global.totals.consumed == 0);
    assert(std::isfinite(final.global.throughput_req_per_sec));
    engine.stop(); // Idempotent shutdown.
    bool restart_rejected = false;
    try { engine.start(); } catch (const std::logic_error&) { restart_rejected = true; }
    assert(restart_rejected);

    SimulationConfig config;
    config.num_requests = 0;
    Simulation simulation(config);
    simulation.setMetricsConfig(MetricsConfig{10, 30});
    const auto result = simulation.run();
    assert(result.total_produced == 0 && result.total_consumed == 0);
    assert(simulation.latestMetrics().final_sample);
}

void callback_errors_are_reported_after_shutdown() {
    for (const bool initial_failure : {true, false}) {
        StreamManager manager;
        std::atomic<size_t> calls{0};
        MetricsEngine engine(manager, MetricsConfig{5, 20}, [&](const MetricsSnapshot& sample) {
            ++calls;
            if (initial_failure || sample.sequence > 1) throw std::runtime_error("callback failed");
        });
        engine.start();
        if (!initial_failure) {
            const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
            while (calls.load() < 2 && std::chrono::steady_clock::now() < deadline)
                std::this_thread::sleep_for(std::chrono::milliseconds(1));
            assert(calls.load() >= 2);
        }
        bool propagated = false;
        try { engine.stop(); }
        catch (const std::runtime_error& error) { propagated = std::string(error.what()) == "callback failed"; }
        assert(propagated);
        assert(engine.latest().final_sample);
        engine.stop();
    }
}

void concurrent_totals_and_periodic_sampling() {
    SimulationConfig config;
    config.num_streams = 3;
    config.buffer_capacity = 2;
    config.num_requests = 25;
    config.producer_interval_ms = 0;
    config.consumer_processing_ms = 3;
    config.min_payload_bytes = config.max_payload_bytes = 100;
    Simulation simulation(config);
    simulation.setMetricsConfig(MetricsConfig{5, 20});
    size_t periodic = 0;
    uint64_t previous_sequence = 0;
    double previous_time = 0;
    simulation.setMetricsCallback([&](const MetricsSnapshot& sample) {
        assert(sample.sequence > previous_sequence);
        assert(sample.elapsed_ms >= previous_time);
        previous_sequence = sample.sequence;
        previous_time = sample.elapsed_ms;
        if (!sample.final_sample && sample.elapsed_ms > 0) ++periodic;
        for (const auto& stream : sample.streams) {
            assert(stream.totals.occupancy <= stream.totals.capacity);
            assert(stream.totals.consumed <= stream.totals.produced);
            assert(stream.avg_latency_ms >= 0);
            assert(std::isfinite(stream.throughput_req_per_sec));
        }
    });
    const auto result = simulation.run();
    const auto final = simulation.latestMetrics();
    assert(result.success);
    assert(periodic > 0);
    assert(final.final_sample && final.streams.size() == 3);
    assert(final.global.totals.produced == 75);
    assert(final.global.totals.consumed == 75);
    assert(final.global.totals.bytes == 7500);
    size_t consumed = 0;
    for (const auto& stream : final.streams) {
        consumed += stream.totals.consumed;
        assert(stream.totals.occupancy == 0);
        assert(stream.totals.producer_wait_ns > 0);
        assert(stream.totals.full_events > 0);
    }
    assert(consumed == final.global.totals.consumed);
}

void sliding_window_expires_and_readers_are_safe() {
    StreamManager manager;
    IOStreamConfig config;
    config.num_requests = 20;
    config.producer_interval_ms = 0;
    config.consumer_processing_ms = 1;
    config.min_payload_bytes = config.max_payload_bytes = 64;
    manager.addStream(config);
    MetricsEngine engine(manager, MetricsConfig{5, 20});
    engine.start();
    std::atomic<bool> done{false};
    std::thread reader([&] {
        while (!done.load()) {
            const auto current = engine.latest();
            assert(std::isfinite(current.global.throughput_req_per_sec));
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
    });
    manager.startAll();
    manager.joinAll();
    // Keep sampling after completion: old work must leave the sliding window.
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
    bool expired = false;
    do {
        std::this_thread::sleep_for(std::chrono::milliseconds(10));
        const auto current = engine.latest();
        expired = current.global.totals.consumed == 20 &&
                  current.global.throughput_req_per_sec == 0;
    } while (!expired && std::chrono::steady_clock::now() < deadline);
    done = true;
    reader.join();
    engine.stop();
    assert(expired);
    const auto final = engine.latest();
    assert(final.global.totals.bytes == 1280);
    assert(final.global.throughput_req_per_sec == 0);
    assert(final.global.avg_latency_ms == 0);
    assert(final.global.p50_latency_upper_ms == 0);
    assert(final.global.p95_latency_upper_ms == 0);
    assert(final.final_sample);
}
}

int main() {
    controlled_metric_math();
    callback_errors_are_reported_after_shutdown();
    invalid_configuration();
    empty_and_short_runs();
    concurrent_totals_and_periodic_sampling();
    sliding_window_expires_and_readers_are_safe();
    std::cout << "ALL 6 METRICS ENGINE TEST GROUPS PASSED!\n";
}
