#ifndef ADAPTIVE_IO_WORKLOAD_GENERATOR_H
#define ADAPTIVE_IO_WORKLOAD_GENERATOR_H

#include <cstdint>
#include <cstddef>
#include <string>
#include <vector>
#include <random>

/**
 * @brief Categorization of synthetic I/O workload patterns.
 */
enum class WorkloadType {
    STEADY = 0,
    BURST = 1,
    PERIODIC = 2,
    STOCHASTIC = 3,
    MIXED = 4
};

/**
 * @brief Converts a WorkloadType enum to its canonical string representation.
 */
inline std::string workloadTypeToString(WorkloadType type) {
    switch (type) {
        case WorkloadType::STEADY: return "STEADY";
        case WorkloadType::BURST: return "BURST";
        case WorkloadType::PERIODIC: return "PERIODIC";
        case WorkloadType::STOCHASTIC: return "STOCHASTIC";
        case WorkloadType::MIXED: return "MIXED";
        default: return "UNKNOWN";
    }
}

/**
 * @brief Parses a string into a WorkloadType enum.
 * @return true if parsed successfully, false on invalid string.
 */
inline bool stringToWorkloadType(const std::string& str, WorkloadType& out_type) {
    std::string s = str;
    for (auto& c : s) c = static_cast<char>(::toupper(static_cast<unsigned char>(c)));
    if (s == "STEADY" || s == "CONSTANT") {
        out_type = WorkloadType::STEADY;
        return true;
    } else if (s == "BURST") {
        out_type = WorkloadType::BURST;
        return true;
    } else if (s == "PERIODIC") {
        out_type = WorkloadType::PERIODIC;
        return true;
    } else if (s == "STOCHASTIC" || s == "RANDOM") {
        out_type = WorkloadType::STOCHASTIC;
        return true;
    } else if (s == "MIXED" || s == "CUSTOM") {
        out_type = WorkloadType::MIXED;
        return true;
    }
    return false;
}

/**
 * @brief Convenience overload parsing a string into WorkloadType with fallback to STEADY.
 */
inline WorkloadType stringToWorkloadType(const std::string& str) {
    WorkloadType t = WorkloadType::STEADY;
    stringToWorkloadType(str, t);
    return t;
}

/**
 * @brief A single discrete phase within a mixed workload profile.
 */
struct WorkloadPhase {
    std::string name{"PHASE"};
    uint32_t interval_ms{5};
    size_t request_count{50};
    size_t min_payload_bytes{512};
    size_t max_payload_bytes{4096};
};

/**
 * @brief Configuration parameters for synthetic workload generation.
 */
struct WorkloadConfig {
    WorkloadType type{WorkloadType::STEADY};

    // Timing parameters (milliseconds)
    uint32_t base_interval_ms{5};       // Used for STEADY, STOCHASTIC mean, and BURST normal phase
    uint32_t burst_interval_ms{1};      // Used for BURST high-activity phase
    size_t burst_length{20};            // Requests per burst phase
    size_t normal_length{80};           // Requests per normal phase in BURST workload

    // Periodic pattern parameters
    size_t period_length{40};           // Cycle length in requests for periodic oscillation
    double amplitude_pct{50.0};         // Modulation amplitude percentage (0 to 100%)
    std::vector<uint32_t> periodic_intervals_ms{}; // Optional discrete repeating intervals

    // Stochastic Poisson parameter (lambda = 1 / mean_interval_ms)
    double lambda{0.0};

    // Mixed custom phases
    std::vector<WorkloadPhase> phases{};

    // Request payload bounds
    size_t min_payload_bytes{512};
    size_t max_payload_bytes{4096};

    // Deterministic random seed and stream association
    uint32_t seed{42};
    uint32_t stream_id{0};
};

/**
 * @brief Structured specification of a synthesized request decision.
 */
struct WorkloadRequest {
    uint64_t request_id{0};
    size_t payload_bytes{0};
    uint32_t inter_arrival_ms{0};
    std::string phase_name{"DEFAULT"};
};

/**
 * @brief Dedicated subsystem responsible for synthetic I/O workload generation.
 *
 * Determines:
 * 1. WHEN requests occur (inter-arrival interval timing).
 * 2. HOW LARGE requests are (payload sizing).
 * 3. WHAT workload pattern is generated (Steady, Burst, Periodic, Stochastic, Mixed).
 *
 * Fully deterministic when initialized with the same configuration and seed.
 */
class WorkloadGenerator {
public:
    explicit WorkloadGenerator(WorkloadConfig config);

    /**
     * @brief Generates the next request specification in the workload sequence.
     * @param sequence_num Sequential request index.
     * @return WorkloadRequest containing payload size, arrival interval, and phase name.
     */
    WorkloadRequest getNextRequest(uint64_t sequence_num);

    // Accessors
    const WorkloadConfig& getConfig() const noexcept { return config_; }
    WorkloadType getType() const noexcept { return config_.type; }
    uint32_t getStreamId() const noexcept { return config_.stream_id; }
    uint32_t getSeed() const noexcept { return config_.seed; }

    /**
     * @brief Resets the generator PRNG state to its initial seed.
     */
    void reset();

private:
    uint32_t computeInterArrival(uint64_t sequence_num, std::string& out_phase);
    size_t computePayloadBytes(const std::string& current_phase);

    const WorkloadConfig config_;
    std::mt19937 rng_;
    std::exponential_distribution<double> exp_dist_;
};

#endif // ADAPTIVE_IO_WORKLOAD_GENERATOR_H
