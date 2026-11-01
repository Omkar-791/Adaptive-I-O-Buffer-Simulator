#ifndef ADAPTIVE_IO_EXPERIMENT_RUNNER_H
#define ADAPTIVE_IO_EXPERIMENT_RUNNER_H
#include "ConfigParser.h"
#include <optional>
enum class AllocationStrategy { FixedEqual, Adaptive };
struct ExperimentCase {
    std::string name;
    std::vector<IOStreamConfig> streams;
    size_t budget{0};
    std::vector<StreamLimits> limits;
};
struct ExperimentRunOptions {
    uint32_t seed{42};
    size_t repetition{0};
    std::optional<size_t> request_count;
    MetricsConfig metrics{};
    ControllerConfig controller{};
};
struct ExperimentResult {
    AllocationStrategy strategy{AllocationStrategy::FixedEqual};
    std::string workload_name;
    uint32_t seed{42};
    size_t repetition{0};
    std::vector<IOStreamConfig> configs;
    size_t budget{0};
    std::vector<StreamLimits> limits;
    ExperimentRunOptions options{};
    std::vector<StreamAllocation> initial_allocations, final_allocations;
    SimulationMetrics summary{};
    MetricsSnapshot final_snapshot{};
    std::string input_fingerprint;
    bool workload_equivalent{false},success{false},measured{false};
    std::string error;
    size_t resize_successful{0},resize_deferred{0},resize_rejected{0};
    double p50_latency_upper_ms{0},p95_latency_upper_ms{0},consumer_wait_ms{0};
    double average_utilization_pct{0},peak_stream_utilization_pct{0};
    std::string toJson() const;
};
class ExperimentRunner {
public:
    static ExperimentCase makeCase(const ParsedSimulationConfig&,const std::string& name,
        std::optional<size_t> budget = {},size_t min_capacity=1,size_t max_capacity=64);
    static std::vector<StreamAllocation> allocateEqual(size_t budget,const std::vector<StreamLimits>&);
    static ExperimentResult runOne(const ExperimentCase&,AllocationStrategy,const ExperimentRunOptions& = {});
};
#endif
