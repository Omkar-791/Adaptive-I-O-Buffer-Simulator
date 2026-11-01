#include "Simulation.h"
#include "StreamManager.h"
#include <iostream>
#include <cassert>
#include <vector>

namespace {

void test1_multi_stream_homogeneous() {
    std::cout << "[RUN] TEST 1: Multiple concurrent homogeneous streams (3 streams)..." << std::flush;
    const size_t num_streams = 3;
    const size_t req_per_stream = 150;

    SimulationConfig config;
    config.num_streams = num_streams;
    config.buffer_capacity = 8;
    config.num_requests = req_per_stream;
    config.producer_interval_ms = 0;
    config.consumer_processing_ms = 1;
    config.random_seed = 42;

    Simulation sim(config);
    SimulationMetrics metrics = sim.run();

    assert(metrics.success);
    assert(metrics.stream_count == num_streams);
    assert(metrics.stream_metrics.size() == num_streams);
    assert(metrics.total_produced == num_streams * req_per_stream);
    assert(metrics.total_consumed == num_streams * req_per_stream);

    for (size_t i = 0; i < num_streams; ++i) {
        const auto& sm = metrics.stream_metrics[i];
        assert(sm.stream_id == i);
        assert(sm.total_produced == req_per_stream);
        assert(sm.total_consumed == req_per_stream);
        assert(sm.success);
    }
    std::cout << " PASSED\n";
}

void test2_multi_stream_heterogeneous() {
    std::cout << "[RUN] TEST 2: Heterogeneous streams with independent rates & capacities..." << std::flush;
    std::vector<IOStreamConfig> stream_configs;

    // Stream 0: Contended (small capacity, fast producer, slow consumer)
    IOStreamConfig s0;
    s0.stream_id = 0;
    s0.name = "Contended-Stream";
    s0.buffer_capacity = 2;
    s0.num_requests = 25;
    s0.producer_interval_ms = 0;
    s0.consumer_processing_ms = 5;
    s0.random_seed = 100;
    stream_configs.push_back(s0);

    // Stream 1: Under-utilized (large capacity, slow producer, fast consumer)
    IOStreamConfig s1;
    s1.stream_id = 1;
    s1.name = "Underflow-Stream";
    s1.buffer_capacity = 16;
    s1.num_requests = 20;
    s1.producer_interval_ms = 5;
    s1.consumer_processing_ms = 0;
    s1.random_seed = 200;
    stream_configs.push_back(s1);

    // Stream 2: Balanced
    IOStreamConfig s2;
    s2.stream_id = 2;
    s2.name = "Balanced-Stream";
    s2.buffer_capacity = 8;
    s2.num_requests = 30;
    s2.producer_interval_ms = 1;
    s2.consumer_processing_ms = 1;
    s2.random_seed = 300;
    stream_configs.push_back(s2);

    Simulation sim(stream_configs);
    SimulationMetrics metrics = sim.run();

    assert(metrics.success);
    assert(metrics.stream_count == 3);

    const auto& sm0 = metrics.stream_metrics[0];
    const auto& sm1 = metrics.stream_metrics[1];
    const auto& sm2 = metrics.stream_metrics[2];

    assert(sm0.total_consumed == 25);
    assert(sm1.total_consumed == 20);
    assert(sm2.total_consumed == 30);

    // Verify independent behavior: Stream 0 had producer blocking, Stream 1 had none
    assert(sm0.total_producer_wait_ms > 0.0);
    assert(sm1.total_producer_wait_ms == 0.0);
    assert(sm0.max_occupancy_slots == 2);
    assert(sm1.max_occupancy_slots <= 2);

    std::cout << " PASSED (Stream 0 wait: " << sm0.total_producer_wait_ms
              << " ms, Stream 1 wait: " << sm1.total_producer_wait_ms << " ms)\n";
}

void test3_high_concurrency_scaling() {
    std::cout << "[RUN] TEST 3: High concurrency scaling test (8 concurrent streams, 16 threads)..." << std::flush;
    const size_t num_streams = 8;
    const size_t req_per_stream = 100;

    SimulationConfig config;
    config.num_streams = num_streams;
    config.buffer_capacity = 6;
    config.num_requests = req_per_stream;
    config.producer_interval_ms = 0;
    config.consumer_processing_ms = 1;
    config.random_seed = 777;

    Simulation sim(config);
    SimulationMetrics metrics = sim.run();

    assert(metrics.success);
    assert(metrics.stream_count == 8);
    assert(metrics.total_produced == num_streams * req_per_stream);
    assert(metrics.total_consumed == num_streams * req_per_stream);

    for (const auto& sm : metrics.stream_metrics) {
        assert(sm.total_consumed == req_per_stream);
        assert(sm.success);
    }
    std::cout << " PASSED (Processed " << metrics.total_consumed << " requests across 8 streams)\n";
}

void test4_stream_manager_direct_lifecycle() {
    std::cout << "[RUN] TEST 4: Direct StreamManager lifecycle and stream lookup..." << std::flush;
    StreamManager manager;

    IOStreamConfig s0;
    s0.stream_id = 10;
    s0.name = "Channel-10";
    s0.buffer_capacity = 4;
    s0.num_requests = 15;
    s0.producer_interval_ms = 0;
    s0.consumer_processing_ms = 1;
    manager.addStream(s0);

    IOStreamConfig s1;
    s1.stream_id = 20;
    s1.name = "Channel-20";
    s1.buffer_capacity = 4;
    s1.num_requests = 15;
    s1.producer_interval_ms = 0;
    s1.consumer_processing_ms = 1;
    manager.addStream(s1);

    assert(manager.size() == 2);
    assert(manager.getStreamById(10) != nullptr);
    assert(manager.getStreamById(20) != nullptr);
    assert(manager.getStreamById(99) == nullptr);
    assert(manager.getStream(0).getName() == "Channel-10");
    assert(manager.getStream(1).getName() == "Channel-20");

    manager.startAll();
    manager.joinAll();

    auto stream_metrics = manager.collectMetrics(0.5);
    assert(stream_metrics.size() == 2);
    assert(stream_metrics[0].total_consumed == 15);
    assert(stream_metrics[1].total_consumed == 15);
    std::cout << " PASSED\n";
}

void test5_multi_stream_deterministic_reproducibility() {
    std::cout << "[RUN] TEST 5: Deterministic multi-stream reproducibility across runs..." << std::flush;
    SimulationConfig config1;
    config1.num_streams = 4;
    config1.buffer_capacity = 8;
    config1.num_requests = 100;
    config1.producer_interval_ms = 0;
    config1.consumer_processing_ms = 0;
    config1.min_payload_bytes = 100;
    config1.max_payload_bytes = 4000;
    config1.random_seed = 9999;

    SimulationConfig config2 = config1;

    Simulation sim1(config1);
    SimulationMetrics m1 = sim1.run();

    Simulation sim2(config2);
    SimulationMetrics m2 = sim2.run();

    assert(m1.success && m2.success);
    assert(m1.total_produced == m2.total_produced);
    assert(m1.total_consumed == m2.total_consumed);
    assert(m1.total_bytes == m2.total_bytes);

    for (size_t i = 0; i < 4; ++i) {
        assert(m1.stream_metrics[i].total_bytes == m2.stream_metrics[i].total_bytes);
    }
    std::cout << " PASSED (Bit-exact match: " << m1.total_bytes << " total bytes across 4 streams)\n";
}

} // anonymous namespace

int main() {
    std::cout << "========================================\n";
    std::cout << "Running Multi-Stream Tests (Phase 2)\n";
    std::cout << "========================================\n";

    test1_multi_stream_homogeneous();
    test2_multi_stream_heterogeneous();
    test3_high_concurrency_scaling();
    test4_stream_manager_direct_lifecycle();
    test5_multi_stream_deterministic_reproducibility();

    std::cout << "========================================\n";
    std::cout << "All Multi-Stream Tests Passed Successfully!\n";
    std::cout << "========================================\n";
    return 0;
}
