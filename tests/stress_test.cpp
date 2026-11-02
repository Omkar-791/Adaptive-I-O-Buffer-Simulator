#include "Simulation.h"
#include <chrono>
#include <csignal>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>
#include <iomanip>
#include <filesystem>
namespace {
// Cooperative writers acquire an atomic sidecar before checking/opening evidence.
// A stale lock is deliberately not stolen; inspect interrupted output first.
class EvidenceLock {
    std::filesystem::path lock_;
    bool owned_{false};
public:
    explicit EvidenceLock(const std::string& output) {
        if(output.empty()) return;
        lock_=std::filesystem::path(output+".writer-lock");
        if(!std::filesystem::create_directory(lock_))
            throw std::runtime_error("Evidence writer lock already exists");
        owned_=true;
    }
    EvidenceLock(const EvidenceLock&)=delete;
    EvidenceLock& operator=(const EvidenceLock&)=delete;
    ~EvidenceLock() {
        if(owned_) {std::error_code error;std::filesystem::remove(lock_,error);}
    }
};
volatile std::sig_atomic_t interrupted = 0;
void interrupt(int) { interrupted = 1; }
size_t integer(const std::string& s, size_t minimum, size_t maximum) {
    if(s.empty() || s.find_first_not_of("0123456789") != std::string::npos) throw std::invalid_argument("Expected bounded nonnegative integer");
    const auto n=std::stoull(s);
    if(n<minimum || n>maximum) throw std::invalid_argument("Value outside safe harness bounds");
    return static_cast<size_t>(n);
}
}
int main(int argc,char** argv) {
 try {
    size_t duration=2, cycles=0, warmup=0; bool full=false, burst=false, requireResize=false;
    std::string strategy="both", output;
    SimulationConfig c; c.num_streams=4;c.buffer_capacity=2;c.num_requests=100;c.producer_interval_ms=0;c.consumer_processing_ms=1;
    c.capacity_explicitly_set=true;c.global_buffer_budget=128;c.min_payload_bytes=c.max_payload_bytes=64;
    MetricsConfig metrics{10,20}; ControllerConfig policy;policy.confirmation_windows=1;policy.update_interval_ms=10;policy.cooldown_ms=20;policy.step_slots=2;
    for(int i=1;i<argc;++i) {
      std::string key=argv[i];
      if(key=="--help") { std::cout<<"stress_test [--duration-seconds 2] [--full-hour] [--cycles N] [--requests N per stream/batch] [--streams N] [--capacity N] [--budget N] [--producer-ms N] [--consumer-ms N] [--strategy fixed|adaptive|both] [--burst] [--require-resize] [--interval-ms N] [--window-ms N] [--step-slots N] [--confirmation-windows N] [--cooldown-ms N] [--warmup-batches N] [--output new.jsonl]\nEach batch uses real Simulation and drains; interruption is honored between bounded batches.\n";return 0; }
      if(key=="--full-hour") { full=true;duration=3600;continue; }
      if(key=="--burst") {burst=true;continue;}
      if(key=="--require-resize") {requireResize=true;continue;}
      if(i+1>=argc)throw std::invalid_argument("Missing option value");
      const std::string value=argv[++i];
      if(key=="--output")output=value;
      else if(key=="--strategy")strategy=value;
      else if(key=="--duration-seconds")duration=integer(value,1,3600);
      else if(key=="--cycles")cycles=integer(value,1,100000);
      else if(key=="--requests")c.num_requests=integer(value,1,1000000);
      else if(key=="--streams")c.num_streams=integer(value,1,32);
      else if(key=="--capacity")c.buffer_capacity=integer(value,1,64);
      else if(key=="--budget")c.global_buffer_budget=integer(value,1,2048);
      else if(key=="--producer-ms")c.producer_interval_ms=static_cast<uint32_t>(integer(value,0,100));
      else if(key=="--consumer-ms")c.consumer_processing_ms=static_cast<uint32_t>(integer(value,0,100));
      else if(key=="--interval-ms")metrics.interval_ms=integer(value,1,1000);
      else if(key=="--window-ms")metrics.window_ms=integer(value,1,10000);
      else if(key=="--step-slots")policy.step_slots=integer(value,1,64);
      else if(key=="--confirmation-windows")policy.confirmation_windows=integer(value,1,100);
      else if(key=="--cooldown-ms")policy.cooldown_ms=static_cast<double>(integer(value,0,10000));
      else if(key=="--warmup-batches")warmup=integer(value,0,100);
      else throw std::invalid_argument("Unknown option: "+key);
    }
    if(duration>60&&!full)throw std::invalid_argument("Runs over 60 seconds require explicit --full-hour consent");
    if(full&&duration!=3600)throw std::invalid_argument("--full-hour requires duration 3600");
    if(full&&cycles)throw std::invalid_argument("--full-hour cannot be shortened by --cycles");
    if(strategy!="fixed"&&strategy!="adaptive"&&strategy!="both")throw std::invalid_argument("Invalid strategy");
    if(c.num_requests*(static_cast<size_t>(c.producer_interval_ms)+c.consumer_processing_ms)>30000)throw std::invalid_argument("Batch configured sleep work exceeds 30 seconds; reduce requests to bound interruption latency");
    if(c.num_streams*c.buffer_capacity>c.global_buffer_budget)throw std::invalid_argument("Initial capacities exceed budget");
    if(metrics.window_ms<metrics.interval_ms)throw std::invalid_argument("Window must cover sample interval");
    policy.update_interval_ms=static_cast<double>(metrics.interval_ms);
    if(burst) {c.use_workload_config=true;c.workload.type=WorkloadType::BURST;c.workload.base_interval_ms=c.producer_interval_ms;c.workload.burst_interval_ms=0;c.workload.normal_length=20;c.workload.burst_length=80;c.workload.min_payload_bytes=c.workload.max_payload_bytes=64;}
    EvidenceLock evidenceLock(output);
    std::ofstream file;
    if(!output.empty()) {
        // symlink_status also refuses dangling links and unreadable existing files.
        const auto status=std::filesystem::symlink_status(output);
        if(status.type()!=std::filesystem::file_type::not_found)
            throw std::invalid_argument("Refusing to overwrite existing evidence");
        file.exceptions(std::ios::badbit|std::ios::failbit);
        file.open(output);
    }
    std::ostream& out=output.empty()?std::cout:file;
    out.exceptions(std::ios::badbit|std::ios::failbit);
    out<<std::setprecision(17);
    std::signal(SIGINT,interrupt);std::signal(SIGTERM,interrupt);
#ifdef _WIN32
    const char* platform="windows";
#elif __APPLE__
    const char* platform="macos";
#else
    const char* platform="linux-or-unix";
#endif
    out<<"{\"type\":\"stress_parameters\",\"platform\":\""<<platform<<"\",\"cplusplus\":"<<__cplusplus<<",\"hardware_threads\":"<<std::thread::hardware_concurrency()<<",\"duration_seconds\":"<<duration<<",\"full_hour\":"<<(full?"true":"false")<<",\"requests_per_stream_batch\":"<<c.num_requests<<",\"streams\":"<<c.num_streams<<",\"capacity\":"<<c.buffer_capacity<<",\"budget\":"<<c.global_buffer_budget<<",\"producer_ms\":"<<c.producer_interval_ms<<",\"consumer_ms\":"<<c.consumer_processing_ms<<",\"interval_ms\":"<<metrics.interval_ms<<",\"window_ms\":"<<metrics.window_ms<<",\"step_slots\":"<<policy.step_slots<<",\"confirmation_windows\":"<<policy.confirmation_windows<<",\"cooldown_ms\":"<<policy.cooldown_ms<<",\"seed\":42,\"burst\":"<<(burst?"true":"false")<<",\"configured_rate_req_per_sec\":";
    if(c.producer_interval_ms==0||burst)out<<"null";else out<<1000.0*c.num_streams/c.producer_interval_ms;
    out<<",\"rate_definition\":\"null means unpaced/intensity workload; achieved throughput is measured\",\"warmup_batches\":"<<warmup<<"}\n";out.flush();
    size_t attempted=0,completed=0,failed=0,resizes=0,batches=0,cycle=0;bool invariant=true;
    auto start=std::chrono::steady_clock::now();
    do {
      for(const std::string mode : {"fixed","adaptive"}) {
        if(interrupted) break;
        if(strategy!="both"&&strategy!=mode) continue;
        Simulation sim(c);sim.setMetricsConfig(metrics);size_t applied=0,deferred=0,rejected=0;
        bool observedInvariants=true;
        if(mode=="adaptive")sim.enableAdaptive(policy);
        sim.setResizeCallback([&](const ResizeResult& r){applied+=r.success;deferred+=r.deferred;rejected+=!r.success&&!r.deferred;out<<r.toJson()<<'\n';out.flush();});
        sim.setMetricsCallback([&](const MetricsSnapshot& s){
            size_t capacities=0;
            for(const auto& stream:s.streams) {
                observedInvariants=observedInvariants&&stream.totals.occupancy<=stream.totals.capacity;
                capacities+=stream.totals.capacity;
            }
            observedInvariants=observedInvariants&&capacities<=c.global_buffer_budget;
            out<<s.toJson()<<'\n';out.flush();
        });
        const auto begin=std::chrono::steady_clock::now();
        SimulationMetrics result;
        try { result=sim.run(); }
        catch(const std::exception&) {
            const auto last=sim.latestMetrics();
            if(cycle>=warmup){attempted+=last.global.totals.produced;completed+=last.global.totals.consumed;resizes+=applied;}
            invariant=false;
            out<<"{\"type\":\"stress_batch_failed\",\"reason\":\"Simulation threw; counts are last observed native snapshot, not a successful final result\",\"last_snapshot\":"<<last.toJson()<<"}\n";out.flush();
            break;
        }
        const double elapsed=std::chrono::duration<double>(std::chrono::steady_clock::now()-begin).count();
        size_t finalCapacities=0;bool allocationMatches=true;
        for(const auto& stream:result.stream_metrics) {
            finalCapacities+=stream.buffer_capacity;
            allocationMatches=allocationMatches&&stream.buffer_capacity==sim.getResourceManager().getStreamCapacity(stream.stream_id);
        }
        const bool ok=observedInvariants&&allocationMatches&&finalCapacities==sim.getResourceManager().getTotalAllocated()&&result.success&&result.total_produced==c.num_requests*c.num_streams&&result.total_consumed==result.total_produced&&sim.getResourceManager().getTotalAllocated()<=c.global_buffer_budget;
        invariant=invariant&&ok;const bool measured=cycle>=warmup;
        if(measured){attempted+=result.total_produced;completed+=result.total_consumed;failed+=result.total_produced>=result.total_consumed?result.total_produced-result.total_consumed:0;resizes+=applied;++batches;}
        out<<"{\"type\":\"stress_batch\",\"cycle\":"<<cycle<<",\"strategy\":\""<<mode<<"\",\"warmup\":"<<(measured?"false":"true")<<",\"measured_elapsed_sec\":"<<elapsed<<",\"achieved_throughput_req_per_sec\":"<<result.total_consumed/elapsed<<",\"resize_applied\":"<<applied<<",\"resize_deferred\":"<<deferred<<",\"resize_rejected\":"<<rejected<<",\"clean_drain\":"<<(ok?"true":"false")<<",\"result\":"<<result.toJson()<<"}\n";out.flush();
      }
      ++cycle;if(cycle==warmup)start=std::chrono::steady_clock::now();
    }while(!interrupted&&invariant&&(!cycles||cycle<cycles+warmup)&&std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count()<duration);
    const double elapsed=std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();
    out<<"{\"type\":\"stress_summary\",\"interrupted\":"<<(interrupted?"true":"false")<<",\"duration_target_reached\":"<<(elapsed>=duration?"true":"false")<<",\"elapsed_sec\":"<<elapsed<<",\"measured_batches\":"<<batches<<",\"attempted_requests\":"<<attempted<<",\"completed_requests\":"<<completed<<",\"failed_requests\":"<<(invariant?std::to_string(failed):"null")<<",\"timed_out_requests\":null,\"rejected_requests\":null,\"achieved_throughput_req_per_sec\":"<<completed/elapsed<<",\"resize_applied\":"<<resizes<<",\"resize_requirement_met\":"<<((!requireResize||resizes>0)?"true":"false")<<",\"clean_drains\":"<<(invariant?"true":"false")<<",\"lifecycle_note\":\"timeout/rejection not provided by in-process Simulation; SIGINT/SIGTERM drain current batch, then stop; duration may overshoot by one strategy cycle\"}\n";out.flush();
    if(file.is_open()) file.close(); // Observe flush/close failures before success.
    return interrupted?130:(invariant&&batches>0&&(!requireResize||resizes>0))?0:1;
 }catch(const std::exception& e){std::cout.exceptions(std::ios::goodbit);std::cerr<<"stress_test: "<<e.what()<<'\n';return 2;}
}
