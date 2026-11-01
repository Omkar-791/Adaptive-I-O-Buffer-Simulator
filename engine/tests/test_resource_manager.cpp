#include "BufferResourceManager.h"
#include "Simulation.h"
#include "DataModels.h"
#include "EventModel.h"
#include "ErrorCodes.h"
#include <iostream>
#include <cassert>
#include <numeric>
#include <vector>

namespace {

void test1_budget_initialization() {
    std::cout << "[RUN] TEST 1: BufferResourceManager initialization and state inspection..." << std::flush;
    BufferResourceManager rm(32, 2);

    assert(rm.getTotalBudget() == 32);
    assert(rm.getMinCapacity() == 2);
    assert(rm.getTotalAllocated() == 0);
    assert(rm.getFreeBudget() == 32);
    assert(!rm.isBudgetExceeded());
    assert(rm.getStreamCount() == 0);

    // Invalid constructions
    bool threw_zero_budget = false;
    try {
        BufferResourceManager bad_rm(0, 1);
    } catch (const std::invalid_argument&) {
        threw_zero_budget = true;
    }
    assert(threw_zero_budget);

    bool threw_zero_min = false;
    try {
        BufferResourceManager bad_rm2(10, 0);
    } catch (const std::invalid_argument&) {
        threw_zero_min = true;
    }
    assert(threw_zero_min);

    std::cout << " PASSED\n";
}

void test2_equal_allocation() {
    std::cout << "[RUN] TEST 2: Equal allocation across multiple stream counts..." << std::flush;

    // streams=1, budget=10 -> [10]
    {
        BufferResourceManager rm(10, 1);
        auto alloc = rm.allocateEqual(1);
        assert(alloc.size() == 1);
        assert(alloc[0] == 10);
    }

    // streams=2, budget=10 -> [5, 5]
    {
        BufferResourceManager rm(10, 1);
        auto alloc = rm.allocateEqual(2);
        assert(alloc.size() == 2);
        assert(alloc[0] == 5 && alloc[1] == 5);
    }

    // streams=3, budget=30 -> [10, 10, 10]
    {
        BufferResourceManager rm(30, 1);
        auto alloc = rm.allocateEqual(3);
        assert(alloc.size() == 3);
        assert(alloc[0] == 10 && alloc[1] == 10 && alloc[2] == 10);
        size_t sum = std::accumulate(alloc.begin(), alloc.end(), size_t{0});
        assert(sum == 30);
    }

    std::cout << " PASSED\n";
}

void test3_remainder_allocation() {
    std::cout << "[RUN] TEST 3: Deterministic remainder allocation (budget modulo streams != 0)..." << std::flush;

    // streams=3, budget=10 -> [4, 3, 3] (10 / 3 = 3, rem = 1)
    {
        BufferResourceManager rm(10, 1);
        auto alloc = rm.allocateEqual(3);
        assert(alloc.size() == 3);
        assert(alloc[0] == 4);
        assert(alloc[1] == 3);
        assert(alloc[2] == 3);
        size_t sum = std::accumulate(alloc.begin(), alloc.end(), size_t{0});
        assert(sum == 10);
    }

    // streams=3, budget=31 -> [11, 10, 10]
    {
        BufferResourceManager rm(31, 1);
        auto alloc = rm.allocateEqual(3);
        assert(alloc.size() == 3);
        assert(alloc[0] == 11);
        assert(alloc[1] == 10);
        assert(alloc[2] == 10);
        size_t sum = std::accumulate(alloc.begin(), alloc.end(), size_t{0});
        assert(sum == 31);
    }

    // streams=3, budget=32 -> [11, 11, 10]
    {
        BufferResourceManager rm(32, 1);
        auto alloc = rm.allocateEqual(3);
        assert(alloc.size() == 3);
        assert(alloc[0] == 11);
        assert(alloc[1] == 11);
        assert(alloc[2] == 10);
        size_t sum = std::accumulate(alloc.begin(), alloc.end(), size_t{0});
        assert(sum == 32);
    }

    // streams=4, budget=10 -> [3, 3, 2, 2] (10 / 4 = 2, rem = 2)
    {
        BufferResourceManager rm(10, 1);
        auto alloc = rm.allocateEqual(4);
        assert(alloc.size() == 4);
        assert(alloc[0] == 3);
        assert(alloc[1] == 3);
        assert(alloc[2] == 2);
        assert(alloc[3] == 2);
        size_t sum = std::accumulate(alloc.begin(), alloc.end(), size_t{0});
        assert(sum == 10);
    }

    // streams=8, budget=32 -> [4, 4, 4, 4, 4, 4, 4, 4]
    {
        BufferResourceManager rm(32, 1);
        auto alloc = rm.allocateEqual(8);
        assert(alloc.size() == 8);
        for (size_t s : alloc) {
            assert(s == 4);
        }
        size_t sum = std::accumulate(alloc.begin(), alloc.end(), size_t{0});
        assert(sum == 32);
    }

    std::cout << " PASSED\n";
}

void test4_minimum_capacity_validation() {
    std::cout << "[RUN] TEST 4: Minimum buffer capacity enforcement..." << std::flush;

    // streams=6, budget=5, min_capacity=1 -> fails (insufficient for 6 * 1 = 6)
    {
        BufferResourceManager rm(5, 1);
        bool threw = false;
        try {
            rm.allocateEqual(6);
        } catch (const std::invalid_argument&) {
            threw = true;
        }
        assert(threw);
    }

    // streams=5, min_capacity=2, budget=6 -> fails (insufficient for 5 * 2 = 10)
    {
        BufferResourceManager rm(6, 2);
        bool threw = false;
        try {
            rm.allocateEqual(5);
        } catch (const std::invalid_argument&) {
            threw = true;
        }
        assert(threw);
    }

    // Registering below min_capacity
    {
        BufferResourceManager rm(20, 2);
        std::string err;
        bool ok = rm.registerStream(0, 1, &err);
        assert(!ok);
        assert(!err.empty());
    }

    std::cout << " PASSED\n";
}

void test5_budget_overflow_prevention() {
    std::cout << "[RUN] TEST 5: Budget overflow prevention and accounting..." << std::flush;
    BufferResourceManager rm(20, 1);

    // Stream 0: 12
    assert(rm.registerStream(0, 12));
    assert(rm.getTotalAllocated() == 12);
    assert(rm.getFreeBudget() == 8);

    // Stream 1: 8
    assert(rm.registerStream(1, 8));
    assert(rm.getTotalAllocated() == 20);
    assert(rm.getFreeBudget() == 0);
    assert(!rm.isBudgetExceeded());

    // Stream 2: 1 -> Overflow
    std::string err;
    assert(!rm.registerStream(2, 1, &err));
    assert(!err.empty());
    assert(rm.getTotalAllocated() == 20);
    assert(rm.getStreamCount() == 2);

    // Resizing Stream 0 to 15 -> would make 23 > 20
    assert(!rm.canResize(0, 15));
    assert(!rm.requestResize(0, 15, &err));
    assert(rm.getStreamCapacity(0) == 12);
    assert(rm.getTotalAllocated() == 20);

    // Resizing Stream 0 to 10 -> legal reduction
    assert(rm.canResize(0, 10));
    assert(rm.requestResize(0, 10));
    assert(rm.getStreamCapacity(0) == 10);
    assert(rm.getTotalAllocated() == 18);
    assert(rm.getFreeBudget() == 2);

    // Now Stream 2: 2 -> legal
    assert(rm.registerStream(2, 2));
    assert(rm.getTotalAllocated() == 20);
    assert(rm.getStreamCount() == 3);

    // Unregister Stream 1 (capacity 8)
    assert(rm.unregisterStream(1));
    assert(rm.getTotalAllocated() == 12);
    assert(rm.getFreeBudget() == 8);
    assert(!rm.hasStream(1));

    std::cout << " PASSED\n";
}

void test6_reallocation_and_resizing_hooks() {
    std::cout << "[RUN] TEST 6: Dynamic reallocation hook (Phase 6 interface preparation)..." << std::flush;
    BufferResourceManager rm(24, 2);

    assert(rm.registerStream(0, 12));
    assert(rm.registerStream(1, 12));
    assert(rm.getTotalAllocated() == 24);

    // Transfer 4 from Stream 0 to Stream 1
    std::string err;
    assert(rm.reallocate(0, 1, 4, &err));
    assert(rm.getStreamCapacity(0) == 8);
    assert(rm.getStreamCapacity(1) == 16);
    assert(rm.getTotalAllocated() == 24);
    assert(rm.getFreeBudget() == 0);

    // Attempt to transfer 7 from Stream 0 (leaving 1 < min_capacity 2) -> rejected
    assert(!rm.reallocate(0, 1, 7, &err));
    assert(!err.empty());
    assert(rm.getStreamCapacity(0) == 8);
    assert(rm.getStreamCapacity(1) == 16);
    assert(rm.getTotalAllocated() == 24);

    // Transfer with non-existent stream -> rejected
    assert(!rm.reallocate(99, 1, 1, &err));
    assert(!rm.reallocate(0, 99, 1, &err));

    std::cout << " PASSED\n";
}

void test7_simulation_under_global_budget() {
    std::cout << "[RUN] TEST 7: Multi-stream simulation under global buffer budget..." << std::flush;

    // 3 streams, budget = 31 (allocates 11, 10, 10)
    SimulationConfig config;
    config.num_streams = 3;
    config.global_buffer_budget = 31;
    config.num_requests = 20;
    config.producer_interval_ms = 0;
    config.consumer_processing_ms = 1;
    config.random_seed = 42;

    Simulation sim(config);
    assert(sim.getResourceManager().getTotalBudget() == 31);
    assert(sim.getResourceManager().getTotalAllocated() == 31);
    assert(sim.getResourceManager().getStreamCapacity(0) == 11);
    assert(sim.getResourceManager().getStreamCapacity(1) == 10);
    assert(sim.getResourceManager().getStreamCapacity(2) == 10);

    SimulationMetrics metrics = sim.run();
    assert(metrics.success);
    assert(metrics.global_buffer_budget == 31);
    assert(metrics.total_allocated_capacity == 31);
    assert(metrics.free_buffer_budget == 0);
    assert(metrics.total_produced == 60);
    assert(metrics.total_consumed == 60);

    // Invariant verifications
    size_t cap_sum = 0;
    for (const auto& sm : metrics.stream_metrics) {
        cap_sum += sm.buffer_capacity;
        assert(sm.buffer_capacity >= metrics.min_buffer_capacity);
        assert(sm.max_occupancy_slots <= sm.buffer_capacity);
        assert(sm.total_consumed <= sm.total_produced);
    }
    assert(cap_sum <= metrics.global_buffer_budget);

    std::cout << " PASSED\n";
}

void test8_invalid_configurations_rejected() {
    std::cout << "[RUN] TEST 8: Invalid configuration rejection..." << std::flush;

    // Config with budget < streams * min_capacity
    {
        SimulationConfig cfg;
        cfg.num_streams = 5;
        cfg.global_buffer_budget = 6;
        cfg.min_buffer_capacity = 2; // requires 10
        bool threw = false;
        try {
            Simulation sim(cfg);
        } catch (const std::invalid_argument&) {
            threw = true;
        }
        assert(threw);
    }

    // Config with explicit capacity exceeding budget
    {
        SimulationConfig cfg;
        cfg.num_streams = 3;
        cfg.buffer_capacity = 12; // 3 * 12 = 36
        cfg.capacity_explicitly_set = true;
        cfg.global_buffer_budget = 30; // budget is 30
        bool threw = false;
        try {
            Simulation sim(cfg);
        } catch (const std::invalid_argument&) {
            threw = true;
        }
        assert(threw);
    }

    std::cout << " PASSED\n";
}

void test9_data_models_and_json() {
    std::cout << "[RUN] TEST 9: Canonical data models and JSON serialization..." << std::flush;

    BufferState bs{0, 8, 3, 37.5, false};
    std::string bs_json = bs.toJson();
    assert(bs_json.find("\"stream_id\": 0") != std::string::npos);
    assert(bs_json.find("\"capacity\": 8") != std::string::npos);
    assert(bs_json.find("\"occupancy\": 3") != std::string::npos);

    StreamState ss{1, "Stream-1", StreamStatus::RUNNING, bs, 100, 97};
    std::string ss_json = ss.toJson();
    assert(ss_json.find("\"status\": \"RUNNING\"") != std::string::npos);

    SimulationState sim_state{"sim-101", SimulationStatus::RUNNING, 32, 24, 8, 3, 1.25};
    std::string sim_state_json = sim_state.toJson();
    assert(sim_state_json.find("\"total_budget\": 32") != std::string::npos);
    assert(sim_state_json.find("\"allocated_budget\": 24") != std::string::npos);

    SimulationEvent ev{1234567, SimulationEventType::RESOURCE_ALLOCATION_CHANGED, 0, "Capacity adjusted", "{}"};
    std::string ev_json = ev.toJson();
    assert(ev_json.find("\"event_type\": \"RESOURCE_ALLOCATION_CHANGED\"") != std::string::npos);

    EngineError err{EngineErrorCode::RESOURCE_LIMIT_EXCEEDED, "Budget exceeded", "Requested 40 > 32"};
    std::string err_json = err.toJson();
    assert(err_json.find("\"code\": \"RESOURCE_LIMIT_EXCEEDED\"") != std::string::npos);

    std::cout << " PASSED\n";
}

} // anonymous namespace

int main() {
    std::cout << "========================================\n";
    std::cout << "Running BufferResourceManager Tests (Phase 3)\n";
    std::cout << "========================================\n";

    test1_budget_initialization();
    test2_equal_allocation();
    test3_remainder_allocation();
    test4_minimum_capacity_validation();
    test5_budget_overflow_prevention();
    test6_reallocation_and_resizing_hooks();
    test7_simulation_under_global_budget();
    test8_invalid_configurations_rejected();
    test9_data_models_and_json();

    std::cout << "========================================\n";
    std::cout << "All Phase 3 Tests Passed Successfully!\n";
    std::cout << "========================================\n";
    return 0;
}
