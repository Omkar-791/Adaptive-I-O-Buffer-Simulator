#ifndef ADAPTIVE_IO_DATA_MODELS_H
#define ADAPTIVE_IO_DATA_MODELS_H

#include <string>
#include <vector>
#include <cstdint>
#include <cstddef>
#include "Metrics.h"
#include "ErrorCodes.h"

/**
 * @brief Current snapshot of a stream's bounded buffer.
 */
struct BufferState {
    uint32_t stream_id{0};
    size_t capacity{0};
    size_t occupancy{0};
    double utilization_pct{0.0};
    bool is_closed{false};

    std::string toJson() const {
        return "{\"type\": \"buffer_state\", \"stream_id\": " + std::to_string(stream_id) +
               ", \"capacity\": " + std::to_string(capacity) +
               ", \"occupancy\": " + std::to_string(occupancy) +
               ", \"utilization_pct\": " + std::to_string(utilization_pct) +
               ", \"is_closed\": " + (is_closed ? "true" : "false") + "}";
    }
};

/**
 * @brief Execution status of an individual I/O stream channel.
 */
enum class StreamStatus {
    IDLE,
    RUNNING,
    DRAINING,
    COMPLETED,
    FAILED
};

inline std::string streamStatusToString(StreamStatus s) {
    switch (s) {
        case StreamStatus::IDLE: return "IDLE";
        case StreamStatus::RUNNING: return "RUNNING";
        case StreamStatus::DRAINING: return "DRAINING";
        case StreamStatus::COMPLETED: return "COMPLETED";
        case StreamStatus::FAILED: return "FAILED";
        default: return "UNKNOWN";
    }
}

/**
 * @brief Complete runtime state snapshot for a single stream.
 */
struct StreamState {
    uint32_t stream_id{0};
    std::string name{"Stream"};
    StreamStatus status{StreamStatus::IDLE};
    BufferState buffer{};
    size_t items_produced{0};
    size_t items_consumed{0};

    std::string toJson() const {
        return "{\"type\": \"stream_state\", \"stream_id\": " + std::to_string(stream_id) +
               ", \"name\": \"" + name + "\"" +
               ", \"status\": \"" + streamStatusToString(status) + "\"" +
               ", \"items_produced\": " + std::to_string(items_produced) +
               ", \"items_consumed\": " + std::to_string(items_consumed) +
               ", \"buffer\": " + buffer.toJson() + "}";
    }
};

/**
 * @brief High-level lifecycle status of the entire simulation.
 */
enum class SimulationStatus {
    CREATED,
    INITIALIZED,
    RUNNING,
    COMPLETED,
    FAILED,
    STOPPED
};

inline std::string simulationStatusToString(SimulationStatus s) {
    switch (s) {
        case SimulationStatus::CREATED: return "CREATED";
        case SimulationStatus::INITIALIZED: return "INITIALIZED";
        case SimulationStatus::RUNNING: return "RUNNING";
        case SimulationStatus::COMPLETED: return "COMPLETED";
        case SimulationStatus::FAILED: return "FAILED";
        case SimulationStatus::STOPPED: return "STOPPED";
        default: return "UNKNOWN";
    }
}

/**
 * @brief Snapshot of system-wide simulation state for telemetry and dashboard polling.
 */
struct SimulationState {
    std::string simulation_id{"sim-default"};
    SimulationStatus status{SimulationStatus::CREATED};
    size_t total_budget{0};
    size_t allocated_budget{0};
    size_t free_budget{0};
    size_t active_streams{0};
    double elapsed_seconds{0.0};

    std::string toJson() const {
        return "{\"type\": \"simulation_state\", \"simulation_id\": \"" + simulation_id + "\"" +
               ", \"status\": \"" + simulationStatusToString(status) + "\"" +
               ", \"total_budget\": " + std::to_string(total_budget) +
               ", \"allocated_budget\": " + std::to_string(allocated_budget) +
               ", \"free_budget\": " + std::to_string(free_budget) +
               ", \"active_streams\": " + std::to_string(active_streams) +
               ", \"elapsed_seconds\": " + std::to_string(elapsed_seconds) + "}";
    }
};

/**
 * @brief Comprehensive final result of a completed or stopped simulation run.
 */
struct SimulationResult {
    bool success{false};
    std::string simulation_id{"sim-default"};
    SimulationMetrics metrics{};
    EngineError error{};

    std::string toJson() const {
        return "{\"type\": \"simulation_result\", \"simulation_id\": \"" + simulation_id + "\"" +
               ", \"success\": " + (success ? "true" : "false") +
               ", \"error\": " + error.toJson() +
               ", \"metrics\": " + metrics.toJson() + "}";
    }
};

#endif // ADAPTIVE_IO_DATA_MODELS_H
