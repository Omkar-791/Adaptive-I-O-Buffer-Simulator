#include "WorkloadGenerator.h"
#include "Producer.h"
#include "Consumer.h"
#include "BoundedBuffer.h"
#include "Simulation.h"
#include "ConfigParser.h"
#include "EventModel.h"
#include "Metrics.h"
#include <iostream>
#include <cassert>
#include <vector>
#include <cmath>
#include <thread>
#include <sstream>

namespace {

void test1_steady_workload() {
    std::cout << "[RUN] TEST 1: Steady workload generation and payload bounds..." << std::flush;
    WorkloadConfig config;
    config.type = WorkloadType::STEADY;
    config.base_interval_ms = 15;
    config.min_payload_bytes = 1024;
    config.max_payload_bytes = 2048;
    config.seed = 42;

    WorkloadGenerator gen(config);
    for (size_t i = 0; i < 50; ++i) {
        WorkloadRequest req = gen.getNextRequest(i);
        assert(req.request_id == i);
        assert(req.inter_arrival_ms == 15);
        assert(req.phase_name == "STEADY");
        assert(req.payload_bytes >= 1024);
        assert(req.payload_bytes <= 2048);
    }
    std::cout << " PASSED\n";
}

void test2_burst_workload() {
    std::cout << "[RUN] TEST 2: Burst workload phase transitions and intervals..." << std::flush;
    WorkloadConfig config;
    config.type = WorkloadType::BURST;
    config.base_interval_ms = 20;
    config.burst_interval_ms = 2;
    config.burst_length = 5;
    config.normal_length = 10;
    config.seed = 101;

    WorkloadGenerator gen(config);
    // Cycle is 15 requests (10 normal + 5 burst)
    for (size_t i = 0; i < 10; ++i) {
        WorkloadRequest req = gen.getNextRequest(i);
        assert(req.phase_name == "NORMAL");
        assert(req.inter_arrival_ms == 20);
    }
    for (size_t i = 10; i < 15; ++i) {
        WorkloadRequest req = gen.getNextRequest(i);
        assert(req.phase_name == "BURST");
        assert(req.inter_arrival_ms == 2);
    }
    // Next cycle returns to normal
    for (size_t i = 15; i < 25; ++i) {
        WorkloadRequest req = gen.getNextRequest(i);
        assert(req.phase_name == "NORMAL");
        assert(req.inter_arrival_ms == 20);
    }
    std::cout << " PASSED\n";
}

void test3_periodic_workload() {
    std::cout << "[RUN] TEST 3: Periodic sinusoidal interval modulation..." << std::flush;
    WorkloadConfig config;
    config.type = WorkloadType::PERIODIC;
    config.base_interval_ms = 20;
    config.period_length = 20;
    config.amplitude_pct = 50.0; // 50% amplitude: interval ranges between 10ms and 30ms
    config.seed = 202;

    WorkloadGenerator gen(config);
    uint32_t min_seen = 1000;
    uint32_t max_seen = 0;
    for (size_t i = 0; i < 60; ++i) {
        WorkloadRequest req = gen.getNextRequest(i);
        assert(req.phase_name == "PERIODIC");
        min_seen = std::min(min_seen, req.inter_arrival_ms);
        max_seen = std::max(max_seen, req.inter_arrival_ms);
        // Interval must remain non-negative and bounded
        assert(req.inter_arrival_ms >= 5 && req.inter_arrival_ms <= 35);
    }
    // Verify modulation was observed
    assert(min_seen < max_seen);
    std::cout << " PASSED\n";
}

void test4_stochastic_workload() {
    std::cout << "[RUN] TEST 4: Stochastic Poisson/exponential interval distribution..." << std::flush;
    WorkloadConfig config;
    config.type = WorkloadType::STOCHASTIC;
    config.base_interval_ms = 10;
    config.lambda = 0.1;
    config.seed = 303;

    WorkloadGenerator gen(config);
    double sum = 0.0;
    const size_t n = 200;
    for (size_t i = 0; i < n; ++i) {
        WorkloadRequest req = gen.getNextRequest(i);
        assert(req.phase_name == "STOCHASTIC");
        assert(req.inter_arrival_ms < 1000);
        sum += req.inter_arrival_ms;
    }
    double mean = sum / static_cast<double>(n);
    // For lambda=0.1, theoretical mean is 1/0.1 = 10. Sample mean should be within reasonable bounds
    assert(mean >= 5.0 && mean <= 16.0);
    std::cout << " PASSED\n";
}

void test5_mixed_workload() {
    std::cout << "[RUN] TEST 5: Custom multi-phase mixed workload..." << std::flush;
    WorkloadConfig config;
    config.type = WorkloadType::MIXED;
    config.seed = 404;

    WorkloadPhase p1{"WARMUP", 10, 5, 256, 512};
    WorkloadPhase p2{"STRESS", 1, 10, 1024, 2048};
    WorkloadPhase p3{"COOLDOWN", 20, 5, 128, 256};
    config.phases = {p1, p2, p3};

    WorkloadGenerator gen(config);
    // Phase 1: WARMUP (5 reqs, interval 10)
    for (size_t i = 0; i < 5; ++i) {
        WorkloadRequest req = gen.getNextRequest(i);
        assert(req.phase_name == "WARMUP");
        assert(req.inter_arrival_ms == 10);
        assert(req.payload_bytes >= 256 && req.payload_bytes <= 512);
    }
    // Phase 2: STRESS (10 reqs, interval 1)
    for (size_t i = 5; i < 15; ++i) {
        WorkloadRequest req = gen.getNextRequest(i);
        assert(req.phase_name == "STRESS");
        assert(req.inter_arrival_ms == 1);
        assert(req.payload_bytes >= 1024 && req.payload_bytes <= 2048);
    }
    // Phase 3: COOLDOWN (5 reqs, interval 20)
    for (size_t i = 15; i < 20; ++i) {
        WorkloadRequest req = gen.getNextRequest(i);
        assert(req.phase_name == "COOLDOWN");
        assert(req.inter_arrival_ms == 20);
        assert(req.payload_bytes >= 128 && req.payload_bytes <= 256);
    }
    // Repeats cycle
    WorkloadRequest req20 = gen.getNextRequest(20);
    assert(req20.phase_name == "WARMUP");
    assert(req20.inter_arrival_ms == 10);
    std::cout << " PASSED\n";
}

void test6_seed_reproducibility() {
    std::cout << "[RUN] TEST 6: Strict PRNG seed reproducibility..." << std::flush;
    WorkloadConfig config;
    config.type = WorkloadType::STOCHASTIC;
    config.base_interval_ms = 10;
    config.lambda = 0.15;
    config.min_payload_bytes = 512;
    config.max_payload_bytes = 4096;
    config.seed = 9999;

    WorkloadGenerator gen1(config);
    WorkloadGenerator gen2(config);

    for (size_t i = 0; i < 100; ++i) {
        WorkloadRequest req1 = gen1.getNextRequest(i);
        WorkloadRequest req2 = gen2.getNextRequest(i);
        assert(req1.request_id == req2.request_id);
        assert(req1.inter_arrival_ms == req2.inter_arrival_ms);
        assert(req1.payload_bytes == req2.payload_bytes);
        assert(req1.phase_name == req2.phase_name);
    }
    std::cout << " PASSED\n";
}

void test7_seed_differentiation() {
    std::cout << "[RUN] TEST 7: Seed differentiation producing unique streams..." << std::flush;
    WorkloadConfig c1;
    c1.type = WorkloadType::BURST;
    c1.seed = 1111;

    WorkloadConfig c2;
    c2.type = WorkloadType::BURST;
    c2.seed = 2222;

    WorkloadGenerator gen1(c1);
    WorkloadGenerator gen2(c2);

    bool found_difference = false;
    for (size_t i = 0; i < 50; ++i) {
        WorkloadRequest r1 = gen1.getNextRequest(i);
        WorkloadRequest r2 = gen2.getNextRequest(i);
        if (r1.payload_bytes != r2.payload_bytes) {
            found_difference = true;
            break;
        }
    }
    assert(found_difference);
    std::cout << " PASSED\n";
}

void test8_producer_workload_integration() {
    std::cout << "[RUN] TEST 8: Producer thread integration with WorkloadGenerator..." << std::flush;
    BoundedBuffer buffer(8);

    WorkloadConfig wcfg;
    wcfg.type = WorkloadType::BURST;
    wcfg.base_interval_ms = 1;
    wcfg.burst_interval_ms = 0;
    wcfg.burst_length = 5;
    wcfg.normal_length = 15;
    wcfg.seed = 555;
    wcfg.stream_id = 7;

    const size_t req_count = 30;
    Producer producer(buffer, req_count, wcfg);
    Consumer consumer(buffer, 0, 7);

    assert(producer.getStreamId() == 7);
    assert(producer.getProducedCount() == 0);

    std::thread prod_t(&Producer::run, &producer);
    std::thread cons_t(&Consumer::run, &consumer);

    prod_t.join();
    buffer.close();
    cons_t.join();

    assert(producer.getProducedCount() == req_count);
    assert(consumer.getConsumedCount() == req_count);
    assert(consumer.getTotalBytesConsumed() == producer.getTotalBytesProduced());
    std::cout << " PASSED\n";
}

void test9_simulation_burst_execution() {
    std::cout << "[RUN] TEST 9: Multi-stream simulation with BURST workload..." << std::flush;
    SimulationConfig sc;
    sc.num_streams = 2;
    sc.buffer_capacity = 8;
    sc.num_requests = 50;
    sc.producer_interval_ms = 2;
    sc.consumer_processing_ms = 1;
    sc.random_seed = 777;

    sc.use_workload_config = true;
    sc.workload.type = WorkloadType::BURST;
    sc.workload.base_interval_ms = 2;
    sc.workload.burst_interval_ms = 0;
    sc.workload.burst_length = 10;
    sc.workload.normal_length = 15;

    Simulation sim(sc);
    SimulationMetrics metrics = sim.run();

    assert(metrics.success);
    assert(metrics.stream_count == 2);
    assert(metrics.total_produced == 100);
    assert(metrics.total_consumed == 100);
    assert(metrics.workload_type == "BURST");
    assert(metrics.stream_metrics.size() == 2);
    assert(metrics.stream_metrics[0].workload_type == "BURST");
    assert(metrics.stream_metrics[1].workload_type == "BURST");
    std::cout << " PASSED\n";
}

void test10_simulation_heterogeneous_execution() {
    std::cout << "[RUN] TEST 10: Multi-stream simulation with heterogeneous workloads..." << std::flush;
    IOStreamConfig s0;
    s0.stream_id = 0;
    s0.name = "Steady-Stream";
    s0.buffer_capacity = 6;
    s0.num_requests = 40;
    s0.consumer_processing_ms = 1;
    s0.use_workload_config = true;
    s0.workload.type = WorkloadType::STEADY;
    s0.workload.base_interval_ms = 2;

    IOStreamConfig s1;
    s1.stream_id = 1;
    s1.name = "Burst-Stream";
    s1.buffer_capacity = 10;
    s1.num_requests = 40;
    s1.consumer_processing_ms = 1;
    s1.use_workload_config = true;
    s1.workload.type = WorkloadType::BURST;
    s1.workload.base_interval_ms = 3;
    s1.workload.burst_interval_ms = 0;
    s1.workload.burst_length = 10;
    s1.workload.normal_length = 10;

    std::vector<IOStreamConfig> streams = {s0, s1};
    Simulation sim(streams, 16);
    SimulationMetrics metrics = sim.run();

    assert(metrics.success);
    assert(metrics.stream_count == 2);
    assert(metrics.total_produced == 80);
    assert(metrics.total_consumed == 80);
    assert(metrics.workload_type == "HETEROGENEOUS");
    assert(metrics.stream_metrics[0].workload_type == "STEADY");
    assert(metrics.stream_metrics[1].workload_type == "BURST");
    std::cout << " PASSED\n";
}

void test11_config_parser() {
    std::cout << "[RUN] TEST 11: JSON configuration file parser..." << std::flush;
    // Test parsing steady config file
    ParsedSimulationConfig steady_parsed = ConfigParser::parseFile("configs/workload_steady.json");
    assert(!steady_parsed.is_heterogeneous);
    assert(steady_parsed.sim_config.num_streams == 2);
    assert(steady_parsed.sim_config.num_requests == 200);
    assert(steady_parsed.sim_config.use_workload_config);
    assert(steady_parsed.sim_config.workload.type == WorkloadType::STEADY);

    // Test parsing heterogeneous config file
    ParsedSimulationConfig het_parsed = ConfigParser::parseFile("configs/workload_heterogeneous.json");
    assert(het_parsed.is_heterogeneous);
    assert(het_parsed.global_budget == 32);
    assert(het_parsed.stream_configs.size() == 3);
    assert(het_parsed.stream_configs[0].workload.type == WorkloadType::PERIODIC);
    assert(het_parsed.stream_configs[1].workload.type == WorkloadType::BURST);
    assert(het_parsed.stream_configs[2].workload.type == WorkloadType::STOCHASTIC);

    // Test memory string parsing
    const std::string json_str = R"({
        "num_streams": 1,
        "num_requests": 50,
        "workload": {
            "type": "BURST",
            "base_interval_ms": 10,
            "burst_interval_ms": 1,
            "burst_length": 5,
            "normal_length": 15
        }
    })";
    ParsedSimulationConfig mem_parsed = ConfigParser::parseString(json_str);
    assert(!mem_parsed.is_heterogeneous);
    assert(mem_parsed.sim_config.num_requests == 50);
    assert(mem_parsed.sim_config.workload.type == WorkloadType::BURST);
    assert(mem_parsed.sim_config.workload.burst_interval_ms == 1);
    std::cout << " PASSED\n";
}

