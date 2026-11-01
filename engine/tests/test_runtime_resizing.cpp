#include "RuntimeResizeExecutor.h"
#include "Simulation.h"
#include "MetricsEngine.h"
#include <cassert>
#include <future>
#include <iostream>
#include <limits>
#include <memory>
#include <atomic>
#include <cmath>

namespace {
AllocationDecision decision(uint64_t sequence, std::initializer_list<AllocationRecommendation> changes) {
    AllocationDecision d;d.valid=true;d.evaluated=true;d.snapshot_sequence=sequence;d.streams=changes;return d;
}
void integrity(BoundedBuffer& buffer, uint64_t first, uint64_t last) {
    for(uint64_t expected=first;expected<=last;++expected) {
        Request r;assert(buffer.pop(r));assert(r.getId()==expected);
    }
}
void growth_shrink_wrapped_fifo() {
    BufferResourceManager rm(16);
    BoundedBuffer a(4),b(4);
    assert(rm.registerStream(0,4)&&rm.registerStream(1,4));
    RuntimeResizeExecutor executor(rm,{{0,&a,1,12},{1,&b,1,12}});
    for(uint64_t i=1;i<=4;++i)assert(a.push(Request(i,64)));
    integrity(a,1,2);
    assert(a.push(Request(5,64))&&a.push(Request(6,64)));
    const auto grew=executor.apply(decision(1,{{0,4,8,"grow"},{1,4,4,"hold"}}));
    assert(grew.success&&!grew.stale&&a.capacity()==8&&rm.getStreamCapacity(0)==8);
    assert(grew.streams.size()==2);
    for(const auto& r:grew.streams) {
        if(r.stream_id==0)assert(r.previous_capacity==4&&r.requested_capacity==8&&r.actual_capacity==8);
    }
    integrity(a,3,6);
    assert(a.push(Request(7,64))&&a.push(Request(8,64)));
    const auto shrank=executor.apply(decision(2,{{0,8,2,"shrink"},{1,4,4,"hold"}}));
    assert(shrank.success&&a.capacity()==2&&rm.getStreamCapacity(0)==2);
    integrity(a,7,8);
    assert(a.push(Request(9,64)));integrity(a,9,9);
    assert(rm.getTotalAllocated()==6);
}
void occupied_shrink_is_atomic_and_retryable() {
    BufferResourceManager rm(8);BoundedBuffer a(4),b(4);
    assert(rm.registerStream(0,4)&&rm.registerStream(1,4));
    RuntimeResizeExecutor executor(rm,{{0,&a,1,8},{1,&b,1,8}});
    for(uint64_t i=1;i<=3;++i)assert(a.push(Request(i,64)));
    const auto d=decision(1,{{0,4,2,"donate"},{1,4,6,"receive"}});
    const auto deferred=executor.apply(d);
    assert(!deferred.success&&deferred.deferred&&!deferred.reason.empty());
    assert(a.capacity()==4&&b.capacity()==4&&rm.getTotalAllocated()==8);
    integrity(a,1,1);
    const auto applied=executor.apply(d);
    assert(applied.success&&a.capacity()==2&&b.capacity()==6);
    assert(rm.getStreamCapacity(0)==2&&rm.getStreamCapacity(1)==6);
    integrity(a,2,3);
    const auto replay=executor.apply(d);assert(!replay.success&&replay.stale);
}
void growth_wakes_blocked_producer() {
    BufferResourceManager rm(8);BoundedBuffer a(2);assert(rm.registerStream(0,2));
    RuntimeResizeExecutor executor(rm,{{0,&a,1,8}});
    assert(a.push(Request(1,1))&&a.push(Request(2,1)));
    auto push=std::async(std::launch::async,[&]{return a.push(Request(3,1));});
    const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(2);
    while(a.observe().full_events==0 && std::chrono::steady_clock::now()<deadline)
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
    assert(a.observe().full_events>0);
    const auto result=executor.apply(decision(1,{{0,2,4,"grow"}}));
    assert(result.success);
    assert(push.wait_for(std::chrono::seconds(2))==std::future_status::ready&&push.get());
    integrity(a,1,3);
}
void invalid_stale_bound_and_failure_cases() {
    BufferResourceManager rm(8);BoundedBuffer a(4);assert(rm.registerStream(0,4));
    RuntimeResizeExecutor executor(rm,{{0,&a,2,8}});
    bool duplicate_executor=false;
    try { RuntimeResizeExecutor other(rm,{{0,&a,2,8}}); }
    catch(const std::exception&) { duplicate_executor=true; }
    assert(duplicate_executor);
    assert(!rm.requestResize(0,5));
    assert(!rm.registerStream(1,2));
    assert(!rm.unregisterStream(0));
    bool reset_rejected=false;try {rm.reset();}catch(const std::exception&){reset_rejected=true;}
    assert(reset_rejected);
    assert(!executor.apply(decision(1,{{0,4,1,"below minimum"}})).success);
    assert(!executor.apply(decision(1,{{0,4,9,"above maximum"}})).success);
    assert(!executor.apply(decision(1,{{0,3,5,"outdated current"}})).success);
    assert(!executor.apply(decision(1,{{1,4,5,"unknown"}})).success);
    assert(!executor.apply(decision(1,{{0,4,5,"one"},{0,4,5,"duplicate"}})).success);
    auto invalid=decision(1,{{0,4,5,"invalid"}});invalid.valid=false;
    assert(!executor.apply(invalid).success);
    invalid.valid=true;invalid.evaluated=false;assert(!executor.apply(invalid).success);
    assert(executor.apply(decision(2,{{0,4,5,"valid"}})).success);
    assert(executor.apply(decision(1,{{0,5,4,"old sequence"}})).stale);
    assert(a.capacity()==5&&rm.getStreamCapacity(0)==5);

    BufferResourceManager huge(std::numeric_limits<size_t>::max());BoundedBuffer small(2);
    assert(huge.registerStream(0,2));
    RuntimeResizeExecutor huge_executor(huge,{{0,&small,1,std::numeric_limits<size_t>::max()}});
    const auto failed=huge_executor.apply(decision(1,{{0,2,std::numeric_limits<size_t>::max(),"allocation failure"}}));
    assert(!failed.success&&!failed.reason.empty());
    assert(small.capacity()==2&&huge.getStreamCapacity(0)==2);
}
void concurrent_attempts_and_closure() {
    BufferResourceManager rm(16);BoundedBuffer a(4);assert(rm.registerStream(0,4));
    RuntimeResizeExecutor executor(rm,{{0,&a,1,16}});
    const auto d=decision(1,{{0,4,8,"concurrent"}});
    std::promise<void> begin;auto ready=begin.get_future().share();
    auto attempt=[&]{ready.wait();return executor.apply(d);};
    auto x=std::async(std::launch::async,attempt),y=std::async(std::launch::async,attempt);
    begin.set_value();const auto first=x.get(),second=y.get();
    assert(first.success!=second.success);
    assert((first.success||first.deferred||first.stale)&&(second.success||second.deferred||second.stale));
    assert(a.capacity()==8&&rm.getStreamCapacity(0)==8);
    a.close();const auto closed=executor.apply(decision(2,{{0,8,4,"closed"}}));
    assert(!closed.success&&a.capacity()==8&&rm.getStreamCapacity(0)==8);
    Request r;assert(!a.pop(r));assert(!a.push(Request(1,1)));
    // Close and resize race on the same queue: either ordering must preserve drain.
    for(size_t repeat=0;repeat<20;++repeat) {
        BufferResourceManager closing_rm(8);BoundedBuffer closing(4);
        assert(closing_rm.registerStream(0,4));
        RuntimeResizeExecutor closing_executor(closing_rm,{{0,&closing,1,8}});
        for(uint64_t id=1;id<=4;++id) assert(closing.push(Request(id,16)));
        std::promise<void> race;auto start=race.get_future().share();
        auto resize=std::async(std::launch::async,[&]{start.wait();return closing_executor.apply(decision(1,{{0,4,8,"close race"}}));});
        auto shutdown=std::async(std::launch::async,[&]{start.wait();closing.close();});
        race.set_value();const auto outcome=resize.get();shutdown.get();
        assert(outcome.success||outcome.deferred);
        assert(closing.isClosed()&&closing.capacity()==closing_rm.getStreamCapacity(0));
        integrity(closing,1,4);Request end;assert(!closing.pop(end));
    }

}
void concurrent_fifo_stress_and_shutdown() {
    BufferResourceManager rm(32);BoundedBuffer a(8);assert(rm.registerStream(0,8));
    RuntimeResizeExecutor executor(rm,{{0,&a,1,32}});
    const size_t count=10000;
    std::promise<void> begin;auto ready=begin.get_future().share();
    auto producer=std::async(std::launch::async,[&]{ready.wait();for(size_t i=1;i<=count;++i)assert(a.push(Request(i,32)));a.close();});
    auto consumer=std::async(std::launch::async,[&]{ready.wait();Request r;size_t expected=1;while(a.pop(r)){assert(r.getId()==expected++);}return expected-1;});
    begin.set_value();size_t applied=0,deferred=0;
    for(uint64_t sequence=1;sequence<=1000;++sequence) {
        const size_t current=rm.getStreamCapacity(0),target=(sequence%2)?16:4;
        const auto result=executor.apply(decision(sequence,{{0,current,target,"stress"}}));
        applied+=result.success;deferred+=result.deferred;
        assert(rm.getTotalAllocated()<=32);
    }
    assert(producer.wait_for(std::chrono::seconds(10))==std::future_status::ready);producer.get();
    assert(consumer.wait_for(std::chrono::seconds(10))==std::future_status::ready);
    assert(consumer.get()==count);
    assert(applied>0);assert(a.capacity()==rm.getStreamCapacity(0));
    assert(a.observe().produced==count);
    std::cout<<"Stress: "<<count<<" FIFO requests, "<<applied<<" applied, "<<deferred<<" deferred\n";
}
void controller_metrics_executor_closed_loop() {
    auto rm=std::make_shared<BufferResourceManager>(16);StreamManager manager;
    manager.setResourceManager(rm);
    IOStreamConfig config;config.stream_id=0;config.buffer_capacity=2;config.num_requests=80;
    config.producer_interval_ms=0;config.consumer_processing_ms=2;
    auto& stream=manager.addStream(config);assert(rm->registerStream(0,2));
    RuntimeResizeExecutor executor(*rm,{{0,&stream.getBuffer(),1,16}});
    ControllerConfig policy;policy.confirmation_windows=1;policy.update_interval_ms=5;policy.cooldown_ms=0;policy.step_slots=2;
    AdaptiveController controller(policy);size_t changes=0;size_t max_observed=2;
    MetricsEngine metrics(manager,{5,10},[&](const MetricsSnapshot& snapshot){
        for(const auto& o:snapshot.streams)max_observed=std::max(max_observed,o.totals.capacity);
        const auto recommendation=controller.evaluate(snapshot,*rm,{{0,1,16}});
        assert(recommendation.valid);
        if(recommendation.evaluated&&recommendation.changed()) {
            const auto result=executor.apply(recommendation);
            if(result.success)++changes;
            else assert(!result.reason.empty());
        }
    });
    metrics.start();manager.startAll();manager.joinAll();metrics.stop();
    assert(changes>0&&max_observed>2);
    assert(stream.getBuffer().capacity()==rm->getStreamCapacity(0));
    assert(metrics.latest().global.totals.consumed==80);
    const auto summary=stream.getMetrics(1.0);
    assert(summary.buffer_capacity==stream.getBuffer().capacity());
    std::cout<<"Closed loop: "<<changes<<" physical changes, final capacity "<<stream.getBuffer().capacity()<<"\n";
}
void simulation_adaptive_integration() {
    SimulationConfig config;config.num_streams=1;config.buffer_capacity=2;
    config.capacity_explicitly_set=true;config.global_buffer_budget=16;
    config.num_requests=100;config.producer_interval_ms=0;config.consumer_processing_ms=2;
    config.min_payload_bytes=config.max_payload_bytes=64;
    Simulation simulation(config);simulation.setMetricsConfig({5,10});
    ControllerConfig policy;policy.confirmation_windows=1;policy.update_interval_ms=5;
    policy.cooldown_ms=20;policy.step_slots=2;
    simulation.enableAdaptive(policy,{{0,1,16}});
    size_t successful=0;size_t maximum=2;
    simulation.setResizeCallback([&](const ResizeResult& result){
        assert(!result.reason.empty());
        if(result.success) {
            ++successful;
            for(const auto& r:result.streams)assert(r.actual_capacity==r.requested_capacity);
        }
    });
    simulation.setMetricsCallback([&](const MetricsSnapshot& snapshot){
        for(const auto& o:snapshot.streams)maximum=std::max(maximum,o.totals.capacity);
    });
    const auto summary=simulation.run();
    assert(summary.success&&summary.total_produced==100&&summary.total_consumed==100&&summary.total_bytes==6400);
    assert(successful>0&&maximum>2);
    assert(summary.stream_metrics.size()==1);
    assert(summary.stream_metrics[0].buffer_capacity==simulation.getResourceManager().getStreamCapacity(0));
    assert(simulation.latestMetrics().final_sample);
    assert(simulation.latestMetrics().streams[0].totals.capacity==summary.stream_metrics[0].buffer_capacity);
    const auto again=simulation.run();
    assert(again.success&&again.total_consumed==100&&again.total_bytes==6400);
    assert(again.stream_metrics[0].buffer_capacity==simulation.getResourceManager().getStreamCapacity(0));
    std::cout<<"Simulation adaptive: "<<successful<<" successful resizes, peak observed capacity "<<maximum<<"\n";
}
void capacity_time_weighted_utilization() {
    auto rm=std::make_shared<BufferResourceManager>(8);StreamManager manager;
    manager.setResourceManager(rm);
    IOStreamConfig config;config.stream_id=0;config.buffer_capacity=2;config.num_requests=0;
    auto& stream=manager.addStream(config);assert(rm->registerStream(0,2));
    auto& buffer=stream.getBuffer();RuntimeResizeExecutor executor(*rm,{{0,&buffer,1,8}});
    MetricsEngine monitor(manager,{1000,1000});
    monitor.start();const auto baseline=monitor.latest();
    assert(buffer.push(Request(1,64))&&buffer.push(Request(2,64)));
    const auto resize=executor.apply(decision(1,{{0,2,4,"capacity time"}}));assert(resize.success);
    integrity(buffer,1,1);monitor.stop();const auto final=monitor.latest();
    const double occupied=final.global.totals.occupancy_ns-baseline.global.totals.occupancy_ns;
    const double capacity_time=final.global.totals.capacity_ns-baseline.global.totals.capacity_ns;
    assert(capacity_time>0&&occupied>=0);
    const double expected=occupied*100/capacity_time;
    assert(std::abs(final.global.utilization_pct-expected)<1e-9);
    assert(final.global.utilization_pct>=0&&final.global.utilization_pct<=100);
    assert(buffer.capacity()==4&&rm->getStreamCapacity(0)==4);
    integrity(buffer,2,2);
}
}
int main(){
    growth_shrink_wrapped_fifo();occupied_shrink_is_atomic_and_retryable();growth_wakes_blocked_producer();
    invalid_stale_bound_and_failure_cases();concurrent_attempts_and_closure();
    concurrent_fifo_stress_and_shutdown();controller_metrics_executor_closed_loop();simulation_adaptive_integration();capacity_time_weighted_utilization();
    std::cout<<"ALL 9 RUNTIME RESIZING TEST GROUPS PASSED!\n";
}
