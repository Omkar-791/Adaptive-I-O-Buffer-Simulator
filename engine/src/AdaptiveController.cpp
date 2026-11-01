#include "AdaptiveController.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <stdexcept>

bool AllocationDecision::changed() const {
    for (const auto& stream : streams)
        if (stream.current_capacity != stream.desired_capacity) return true;
    return false;
}
AdaptiveController::AdaptiveController(ControllerConfig config) : config_(config) {
    auto finite = [](double v) { return std::isfinite(v); };
    if (!finite(config.high_utilization_pct) || !finite(config.low_utilization_pct) ||
        config.low_utilization_pct < 0 || config.high_utilization_pct > 100 ||
        config.low_utilization_pct >= config.high_utilization_pct ||
        !finite(config.producer_pressure_ratio) || !finite(config.producer_idle_ratio) ||
        !finite(config.consumer_idle_ratio) || config.producer_idle_ratio < 0 ||
        config.producer_pressure_ratio <= config.producer_idle_ratio ||
        config.producer_pressure_ratio > 1 || config.consumer_idle_ratio < 0 ||
        config.consumer_idle_ratio > 1 || !config.confirmation_windows || !config.step_slots ||
        !finite(config.update_interval_ms) || config.update_interval_ms <= 0 ||
        !finite(config.cooldown_ms) || config.cooldown_ms < 0)
        throw std::invalid_argument("Invalid adaptive controller configuration");
}
void AdaptiveController::reset() {
    state_.clear(); initialized_=false; sampled_=false; last_sequence_=0;
    last_time_ms_=0; recipient_cursor_=0;
}
AllocationDecision AdaptiveController::evaluate(const MetricsSnapshot& snapshot,
    const std::vector<StreamAllocation>& allocations, size_t budget,
    const std::vector<StreamLimits>& limits) {
    AllocationDecision result;
    result.snapshot_sequence=snapshot.sequence;
    auto invalid = [&](const std::string& reason) {
        result.valid=false; result.reason=reason; return result;
    };
    std::map<uint32_t,StreamAllocation> current;
    std::map<uint32_t,StreamLimits> bounds;
    std::map<uint32_t,const StreamObservation*> observations;
    size_t total=0, minimum=0;
    for (const auto& allocation : allocations) {
        if (!current.emplace(allocation.stream_id,allocation).second)
            return invalid("Duplicate allocation stream ID");
        if (allocation.capacity > budget-total) return invalid("Allocations exceed budget");
        total+=allocation.capacity;
    }
    for (const auto& limit : limits) {
        if (!bounds.emplace(limit.stream_id,limit).second) return invalid("Duplicate limits stream ID");
        if (!limit.min_capacity || limit.max_capacity < limit.min_capacity)
            return invalid("Invalid minimum/maximum stream capacity");
        if (limit.min_capacity > budget-minimum) return invalid("Budget cannot satisfy minimum capacities");
        minimum+=limit.min_capacity;
    }
    const auto nonnegative=[](double value) { return std::isfinite(value) && value>=0; };
    if (!nonnegative(snapshot.elapsed_ms) || !nonnegative(snapshot.window_ms) ||
        snapshot.window_ms > snapshot.elapsed_ms)
        return invalid("Invalid snapshot timing");
    for (const auto& observation : snapshot.streams) {
        if (!observations.emplace(observation.stream_id,&observation).second)
            return invalid("Duplicate observation stream ID");
        if (!observation.totals.capacity || observation.totals.occupancy > observation.totals.capacity ||
            observation.totals.consumed > observation.totals.produced ||
            !nonnegative(observation.utilization_pct) || !nonnegative(observation.avg_occupancy_slots) ||
            !nonnegative(observation.producer_wait_ms) || !nonnegative(observation.consumer_wait_ms) ||
            !nonnegative(observation.throughput_req_per_sec) || !nonnegative(observation.throughput_mb_per_sec) ||
            !nonnegative(observation.avg_latency_ms) || !nonnegative(observation.p50_latency_upper_ms) ||
            !nonnegative(observation.p95_latency_upper_ms) || !nonnegative(observation.totals.latency_sum_ms) ||
            !nonnegative(observation.totals.occupancy_ns))
            return invalid("Malformed stream observations");
    }
    if (current.size()!=bounds.size() || current.size()!=observations.size())
        return invalid("Allocation, limit and observation IDs must match");
    bool capacity_mismatch=false;
    for (const auto& item : current) {
        const auto id=item.first;
        if (!bounds.count(id) || !observations.count(id)) return invalid("Missing stream ID");
        const auto capacity=item.second.capacity;
        if (capacity<bounds.at(id).min_capacity || capacity>bounds.at(id).max_capacity)
            return invalid("Current allocation violates stream bounds");
        if (initialized_ && !state_.count(id)) return invalid("Topology changed; reset controller first");
        capacity_mismatch |= capacity!=observations.at(id)->totals.capacity;
        result.streams.push_back({id,capacity,capacity,"Hold: no accepted observation"});
    }
    if (initialized_ && state_.size()!=current.size()) return invalid("Topology changed; reset controller first");
    if (capacity_mismatch) { result.reason="Hold: allocation records differ from physical queue capacities"; return result; }
    if (snapshot.final_sample || !snapshot.window_ms || !snapshot.sequence) {
        result.reason="Hold: final or baseline observation"; return result;
    }
    if (sampled_ && (snapshot.sequence<=last_sequence_ || snapshot.elapsed_ms<=last_time_ms_)) {
        result.reason="Hold: repeated or stale observation"; return result;
    }
    if (sampled_ && snapshot.elapsed_ms-last_time_ms_ < std::max(config_.update_interval_ms,snapshot.window_ms)) {
        result.reason="Hold: awaiting nonoverlapping observation window"; return result;
    }
    if (!initialized_) {
        for (const auto& item : current) state_.emplace(item.first,State{});
        initialized_=true;
    }
    sampled_=true; last_sequence_=snapshot.sequence; last_time_ms_=snapshot.elapsed_ms;
    result.evaluated=true;
    result.reason="Recommendation only: no allocation records or physical queues changed";
    std::vector<size_t> recipients;
    size_t free=budget-total;
    for (size_t i=0;i<result.streams.size();++i) {
        auto& recommendation=result.streams[i];
        const auto& observation=*observations.at(recommendation.stream_id);
        auto& state=state_.at(recommendation.stream_id);
        if (state.last_capacity != recommendation.current_capacity) {
            state.high=state.low=0;
            state.last_capacity=recommendation.current_capacity;
        }
        if (state.last_change_ms>=0 && snapshot.elapsed_ms-state.last_change_ms<config_.cooldown_ms) {
            state.high=state.low=0; recommendation.reason="Hold: recommendation cooldown"; continue;
        }
        const double producer=observation.producer_wait_ms/snapshot.window_ms;
        const double consumer=observation.consumer_wait_ms/snapshot.window_ms;
        const bool high=observation.utilization_pct>=config_.high_utilization_pct &&
                        producer>=config_.producer_pressure_ratio;
        const bool low=observation.utilization_pct<=config_.low_utilization_pct &&
                       producer<=config_.producer_idle_ratio &&
                       (consumer>=config_.consumer_idle_ratio || observation.throughput_req_per_sec==0);
        state.high=high ? std::min(state.high,config_.confirmation_windows-1)+1 : 0;
        state.low=low ? std::min(state.low,config_.confirmation_windows-1)+1 : 0;
        recommendation.reason="Hold: hysteresis or insufficient confirmation";
        const auto& limit=bounds.at(recommendation.stream_id);
        if (state.low>=config_.confirmation_windows) {
            const size_t floor=std::max(limit.min_capacity,observation.totals.occupancy);
            const size_t release=std::min(config_.step_slots,recommendation.current_capacity-floor);
            if (release) {
                recommendation.desired_capacity-=release; free+=release;
                recommendation.reason=observation.throughput_req_per_sec==0 ?
                    "Reclaim: sustained low utilization, no producer pressure, no completions" :
                    "Reclaim: sustained low utilization and consumer idle waiting despite completed work";
            } else recommendation.reason="Hold: minimum allocation or occupied slots prevent reclaim";
        }
        if (state.high>=config_.confirmation_windows) {
            if (recommendation.current_capacity<limit.max_capacity) recipients.push_back(i);
            else recommendation.reason="Hold: sustained pressure at maximum allocation";
        }
    }
    // Capped integer water filling: binary search avoids work proportional to slot budget.
    if (!recipients.empty()) {
        const size_t start=recipient_cursor_%recipients.size();
        std::vector<size_t> quotas;
        size_t upper=0;
        for (const size_t index : recipients) {
            const auto& recommendation=result.streams[index];
            const size_t quota=std::min(config_.step_slots,
                bounds.at(recommendation.stream_id).max_capacity-recommendation.current_capacity);
            quotas.push_back(quota); upper=std::max(upper,quota);
        }
        auto feasible = [&](size_t level) {
            size_t used=0;
            for (const size_t quota : quotas) {
                const size_t grant=std::min(quota,level);
                if (grant>free-used) return false;
                used+=grant;
            }
            return true;
        };
        size_t lower=0;
        while (lower<upper) {
            const size_t difference=upper-lower;
            const size_t middle=lower+difference/2+difference%2;
            if (feasible(middle)) lower=middle;
            else upper=middle-1;
        }
        for (size_t i=0;i<recipients.size();++i) {
            const size_t grant=std::min(quotas[i],lower);
            result.streams[recipients[i]].desired_capacity+=grant;
            free-=grant;
        }
        for (size_t offset=0;offset<recipients.size() && free;++offset) {
            const size_t i=(start+offset)%recipients.size();
            if (quotas[i]>lower) {
                ++result.streams[recipients[i]].desired_capacity; --free;
            }
        }
        recipient_cursor_=(start+1)%recipients.size();
        for (const size_t index : recipients) {
            auto& recommendation=result.streams[index];
            recommendation.reason=recommendation.desired_capacity>recommendation.current_capacity ?
                "Grow: sustained high utilization and producer blocking; fair budget grant" :
                "Hold: sustained pressure but shared budget exhausted";
        }
    }
    for (const auto& recommendation : result.streams) {
        if (recommendation.desired_capacity!=recommendation.current_capacity) {
            auto& state=state_.at(recommendation.stream_id);
            state.last_change_ms=snapshot.elapsed_ms; state.high=state.low=0;
        }
    }
    return result;
}

AllocationDecision AdaptiveController::evaluate(const MetricsSnapshot& snapshot,
    const BufferResourceManager& manager, const std::vector<StreamLimits>& limits) {
    for (const auto& limit : limits) {
        if (limit.min_capacity < manager.getMinCapacity()) {
            AllocationDecision result;
            result.valid=false; result.snapshot_sequence=snapshot.sequence;
            result.reason="Controller limits cannot relax resource-manager minimum capacity";
            return result;
        }
    }
    return evaluate(snapshot,manager.getAllocations(),manager.getTotalBudget(),limits);
}
