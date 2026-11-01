#include "WorkloadGenerator.h"
#include <algorithm>
#include <cmath>

namespace {
constexpr double PI_VAL = 3.14159265358979323846;

double resolveExpRate(const WorkloadConfig& config) {
    if (config.lambda > 0.0) {
        return config.lambda;
    }
    if (config.base_interval_ms > 0) {
        return 1.0 / static_cast<double>(config.base_interval_ms);
    }
    return 1.0;
}
} // anonymous namespace

WorkloadGenerator::WorkloadGenerator(WorkloadConfig config)
    : config_(config),
      rng_(config.seed),
      exp_dist_(resolveExpRate(config)) {}

void WorkloadGenerator::reset() {
    rng_.seed(config_.seed);
}

WorkloadRequest WorkloadGenerator::getNextRequest(uint64_t sequence_num) {
    WorkloadRequest req;
    req.request_id = sequence_num;
    req.inter_arrival_ms = computeInterArrival(sequence_num, req.phase_name);
    req.payload_bytes = computePayloadBytes(req.phase_name);
    return req;
}

uint32_t WorkloadGenerator::computeInterArrival(uint64_t sequence_num, std::string& out_phase) {
    const size_t idx = static_cast<size_t>(sequence_num);

    switch (config_.type) {
        case WorkloadType::STEADY: {
            out_phase = "STEADY";
            return config_.base_interval_ms;
        }

        case WorkloadType::BURST: {
            const size_t cycle_length = config_.normal_length + config_.burst_length;
            if (cycle_length == 0) {
                out_phase = "STEADY";
                return config_.base_interval_ms;
            }
            const size_t pos_in_cycle = idx % cycle_length;
            if (pos_in_cycle < config_.normal_length) {
                out_phase = "NORMAL";
                return config_.base_interval_ms;
            } else {
                out_phase = "BURST";
                return config_.burst_interval_ms;
            }
        }

        case WorkloadType::PERIODIC: {
            out_phase = "PERIODIC";
            if (!config_.periodic_intervals_ms.empty()) {
                const size_t step_idx = idx % config_.periodic_intervals_ms.size();
                return config_.periodic_intervals_ms[step_idx];
            }
            const size_t period = (config_.period_length > 0) ? config_.period_length : 20;
            const double theta = 2.0 * PI_VAL * static_cast<double>(idx % period) / static_cast<double>(period);
            const double factor = 1.0 + (config_.amplitude_pct / 100.0) * std::sin(theta);
            const double val = static_cast<double>(config_.base_interval_ms) * factor;
            return static_cast<uint32_t>(std::max(0.0, std::round(val)));
        }

        case WorkloadType::STOCHASTIC: {
            out_phase = "STOCHASTIC";
            if (config_.base_interval_ms == 0 && config_.lambda <= 0.0) {
                return 0;
            }
            const double sample = exp_dist_(rng_);
            const double clamped = std::max(0.0, std::min(sample, 1000.0));
            return static_cast<uint32_t>(std::round(clamped));
        }

        case WorkloadType::MIXED: {
            if (config_.phases.empty()) {
                out_phase = "MIXED_STEADY";
                return config_.base_interval_ms;
            }
            size_t total_requests = 0;
            for (const auto& ph : config_.phases) {
                total_requests += ph.request_count;
            }
            if (total_requests == 0) {
                out_phase = "MIXED_DEFAULT";
                return config_.base_interval_ms;
            }
            size_t pos_in_cycle = idx % total_requests;
            size_t accumulated = 0;
            for (const auto& ph : config_.phases) {
                accumulated += ph.request_count;
                if (pos_in_cycle < accumulated) {
                    out_phase = ph.name;
                    return ph.interval_ms;
                }
            }
            out_phase = config_.phases.back().name;
            return config_.phases.back().interval_ms;
        }

        default: {
            out_phase = "DEFAULT";
            return config_.base_interval_ms;
        }
    }
}

size_t WorkloadGenerator::computePayloadBytes(const std::string& current_phase) {
    size_t min_bytes = config_.min_payload_bytes;
    size_t max_bytes = config_.max_payload_bytes;

    if (config_.type == WorkloadType::MIXED) {
        for (const auto& ph : config_.phases) {
            if (ph.name == current_phase) {
                min_bytes = ph.min_payload_bytes;
                max_bytes = ph.max_payload_bytes;
                break;
            }
        }
    }

    if (min_bytes >= max_bytes) {
        return min_bytes;
    }
    std::uniform_int_distribution<size_t> dist(min_bytes, max_bytes);
    return dist(rng_);
}
