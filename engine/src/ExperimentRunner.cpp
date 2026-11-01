#include "ExperimentRunner.h"
#include "WorkloadFingerprint.h"
#include <algorithm>
#include <cmath>
#include <iomanip>
#include <limits>
#include <map>
#include <sstream>
#include <stdexcept>
namespace {
std::string quote(const std::string& value) {
    std::ostringstream out;out << '"';
    for(unsigned char c:value) {
        switch(c) {
        case '"':out << "\\\"";break;case '\\':out << "\\\\";break;
        case '\n':out << "\\n";break;case '\r':out << "\\r";break;case '\t':out << "\\t";break;
        default:if(c<32)out << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(c) << std::dec;
                else out << static_cast<char>(c);
        }
    }
    out << '"';return out.str();
}
std::string compilerName() {
#if defined(_MSC_VER)
    return "MSVC "+std::to_string(_MSC_VER);
#elif defined(__VERSION__)
    return __VERSION__;
#else
    return "unknown";
#endif
}
std::string number(double value) {
    if(!std::isfinite(value))return "null";
    std::ostringstream out;out<<std::setprecision(17)<<value;return out.str();
}
void workloadJson(std::ostream& out,const WorkloadConfig& w) {
    out << "{\"type\":" << quote(workloadTypeToString(w.type))
        << ",\"base_interval_ms\":" << w.base_interval_ms << ",\"burst_interval_ms\":" << w.burst_interval_ms
        << ",\"burst_length\":" << w.burst_length << ",\"normal_length\":" << w.normal_length
        << ",\"period_length\":" << w.period_length << ",\"amplitude_pct\":" << number(w.amplitude_pct)
        << ",\"lambda\":" << number(w.lambda) << ",\"min_payload_bytes\":" << w.min_payload_bytes
        << ",\"max_payload_bytes\":" << w.max_payload_bytes << ",\"seed\":" << w.seed
        << ",\"stream_id\":" << w.stream_id << ",\"periodic_intervals_ms\":[";
    for(size_t i=0;i<w.periodic_intervals_ms.size();++i){if(i)out<<',';out<<w.periodic_intervals_ms[i];}
    out << "],\"phases\":[";
    for(size_t i=0;i<w.phases.size();++i){if(i)out<<',';const auto&p=w.phases[i];
        out << "{\"name\":"<<quote(p.name)<<",\"interval_ms\":"<<p.interval_ms
            <<",\"request_count\":"<<p.request_count<<",\"min_payload_bytes\":"<<p.min_payload_bytes
            <<",\"max_payload_bytes\":"<<p.max_payload_bytes<<'}';}
    out << "]}";
}
WorkloadConfig resolve(const IOStreamConfig& c) {
    WorkloadConfig w=c.workload;
    if(!c.use_workload_config){w=WorkloadConfig{};w.base_interval_ms=c.producer_interval_ms;
        w.min_payload_bytes=c.min_payload_bytes;w.max_payload_bytes=c.max_payload_bytes;}
    w.seed=c.random_seed;w.stream_id=c.stream_id;return w;
}
double quantile(const BufferObservation& totals,double q) {
    if(!totals.consumed)return 0;
    const auto target=static_cast<uint64_t>(std::ceil(q*totals.consumed));uint64_t count=0;
    for(size_t k=0;k<64;++k){count+=totals.latency_histogram[k];if(count>=target)return(std::ldexp(1.0,static_cast<int>(k+1))-1)/1000;}
    throw std::runtime_error("Completion histogram does not match completed request count");
}
void allocationJson(std::ostream& out,const std::vector<StreamAllocation>& allocations){
    out<<'[';for(size_t i=0;i<allocations.size();++i){if(i)out<<',';out<<"{\"stream_id\":"<<allocations[i].stream_id<<",\"capacity\":"<<allocations[i].capacity<<'}';}out<<']';
}
}
std::vector<StreamAllocation> ExperimentRunner::allocateEqual(size_t budget,const std::vector<StreamLimits>& source) {
    auto limits=source;std::sort(limits.begin(),limits.end(),[](const auto&a,const auto&b){return a.stream_id<b.stream_id;});
    size_t minimum=0,upper=0;
    for(size_t i=0;i<limits.size();++i){const auto&l=limits[i];
        if(!l.min_capacity||l.max_capacity<l.min_capacity||(i&&limits[i-1].stream_id==l.stream_id))throw std::invalid_argument("Invalid allocation limits/duplicate stream ID");
        if(l.min_capacity>budget-minimum)throw std::invalid_argument("Budget cannot satisfy all minimum capacities");
        minimum+=l.min_capacity;upper=std::max(upper,l.max_capacity);}
    auto feasible=[&](size_t level){size_t used=0;for(const auto&l:limits){const auto n=std::max(l.min_capacity,std::min(l.max_capacity,level));if(n>budget-used)return false;used+=n;}return true;};
    size_t lower=0;while(lower<upper){const size_t d=upper-lower,m=lower+d/2+d%2;if(feasible(m))lower=m;else upper=m-1;}
    std::vector<StreamAllocation> result;size_t used=0;
    for(const auto&l:limits){const auto n=std::max(l.min_capacity,std::min(l.max_capacity,lower));result.push_back({l.stream_id,n});used+=n;}
    for(size_t i=0;i<result.size()&&used<budget;++i)if(result[i].capacity==lower&&result[i].capacity<limits[i].max_capacity){++result[i].capacity;++used;}
    return result;
}
ExperimentCase ExperimentRunner::makeCase(const ParsedSimulationConfig& parsed,const std::string& name,
    std::optional<size_t> budget,size_t minimum,size_t maximum) {
    ExperimentCase c;c.name=name;
    if(!minimum||maximum<minimum)throw std::invalid_argument("Invalid experiment capacity limits");
    if(parsed.is_heterogeneous)c.streams=parsed.stream_configs;
    else {const auto&s=parsed.sim_config;if(!s.num_streams)throw std::invalid_argument("Experiment requires positive stream count");
        minimum=std::max(minimum,s.min_buffer_capacity);
        for(size_t i=0;i<s.num_streams;++i){if(i>std::numeric_limits<uint32_t>::max())throw std::invalid_argument("Too many streams");
            IOStreamConfig x;x.stream_id=static_cast<uint32_t>(i);x.name="Stream-"+std::to_string(i);x.buffer_capacity=s.buffer_capacity;
            x.num_requests=s.num_requests;x.producer_interval_ms=s.producer_interval_ms;x.consumer_processing_ms=s.consumer_processing_ms;
            x.min_payload_bytes=s.min_payload_bytes;x.max_payload_bytes=s.max_payload_bytes;x.random_seed=s.random_seed;
            x.use_workload_config=s.use_workload_config;x.workload=s.workload;c.streams.push_back(x);}}
    if(c.streams.empty())throw std::invalid_argument("Experiment requires at least one stream");
    if(budget)c.budget=*budget;
    else if(parsed.global_budget)c.budget=parsed.global_budget;
    else if(parsed.sim_config.global_buffer_budget)c.budget=parsed.sim_config.global_buffer_budget;
    else for(const auto&s:c.streams){if(s.buffer_capacity>std::numeric_limits<size_t>::max()-c.budget)throw std::invalid_argument("Budget overflow");c.budget+=s.buffer_capacity;}
    for(const auto&s:c.streams)c.limits.push_back({s.stream_id,minimum,maximum});
    allocateEqual(c.budget,c.limits);return c;
}
ExperimentResult ExperimentRunner::runOne(const ExperimentCase& c,AllocationStrategy strategy,const ExperimentRunOptions& options) {
    ExperimentResult result;result.strategy=strategy;result.workload_name=c.name;result.seed=options.seed;
    result.repetition=options.repetition;result.budget=c.budget;result.options=options;result.limits=c.limits;
    try {
        if(strategy!=AllocationStrategy::FixedEqual&&strategy!=AllocationStrategy::Adaptive)throw std::invalid_argument("Unknown allocation strategy");
        if(c.streams.empty())throw std::invalid_argument("Experiment requires streams");
        result.configs=c.streams;std::sort(result.configs.begin(),result.configs.end(),[](const auto&a,const auto&b){return a.stream_id<b.stream_id;});
        result.initial_allocations=allocateEqual(c.budget,c.limits);
        if(result.initial_allocations.size()!=result.configs.size())throw std::invalid_argument("Limits must match every stream");
        std::map<uint32_t,uint64_t> expected;uint64_t combined=WORKLOAD_FINGERPRINT_OFFSET;
        for(size_t i=0;i<result.configs.size();++i){auto&s=result.configs[i];
            if(s.stream_id!=result.initial_allocations[i].stream_id||(i&&s.stream_id==result.configs[i-1].stream_id))throw std::invalid_argument("Invalid stream IDs/limits membership");
            s.buffer_capacity=result.initial_allocations[i].capacity;
            s.random_seed=static_cast<uint32_t>(options.seed+static_cast<uint32_t>(i)*uint32_t{100});
            if(options.request_count)s.num_requests=*options.request_count;
            s.workload=resolve(s);s.use_workload_config=true;
            if(!std::isfinite(s.workload.amplitude_pct)||!std::isfinite(s.workload.lambda))throw std::invalid_argument("Nonfinite workload configuration");
            WorkloadGenerator generator(s.workload);uint64_t hash=WORKLOAD_FINGERPRINT_OFFSET;
            for(size_t j=0;j<s.num_requests;++j)updateWorkloadFingerprint(hash,generator.getNextRequest(j));
            expected.emplace(s.stream_id,hash);fingerprintInteger(combined,s.stream_id);fingerprintInteger(combined,s.num_requests);fingerprintInteger(combined,hash);
        }
        {std::ostringstream h;h<<std::hex<<std::setw(16)<<std::setfill('0')<<combined;result.input_fingerprint=h.str();}
        Simulation simulation(result.configs,c.budget);simulation.setMetricsConfig(options.metrics);
        if(strategy==AllocationStrategy::Adaptive)simulation.enableAdaptive(options.controller,c.limits);
        simulation.setResizeCallback([&](const ResizeResult&r){if(r.success)++result.resize_successful;else if(r.deferred)++result.resize_deferred;else ++result.resize_rejected;});
        simulation.setMetricsCallback([&](const MetricsSnapshot&s){size_t total=0;
            if(s.streams.size()!=result.initial_allocations.size())throw std::runtime_error("Live stream topology changed");
            for(const auto&o:s.streams){if(o.totals.capacity>c.budget-total)throw std::runtime_error("Live capacities exceed budget");total+=o.totals.capacity;
                const auto it=std::find_if(result.initial_allocations.begin(),result.initial_allocations.end(),[&](const auto&a){return a.stream_id==o.stream_id;});
                if(it==result.initial_allocations.end())throw std::runtime_error("Unknown live stream ID");
                if(strategy==AllocationStrategy::FixedEqual&&o.totals.capacity!=it->capacity)throw std::runtime_error("Fixed allocation changed during execution");}
        });
        result.summary=simulation.run();result.final_snapshot=simulation.latestMetrics();
        result.final_allocations=simulation.getResourceManager().getAllocations();result.workload_equivalent=true;
        for(const auto&s:result.summary.stream_metrics){
            if(s.workload_fingerprint!=expected.at(s.stream_id)||s.total_produced!=s.target_requests)result.workload_equivalent=false;
            result.peak_stream_utilization_pct=std::max(result.peak_stream_utilization_pct,s.max_occupancy_pct);}
        for(const auto& observed:result.final_snapshot.streams) {
            const auto allocation=std::find_if(result.final_allocations.begin(),result.final_allocations.end(),[&](const auto& a){return a.stream_id==observed.stream_id;});
            if(allocation==result.final_allocations.end() || allocation->capacity!=observed.totals.capacity)
                throw std::runtime_error("Physical final capacity disagrees with resource accounting");
        }
        const auto&t=result.final_snapshot.global.totals;
        result.p50_latency_upper_ms=quantile(t,.50);result.p95_latency_upper_ms=quantile(t,.95);
        result.consumer_wait_ms=t.consumer_wait_ns/1e6;
        result.average_utilization_pct=t.capacity_ns>0?t.occupancy_ns/t.capacity_ns*100:0;
        result.measured=true;
        result.success=result.summary.success&&result.workload_equivalent;
        if(!result.success)result.error="Simulation failure or produced workload fingerprint/count mismatch";
    }catch(const std::exception&e){result.success=false;result.error=e.what();}
    return result;
}
std::string ExperimentResult::toJson() const {
    std::ostringstream out;out<<std::setprecision(17);
    out<<"{\"type\":\"experiment_result\",\"schema_version\":1,\"strategy\":"<<quote(strategy==AllocationStrategy::FixedEqual?"fixed_equal":"adaptive")
       <<",\"workload\":"<<quote(workload_name)<<",\"seed\":"<<seed<<",\"repetition\":"<<repetition
       <<",\"stream_count\":"<<configs.size()<<",\"global_buffer_budget\":"<<budget
       <<",\"input_fingerprint\":"<<quote(input_fingerprint)<<",\"workload_equivalent\":"<<(workload_equivalent?"true":"false")
       <<",\"success\":"<<(success?"true":"false")<<",\"error\":"<<quote(error)<<",\"initial_allocations\":";
    allocationJson(out,initial_allocations);out<<",\"final_allocations\":";allocationJson(out,final_allocations);
    out<<",\"actual_final_capacities\":[";
    for(size_t i=0;i<final_snapshot.streams.size();++i) {
        if(i)out<<',';
        const auto& stream=final_snapshot.streams[i];
        out<<"{\"stream_id\":"<<stream.stream_id<<",\"capacity\":"<<stream.totals.capacity<<'}';
    }
    out<<"],\"build\":{\"compiler\":"<<quote(compilerName())<<",\"cplusplus\":"<<__cplusplus<<",\"optimized\":";
#ifdef __OPTIMIZE__
    out<<"true";
#else
    out<<"false";
#endif
    out<<"},\"limits\":[";for(size_t i=0;i<limits.size();++i){if(i)out<<',';const auto&l=limits[i];out<<"{\"stream_id\":"<<l.stream_id<<",\"minimum\":"<<l.min_capacity<<",\"maximum\":"<<l.max_capacity<<'}';}
    out<<"],\"metrics_config\":{\"interval_ms\":"<<options.metrics.interval_ms<<",\"window_ms\":"<<options.metrics.window_ms<<"},\"controller_config\":{";
    const auto&c=options.controller;
    out<<"\"high_utilization_pct\":"<<number(c.high_utilization_pct)<<",\"low_utilization_pct\":"<<number(c.low_utilization_pct)
       <<",\"producer_pressure_ratio\":"<<number(c.producer_pressure_ratio)<<",\"producer_idle_ratio\":"<<number(c.producer_idle_ratio)
       <<",\"consumer_idle_ratio\":"<<number(c.consumer_idle_ratio)<<",\"confirmation_windows\":"<<c.confirmation_windows
       <<",\"step_slots\":"<<c.step_slots<<",\"update_interval_ms\":"<<number(c.update_interval_ms)<<",\"cooldown_ms\":"<<number(c.cooldown_ms)<<"},\"configs\":[";
    size_t requests=0;
    for(size_t i=0;i<configs.size();++i){if(i)out<<',';const auto&s=configs[i];requests+=s.num_requests;
        out<<"{\"stream_id\":"<<s.stream_id<<",\"name\":"<<quote(s.name)<<",\"buffer_capacity\":"<<s.buffer_capacity
           <<",\"num_requests\":"<<s.num_requests<<",\"producer_interval_ms\":"<<s.producer_interval_ms
           <<",\"consumer_processing_ms\":"<<s.consumer_processing_ms<<",\"min_payload_bytes\":"<<s.min_payload_bytes
           <<",\"max_payload_bytes\":"<<s.max_payload_bytes<<",\"random_seed\":"<<s.random_seed<<",\"use_workload_config\":true,\"workload\":";
        workloadJson(out,s.workload);out<<'}';}
    out<<"],\"request_count\":"<<requests<<",\"resize_successful\":"<<resize_successful<<",\"resize_deferred\":"<<resize_deferred
       <<",\"resize_rejected\":"<<resize_rejected<<",\"measurements\":";
    if(!measured)out<<"null";
    else out<<"{\"simulation_duration_sec\":"<<number(summary.simulation_time_sec)<<",\"throughput_req_per_sec\":"<<number(summary.throughput_req_per_sec)
        <<",\"throughput_mb_per_sec\":"<<number(summary.throughput_mb_per_sec)<<",\"avg_latency_ms\":"<<number(summary.avg_latency_ms)
        <<",\"p50_latency_upper_ms\":"<<number(p50_latency_upper_ms)<<",\"p95_latency_upper_ms\":"<<number(p95_latency_upper_ms)
        <<",\"producer_wait_ms\":"<<number(summary.total_producer_wait_ms)<<",\"consumer_wait_ms\":"<<number(consumer_wait_ms)
        <<",\"average_utilization_pct\":"<<number(average_utilization_pct)<<",\"peak_stream_utilization_pct\":"<<number(peak_stream_utilization_pct)
        <<",\"peak_global_utilization_pct\":null,\"total_produced\":"<<summary.total_produced<<",\"total_consumed\":"<<summary.total_consumed
        <<",\"total_bytes\":"<<summary.total_bytes<<'}';
    out<<'}';return out.str();
}
