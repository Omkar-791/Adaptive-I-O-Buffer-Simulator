#ifndef ADAPTIVE_IO_ADAPTIVE_CONTROLLER_H
#define ADAPTIVE_IO_ADAPTIVE_CONTROLLER_H
#include "MetricsEngine.h"
#include "BufferResourceManager.h"
#include <map>
#include <string>
#include <vector>
struct ControllerConfig {
    double high_utilization_pct{80}, low_utilization_pct{30};
    double producer_pressure_ratio{0.05}, producer_idle_ratio{0.01}, consumer_idle_ratio{0.05};
    size_t confirmation_windows{3}, step_slots{4};
    double update_interval_ms{100}, cooldown_ms{500};
};
struct StreamLimits { uint32_t stream_id; size_t min_capacity{1}, max_capacity{64}; };
struct AllocationRecommendation {
    uint32_t stream_id;
    size_t current_capacity, desired_capacity;
    std::string reason;
};
struct AllocationDecision {
    bool valid{true}, evaluated{false};
    std::string reason;
    uint64_t snapshot_sequence{0};
    std::vector<AllocationRecommendation> streams;
    bool changed() const;
};
// Single-coordinator stateful policy. Recommendations never mutate queues or records.
class AdaptiveController {
public:
    explicit AdaptiveController(ControllerConfig config = {});
    AllocationDecision evaluate(const MetricsSnapshot&, const std::vector<StreamAllocation>&,
                                size_t budget, const std::vector<StreamLimits>&);
    AllocationDecision evaluate(const MetricsSnapshot&, const BufferResourceManager&,
                                const std::vector<StreamLimits>&);
    void reset();
private:
    struct State { size_t high{0}, low{0}; double last_change_ms{-1}; size_t last_capacity{0}; };
    ControllerConfig config_;
    std::map<uint32_t, State> state_;
    bool initialized_{false}, sampled_{false};
    uint64_t last_sequence_{0};
    double last_time_ms_{0};
    size_t recipient_cursor_{0};
};
#endif
