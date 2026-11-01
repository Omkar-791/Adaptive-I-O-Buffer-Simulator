#include "ExperimentRunner.h"
#include <cassert>
#include <cmath>
#include <iostream>
#include <limits>
#include <set>
#include <stdexcept>

namespace {
size_t capacity(const std::vector<StreamAllocation>& allocation, uint32_t id) {
    for(const auto& item:allocation) if(item.stream_id==id) return item.capacity;
    assert(false);return 0;
}
void equal_allocation_constraints() {
    auto allocation=ExperimentRunner::allocateEqual(10,{{2,1,8},{0,1,8},{1,1,8}});
    assert(allocation.size()==3);
    assert(capacity(allocation,0)==4&&capacity(allocation,1)==3&&capacity(allocation,2)==3);
    const auto limited=ExperimentRunner::allocateEqual(20,{{0,1,2},{1,1,4}});
    assert(capacity(limited,0)==2&&capacity(limited,1)==4);
    const auto unequal_min=ExperimentRunner::allocateEqual(10,{{0,6,9},{1,1,9}});
    assert(capacity(unequal_min,0)>=6&&capacity(unequal_min,1)>=1);
    size_t sum=0;for(const auto& a:unequal_min)sum+=a.capacity;assert(sum<=10);
    for(int kind=0;kind<4;++kind) {
        bool rejected=false;
        try {
            if(kind==0)ExperimentRunner::allocateEqual(1,{{0,1,8},{1,1,8}});
            if(kind==1)ExperimentRunner::allocateEqual(8,{{0,0,8}});
            if(kind==2)ExperimentRunner::allocateEqual(8,{{0,3,2}});
            if(kind==3)ExperimentRunner::allocateEqual(8,{{0,1,8},{0,1,8}});
        } catch(const std::exception&) {rejected=true;}
        assert(rejected);
    }
    const auto floor_case=ExperimentRunner::allocateEqual(8,{{0,5,10},{1,1,10},{2,1,10}});
    assert(capacity(floor_case,0)==5&&capacity(floor_case,1)==2&&capacity(floor_case,2)==1);
    const auto empty=ExperimentRunner::allocateEqual(0,{});assert(empty.empty());
    const size_t maximum=std::numeric_limits<size_t>::max();
    const auto huge=ExperimentRunner::allocateEqual(maximum,{{0,1,maximum},{1,1,maximum}});
    assert(capacity(huge,0)>0&&capacity(huge,1)>0);
    assert(capacity(huge,0)<=maximum-capacity(huge,1));
}
ExperimentCase simple_case() {
    auto parsed=ConfigParser::parseString(R"({"num_streams":2,"buffer_capacity":4,"num_requests":12,"producer_interval_ms":0,"consumer_processing_ms":0,"global_buffer_budget":8})");
    return ExperimentRunner::makeCase(parsed,"simple",8,1,16);
}
void normalized_case_and_seed_reproducibility() {
    auto experiment=simple_case();
    ExperimentRunOptions options;options.seed=73;options.metrics={5,10};
    const auto fixed=ExperimentRunner::runOne(experiment,AllocationStrategy::FixedEqual,options);
    const auto again=ExperimentRunner::runOne(experiment,AllocationStrategy::FixedEqual,options);
    const auto adaptive=ExperimentRunner::runOne(experiment,AllocationStrategy::Adaptive,options);
    assert(fixed.success&&again.success&&adaptive.success);
    assert(fixed.workload_equivalent&&again.workload_equivalent&&adaptive.workload_equivalent);
    assert(!fixed.input_fingerprint.empty());
    assert(fixed.input_fingerprint==again.input_fingerprint&&fixed.input_fingerprint==adaptive.input_fingerprint);
    assert(fixed.summary.total_bytes==again.summary.total_bytes&&fixed.summary.total_bytes==adaptive.summary.total_bytes);
    assert(fixed.summary.total_consumed==24&&adaptive.summary.total_consumed==24);
    assert(fixed.resize_successful==0&&fixed.resize_deferred==0&&fixed.resize_rejected==0);
    for(const auto& a:fixed.initial_allocations)assert(a.capacity==capacity(fixed.final_allocations,a.stream_id));
    assert(fixed.configs.size()==2);
    assert(fixed.configs[0].random_seed==fixed.configs[0].workload.seed);
    options.seed=74;
    const auto different=ExperimentRunner::runOne(experiment,AllocationStrategy::FixedEqual,options);
    assert(different.success&&different.input_fingerprint!=fixed.input_fingerprint);
    options.request_count=3;
    const auto fewer=ExperimentRunner::runOne(experiment,AllocationStrategy::FixedEqual,options);
    assert(fewer.success&&fewer.summary.total_consumed==6&&fewer.input_fingerprint!=different.input_fingerprint);
    assert(fixed.toJson().find("input_fingerprint")!=std::string::npos);
    ConfigParser::parseString(fixed.toJson());
    auto escaped=fixed;escaped.workload_name="quoted\"\n\\name";
    escaped.configs[0].name="stream\"\n\\name";
    ConfigParser::parseString(escaped.toJson());
    assert(fixed.toJson().find("nan")==std::string::npos);
    assert(std::isfinite(fixed.p50_latency_upper_ms)&&std::isfinite(fixed.p95_latency_upper_ms));
}
void heterogeneous_workload_equivalence_and_real_adaptation() {
    auto parsed=ConfigParser::parseString(R"({"global_buffer_budget":16,"streams":[{"stream_id":0,"name":"hot","buffer_capacity":8,"num_requests":70,"consumer_processing_ms":2,"workload":{"type":"BURST","base_interval_ms":0,"burst_interval_ms":0,"min_payload_bytes":64,"max_payload_bytes":128,"seed":1001}},{"stream_id":1,"name":"idle","buffer_capacity":8,"num_requests":0,"consumer_processing_ms":0,"workload":{"type":"STOCHASTIC","base_interval_ms":1,"seed":2002}}]})");
    auto experiment=ExperimentRunner::makeCase(parsed,"heterogeneous",16,1,16);
    ExperimentRunOptions options;options.seed=11;options.metrics={5,10};
    options.controller.confirmation_windows=1;options.controller.update_interval_ms=5;
    options.controller.cooldown_ms=20;options.controller.step_slots=2;
    const auto fixed=ExperimentRunner::runOne(experiment,AllocationStrategy::FixedEqual,options);
    const auto adaptive=ExperimentRunner::runOne(experiment,AllocationStrategy::Adaptive,options);
    assert(fixed.success&&adaptive.success&&fixed.workload_equivalent&&adaptive.workload_equivalent);
    assert(fixed.input_fingerprint==adaptive.input_fingerprint);
    assert(fixed.summary.total_bytes==adaptive.summary.total_bytes&&fixed.summary.total_consumed==70);
    assert(adaptive.resize_successful>0&&capacity(adaptive.final_allocations,0)>8);
    assert(capacity(fixed.final_allocations,0)==8&&capacity(fixed.final_allocations,1)==8);
    size_t sum=0;for(const auto& a:adaptive.final_allocations)sum+=a.capacity;assert(sum<=16);
    assert(adaptive.consumer_wait_ms>=0&&std::isfinite(adaptive.average_utilization_pct));
    for(const auto& config:adaptive.configs)assert(config.random_seed==config.workload.seed);
    assert(adaptive.final_snapshot.final_sample);
}
void empty_workload_and_invalid_options() {
    auto experiment=simple_case();ExperimentRunOptions options;options.request_count=0;
    const auto zero=ExperimentRunner::runOne(experiment,AllocationStrategy::FixedEqual,options);
    assert(zero.success&&zero.summary.total_produced==0&&zero.summary.total_consumed==0);
    assert(zero.p50_latency_upper_ms==0&&zero.p95_latency_upper_ms==0);
    options.metrics={0,10};
    bool failed=false;
    try { const auto bad=ExperimentRunner::runOne(experiment,AllocationStrategy::FixedEqual,options);failed=!bad.success; }
    catch(const std::exception&) {failed=true;}
    assert(failed);
    auto malformed=experiment;
    malformed.streams[0].use_workload_config=true;
    malformed.streams[0].workload.amplitude_pct=std::numeric_limits<double>::quiet_NaN();
    options.metrics={5,10};
    const auto rejected=ExperimentRunner::runOne(malformed,AllocationStrategy::FixedEqual,options);
    assert(!rejected.success);
    const auto serialized=rejected.toJson();
    assert(serialized.find(":nan")==std::string::npos&&serialized.find(":inf")==std::string::npos);
    ConfigParser::parseString(serialized);
}
}
int main() {
    equal_allocation_constraints();normalized_case_and_seed_reproducibility();
    heterogeneous_workload_equivalence_and_real_adaptation();empty_workload_and_invalid_options();
    std::cout<<"ALL 4 EXPERIMENT RUNNER TEST GROUPS PASSED!\n";
}
