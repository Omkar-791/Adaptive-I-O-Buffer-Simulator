#include "Simulation.h"
#include <iostream>
#include <cassert>

namespace {

void test8_complete_simulation_balanced() {
    std::cout << "[RUN] TEST 8: Complete simulation run (produced == consumed)..." << std::flush;
    SimulationConfig config;
    config.buffer_capacity = 4;
    config.num_requests = 100;
    config.producer_interval_ms = 1;
    config.consumer_processing_ms = 1;
    config.min_payload_bytes = 256;
    config.max_payload_bytes = 1024;
    config.random_seed = 42;

    Simulation sim(config);
    SimulationMetrics metrics = sim.run();

    assert(metrics.success);
    assert(metrics.total_produced == 100);
    assert(metrics.total_consumed == 100);
    assert(metrics.total_bytes > 0);
    assert(metrics.throughput_req_per_sec > 0.0);
    assert(metrics.avg_latency_ms > 0.0);
    assert(metrics.max_occupancy_slots <= config.buffer_capacity);
    std::cout << " PASSED\n";
}

void test9_deterministic_seed_reproducibility() {
    std::cout << "[RUN] TEST 9: Deterministic seed produces identical workload metrics..." << std::flush;
    SimulationConfig config1;
    config1.buffer_capacity = 8;
    config1.num_requests = 200;
    config1.producer_interval_ms = 0;
    config1.consumer_processing_ms = 0;
    config1.min_payload_bytes = 100;
    config1.max_payload_bytes = 5000;
    config1.random_seed = 1337;

    SimulationConfig config2 = config1;

    Simulation sim1(config1);
    SimulationMetrics m1 = sim1.run();

    Simulation sim2(config2);
    SimulationMetrics m2 = sim2.run();

    assert(m1.success && m2.success);
    assert(m1.total_produced == m2.total_produced);
    assert(m1.total_consumed == m2.total_consumed);
    // Payload sum must match bit-for-bit
    assert(m1.total_bytes == m2.total_bytes);
    std::cout << " PASSED (Identical total bytes: " << m1.total_bytes << ")\n";
}

void test_fast_producer_slow_consumer_contention() {
    std::cout << "[RUN] TEST: Fast producer, slow consumer (verify producer wait time > 0)..." << std::flush;
    SimulationConfig config;
    config.buffer_capacity = 2; // Very small capacity
    config.num_requests = 20;
    config.producer_interval_ms = 0; // Producer generates as fast as possible
    config.consumer_processing_ms = 5; // Consumer takes 5ms per request
    config.random_seed = 999;

    Simulation sim(config);
    SimulationMetrics metrics = sim.run();

    assert(metrics.success);
    assert(metrics.total_produced == 20);
    assert(metrics.total_consumed == 20);
    assert(metrics.max_occupancy_slots == 2);
    assert(metrics.total_producer_wait_ms > 0.0);
    assert(metrics.avg_producer_wait_ms > 0.0);
    std::cout << " PASSED (Producer blocked for " << metrics.total_producer_wait_ms << " ms)\n";
}

void test_slow_producer_fast_consumer_underflow() {
    std::cout << "[RUN] TEST: Slow producer, fast consumer (verify zero/low producer wait)..." << std::flush;
    SimulationConfig config;
    config.buffer_capacity = 16;
    config.num_requests = 15;
    config.producer_interval_ms = 5;
    config.consumer_processing_ms = 0;
    config.random_seed = 888;

    Simulation sim(config);
    SimulationMetrics metrics = sim.run();

    assert(metrics.success);
    assert(metrics.total_produced == 15);
    assert(metrics.total_consumed == 15);
    // Buffer should stay mostly empty; producer wait should be zero
    assert(metrics.total_producer_wait_ms == 0.0);
    assert(metrics.avg_occupancy_slots < 2.0);
    std::cout << " PASSED\n";
}

void test_small_capacity_two() {
    std::cout << "[RUN] TEST: Edge case with minimum buffer capacity = 2..." << std::flush;
    SimulationConfig config;
    config.buffer_capacity = 2;
    config.num_requests = 50;
    config.producer_interval_ms = 1;
    config.consumer_processing_ms = 2;
    config.random_seed = 777;

    Simulation sim(config);
    SimulationMetrics metrics = sim.run();

    assert(metrics.success);
    assert(metrics.max_occupancy_slots <= 2);
    assert(metrics.total_consumed == 50);
    std::cout << " PASSED\n";
}

} // anonymous namespace

int main() {
    std::cout << "========================================\n";
    std::cout << "Running Simulation Integration Tests (Phase 1)\n";
    std::cout << "========================================\n";

    test8_complete_simulation_balanced();
    test9_deterministic_seed_reproducibility();
    test_fast_producer_slow_consumer_contention();
    test_slow_producer_fast_consumer_underflow();
    test_small_capacity_two();

    std::cout << "========================================\n";
    std::cout << "All Simulation Integration Tests Passed Successfully!\n";
    std::cout << "========================================\n";
    return 0;
}