void test12_metrics_and_events() {
    std::cout << "[RUN] TEST 12: Workload metrics serialization and event model..." << std::flush;
    // Check EventModel workload events
    assert(eventTypeToString(SimulationEventType::WORKLOAD_STARTED) == "WORKLOAD_STARTED");
    assert(eventTypeToString(SimulationEventType::WORKLOAD_PHASE_CHANGED) == "WORKLOAD_PHASE_CHANGED");
    assert(eventTypeToString(SimulationEventType::WORKLOAD_COMPLETED) == "WORKLOAD_COMPLETED");

    SimulationEvent event;
    event.timestamp_ms = 1234;
    event.event_type = SimulationEventType::WORKLOAD_PHASE_CHANGED;
    event.stream_id = 1;
    event.message = "Entered BURST phase";
    std::string ev_json = event.toJson();
    assert(ev_json.find("\"event_type\": \"WORKLOAD_PHASE_CHANGED\"") != std::string::npos);
    assert(ev_json.find("\"stream_id\": 1") != std::string::npos);

    // Check Metrics serialization
    StreamMetrics sm;
    sm.stream_id = 2;
    sm.workload_type = "PERIODIC";
    std::string sm_json = sm.toJson();
    assert(sm_json.find("\"workload_type\": \"PERIODIC\"") != std::string::npos);

    SimulationMetrics sim_m;
    sim_m.workload_type = "HETEROGENEOUS";
    std::string sim_json = sim_m.toJson();
    assert(sim_json.find("\"workload_type\": \"HETEROGENEOUS\"") != std::string::npos);

    std::cout << " PASSED\n";
}

} // anonymous namespace

int main() {
    std::cout << "==================================================\n";
    std::cout << "Phase 4: Realistic Workload Generator Unit Tests\n";
    std::cout << "==================================================\n";

    test1_steady_workload();
    test2_burst_workload();
    test3_periodic_workload();
    test4_stochastic_workload();
    test5_mixed_workload();
    test6_seed_reproducibility();
    test7_seed_differentiation();
    test8_producer_workload_integration();
    test9_simulation_burst_execution();
    test10_simulation_heterogeneous_execution();
    test11_config_parser();
    test12_metrics_and_events();

    std::cout << "==================================================\n";
    std::cout << "ALL 12 WORKLOAD GENERATOR TESTS PASSED!\n";
    std::cout << "==================================================\n";
    return 0;
}
