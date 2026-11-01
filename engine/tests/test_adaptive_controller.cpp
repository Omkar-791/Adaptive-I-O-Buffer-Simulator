#include "AdaptiveController.h"
#include "Simulation.h"
#include <cassert>
#include <cmath>
#include <iostream>
#include <limits>
#include <set>
#include <algorithm>

namespace {
StreamObservation observation(uint32_t id, size_t capacity, bool hot) {
    StreamObservation o;
    o.stream_id=id; o.totals.capacity=capacity;
    o.totals.occupancy=hot ? capacity : 0;
    o.avg_occupancy_slots=hot ? capacity*0.9 : 0;
    o.utilization_pct=hot ? 90 : 0;
    o.producer_wait_ms=hot ? 30 : 0;
    o.consumer_wait_ms=hot ? 0 : 50;
    o.throughput_req_per_sec=hot ? 100 : 0;
    return o;
}
MetricsSnapshot sample(uint64_t sequence, std::vector<StreamObservation> streams) {
    MetricsSnapshot s;
    s.sequence=sequence; s.elapsed_ms=sequence*100.0; s.window_ms=100;
    s.streams=std::move(streams);
    return s;
}
size_t desired(const AllocationDecision& d, uint32_t id) {
    for(const auto& stream:d.streams) if(stream.stream_id==id) return stream.desired_capacity;
    assert(false); return 0;
}
void invariants(const AllocationDecision& d, size_t budget, const std::vector<StreamLimits>& limits) {
    assert(d.valid);
    size_t total=0;
    std::set<uint32_t> ids;
    for(const auto& stream:d.streams) {
        assert(ids.insert(stream.stream_id).second);
        auto it=std::find_if(limits.begin(),limits.end(),[&](const StreamLimits& l){return l.stream_id==stream.stream_id;});
        assert(it!=limits.end());
        assert(stream.desired_capacity>=it->min_capacity && stream.desired_capacity<=it->max_capacity);
        assert(stream.desired_capacity<=budget-total); total+=stream.desired_capacity;
        assert(!stream.reason.empty());
    }
    assert(total<=budget);
}
ControllerConfig immediate() {
    ControllerConfig c; c.confirmation_windows=1; c.cooldown_ms=0; return c;
}
void invalid_and_empty() {
    for(int kind=0;kind<7;++kind) {
        auto c=immediate();
        if(kind==0)c.confirmation_windows=0;
        if(kind==1)c.step_slots=0;
        if(kind==2)c.update_interval_ms=0;
        if(kind==3)c.cooldown_ms=-1;
        if(kind==4)c.low_utilization_pct=c.high_utilization_pct;
        if(kind==5)c.producer_pressure_ratio=std::numeric_limits<double>::quiet_NaN();
        if(kind==6)c.consumer_idle_ratio=2;
        bool threw=false;try {AdaptiveController controller(c);}catch(const std::invalid_argument&){threw=true;}
        assert(threw);
    }
    AdaptiveController empty_controller(immediate());
    auto empty=empty_controller.evaluate(sample(1,{}),{},0,{});
    AdaptiveController controller(immediate());
    assert(empty.valid && !empty.changed());
    const auto s=sample(1,{observation(0,8,true)});
    assert(!controller.evaluate(s,{{0,8}},7,{{0,1,16}}).valid);
    assert(!controller.evaluate(s,{{0,8}},16,{{0,9,16}}).valid);
    assert(!controller.evaluate(s,{{0,8}},16,{{0,0,16}}).valid);
    assert(!controller.evaluate(s,{{0,8}},16,{{0,9,2}}).valid);
    assert(!controller.evaluate(s,{{0,8},{0,8}},16,{{0,1,16}}).valid);
    assert(!controller.evaluate(s,{{1,8}},16,{{1,1,16}}).valid);
    auto bad=s;bad.streams[0].producer_wait_ms=std::numeric_limits<double>::infinity();
    assert(!controller.evaluate(bad,{{0,8}},16,{{0,1,16}}).valid);
    assert(!controller.evaluate(s,{{0,8}},16,{{0,17,17}}).valid);
    auto negative=s;negative.streams[0].utilization_pct=-1;
    assert(!controller.evaluate(negative,{{0,8}},16,{{0,1,16}}).valid);
    // Invalid input must not consume the snapshot sequence or mutate confirmation state.
    const auto good=controller.evaluate(s,{{0,8}},16,{{0,1,16}});
    assert(good.valid && good.evaluated && desired(good,0)>8);
}
void pressure_and_consumer_idle() {
    auto c=immediate();
    AdaptiveController controller(c);
    std::vector<StreamLimits> limits{{0,1,16},{1,1,16}};
    const auto d=controller.evaluate(sample(1,{observation(0,8,true),observation(1,8,false)}),{{0,8},{1,8}},16,limits);
    invariants(d,16,limits);
    assert(desired(d,0)>8 && desired(d,1)<8);
    // Empty-queue consumer waiting must never cause growth.
    AdaptiveController idle(c);
    const auto low=idle.evaluate(sample(1,{observation(0,8,false)}),{{0,8}},16,{{0,1,16}});
    assert(low.valid && desired(low,0)<8);
    AdaptiveController full(c);
    const auto limited=full.evaluate(sample(1,{observation(0,8,true)}),{{0,8}},8,{{0,1,8}});
    assert(limited.valid && !limited.changed());
    AdaptiveController floor(c);
    const auto minimum=floor.evaluate(sample(1,{observation(0,1,false)}),{{0,1}},8,{{0,1,8}});
    assert(minimum.valid && !minimum.changed());
}
void confirmation_stale_and_cooldown() {
    ControllerConfig c;c.confirmation_windows=2;
    AdaptiveController controller(c);
    const std::vector<StreamAllocation> a{{0,8}};
    const std::vector<StreamLimits> l{{0,1,16}};
    auto s=sample(1,{observation(0,8,true)});
    assert(!controller.evaluate(s,a,16,l).changed());
    assert(!controller.evaluate(s,a,16,l).evaluated);
    auto same_time=s;same_time.sequence=2;
    assert(!controller.evaluate(same_time,a,16,l).evaluated);
    const auto change=controller.evaluate(sample(3,{observation(0,8,true)}),a,16,l);
    assert(change.valid && desired(change,0)>8);
    // Opposite signal immediately after a recommendation cannot reverse it.
    const auto next=controller.evaluate(sample(4,{observation(0,8,false)}),a,16,l);
    assert(!next.changed());
    controller.reset();
    assert(!controller.evaluate(s,a,16,l).changed());
    // A single burst followed by neutral utilization breaks confirmation.
    auto neutral=observation(0,8,true);neutral.utilization_pct=50;neutral.avg_occupancy_slots=4;neutral.producer_wait_ms=0;
    assert(!controller.evaluate(sample(2,{neutral}),a,16,l).changed());
    assert(!controller.evaluate(sample(3,{observation(0,8,true)}),a,16,l).changed());
}
void nonoverlap_baseline_final_and_capacity_mismatch() {
    AdaptiveController controller(immediate());
    auto s=sample(1,{observation(0,8,true)});
    const std::vector<StreamAllocation> a{{0,8}};const std::vector<StreamLimits> l{{0,1,16}};
    s.window_ms=0;assert(!controller.evaluate(s,a,16,l).changed());
    s.window_ms=100;s.final_sample=true;assert(!controller.evaluate(s,a,16,l).changed());
    s.final_sample=false;s.sequence=2;s.elapsed_ms=200;
    assert(controller.evaluate(s,a,16,l).changed());
    s.sequence=3;s.elapsed_ms=250;
    assert(!controller.evaluate(s,a,16,l).evaluated);
    AdaptiveController mismatch(immediate());
    const auto noapply=mismatch.evaluate(sample(1,{observation(0,8,true)}),{{0,12}},16,l);
    assert(noapply.valid && !noapply.changed());
}
void fairness_determinism_and_budget_sweep() {
    const auto c=immediate();
    std::vector<StreamAllocation>a{{0,8},{1,8}};
    std::vector<StreamLimits>l{{0,1,16},{1,1,16}};
    AdaptiveController x(c),y(c);
    std::set<uint32_t> winners;
    for(uint64_t sequence=1;sequence<=4;++sequence) {
        auto s=sample(sequence,{observation(0,8,true),observation(1,8,true)});
        auto d=x.evaluate(s,a,17,l);auto e=y.evaluate(s,a,17,l);
        invariants(d,17,l);assert(d.changed()==e.changed());
        for(const auto&r:d.streams) {assert(r.desired_capacity==desired(e,r.stream_id));if(r.desired_capacity>8)winners.insert(r.stream_id);}
    }
    assert(winners.size()==2);
    AdaptiveController steady;
    auto neutral=observation(0,8,true);neutral.utilization_pct=50;
    neutral.avg_occupancy_slots=4;neutral.producer_wait_ms=0;
    for(uint64_t sequence=1;sequence<=20;++sequence)
        assert(!steady.evaluate(sample(sequence,{neutral}),{{0,8}},16,{{0,1,16}}).changed());
    for(size_t budget=16;budget<=32;++budget) {
        AdaptiveController controller(c);
        const auto d=controller.evaluate(sample(1,{observation(0,8,true),observation(1,8,true)}),a,budget,l);
        invariants(d,budget,l);
    }
}
void boundary_budget_ordering_and_resource_manager() {
    const auto c=immediate();
    auto s=sample(1,{observation(0,8,true),observation(1,8,false)});
    s.streams[1].totals.occupancy=7;
    const std::vector<StreamAllocation> allocation{{0,8},{1,8}};
    const std::vector<StreamLimits> limits{{0,1,16},{1,1,16}};
    AdaptiveController controller(c);
    const auto floor=controller.evaluate(s,allocation,16,limits);
    assert(floor.valid && desired(floor,0)==9 && desired(floor,1)==7);
    AdaptiveController ordered(c),reordered(c);
    const auto first=ordered.evaluate(s,allocation,16,limits);
    std::reverse(s.streams.begin(),s.streams.end());
    const auto other=reordered.evaluate(s,{{1,8},{0,8}},16,{{1,1,16},{0,1,16}});
    for(const auto& r:first.streams) assert(r.desired_capacity==desired(other,r.stream_id));
    AdaptiveController invalid(c);
    auto duplicate=s;duplicate.streams.push_back(duplicate.streams.front());
    assert(!invalid.evaluate(duplicate,allocation,16,limits).valid);
    assert(!invalid.evaluate(s,allocation,16,{{0,1,16},{0,1,16}}).valid);

    BufferResourceManager manager(16,2);
    assert(manager.registerStream(0,8));
    AdaptiveController integrated(c);
    const auto one=sample(1,{observation(0,8,true)});
    assert(!integrated.evaluate(one,manager,{{0,1,16}}).valid);
    const auto recommendation=integrated.evaluate(one,manager,{{0,2,16}});
    assert(recommendation.valid && desired(recommendation,0)==12);
    assert(manager.getStreamCapacity(0)==8 && manager.getFreeBudget()==8);

    auto huge_config=immediate();huge_config.step_slots=std::numeric_limits<size_t>::max();
    AdaptiveController huge(huge_config);
    const size_t maximum=std::numeric_limits<size_t>::max();
    const auto extreme=huge.evaluate(one,{{0,8}},maximum,{{0,1,maximum}});
    assert(extreme.valid && desired(extreme,0)==maximum);

    // Applied changes reset confirmation; an old backlog must not immediately reverse growth.
    ControllerConfig stable;stable.confirmation_windows=2;
    AdaptiveController applied(stable);
    const std::vector<StreamLimits> single{{0,1,16}};
    assert(!applied.evaluate(one,{{0,8}},16,single).changed());
    assert(applied.evaluate(sample(2,{observation(0,8,true)}),{{0,8}},16,single).changed());
    assert(!applied.evaluate(sample(3,{observation(0,12,false)}),{{0,12}},16,single).changed());
    assert(!applied.evaluate(sample(8,{observation(0,12,false)}),{{0,12}},16,single).changed());
    const auto settled=applied.evaluate(sample(9,{observation(0,12,false)}),{{0,12}},16,single);
    assert(settled.valid && desired(settled,0)<12);
}
void real_metrics_no_bookkeeping_or_queue_mutation() {
    SimulationConfig config;config.num_streams=2;config.num_requests=30;config.buffer_capacity=2;
    config.producer_interval_ms=0;config.consumer_processing_ms=2;
    Simulation simulation(config);simulation.setMetricsConfig({5,10});
    const auto allocation=simulation.getResourceManager().getAllocations();
    std::vector<StreamLimits> limits{{0,1,8},{1,1,8}};
    auto c=immediate();c.update_interval_ms=5;
    AdaptiveController controller(c);size_t observed=0;
    simulation.setMetricsCallback([&](const MetricsSnapshot& s) {
        const auto d=controller.evaluate(s,allocation,4,limits);
        assert(d.valid);if(d.evaluated)++observed;
        for(const auto&o:s.streams) assert(o.totals.capacity==2);
    });
    const auto result=simulation.run();
    assert(result.success && observed>0);
    for(const auto&a:simulation.getResourceManager().getAllocations()) assert(a.capacity==2);
}
}
int main() {
    invalid_and_empty();pressure_and_consumer_idle();confirmation_stale_and_cooldown();
    nonoverlap_baseline_final_and_capacity_mismatch();fairness_determinism_and_budget_sweep();
    boundary_budget_ordering_and_resource_manager();real_metrics_no_bookkeeping_or_queue_mutation();
    std::cout << "ALL 7 ADAPTIVE CONTROLLER TEST GROUPS PASSED!\n";
}
