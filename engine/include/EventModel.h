#ifndef ADAPTIVE_IO_EVENT_MODEL_H
#define ADAPTIVE_IO_EVENT_MODEL_H

#include <string>
#include <cstdint>

/**
 * @brief Canonical event types emitted during simulation execution.
 * These map directly to future telemetry streaming, WebSockets, and log analysis.
 */
enum class SimulationEventType {
    SIMULATION_STARTED,
    SIMULATION_COMPLETED,
    SIMULATION_FAILED,
    STREAM_STARTED,
    STREAM_COMPLETED,
    BUFFER_STATE_CHANGED,
    BUFFER_RESIZE_REQUESTED,
    BUFFER_RESIZED,
    RESOURCE_ALLOCATION_CHANGED,
    CONTROLLER_DECISION,
    WORKLOAD_STARTED,
    WORKLOAD_PHASE_CHANGED,
    WORKLOAD_COMPLETED,
    ERROR_OCCURRED
};

/**
 * @brief Converts a SimulationEventType to its canonical string representation.
 */
inline std::string eventTypeToString(SimulationEventType type) {
    switch (type) {
        case SimulationEventType::SIMULATION_STARTED:
            return "SIMULATION_STARTED";
        case SimulationEventType::SIMULATION_COMPLETED:
            return "SIMULATION_COMPLETED";
        case SimulationEventType::SIMULATION_FAILED:
            return "SIMULATION_FAILED";
        case SimulationEventType::STREAM_STARTED:
            return "STREAM_STARTED";
        case SimulationEventType::STREAM_COMPLETED:
            return "STREAM_COMPLETED";
        case SimulationEventType::BUFFER_STATE_CHANGED:
            return "BUFFER_STATE_CHANGED";
        case SimulationEventType::BUFFER_RESIZE_REQUESTED:
            return "BUFFER_RESIZE_REQUESTED";
        case SimulationEventType::BUFFER_RESIZED:
            return "BUFFER_RESIZED";
        case SimulationEventType::RESOURCE_ALLOCATION_CHANGED:
            return "RESOURCE_ALLOCATION_CHANGED";
        case SimulationEventType::CONTROLLER_DECISION:
            return "CONTROLLER_DECISION";
        case SimulationEventType::WORKLOAD_STARTED:
            return "WORKLOAD_STARTED";
        case SimulationEventType::WORKLOAD_PHASE_CHANGED:
            return "WORKLOAD_PHASE_CHANGED";
        case SimulationEventType::WORKLOAD_COMPLETED:
            return "WORKLOAD_COMPLETED";
        case SimulationEventType::ERROR_OCCURRED:
            return "ERROR_OCCURRED";
        default:
            return "UNKNOWN_EVENT";
    }
}

/**
 * @brief Canonical simulation event structure ready for JSON serialization.
 */
struct SimulationEvent {
    uint64_t timestamp_ms{0};
    SimulationEventType event_type{SimulationEventType::SIMULATION_STARTED};
    int32_t stream_id{-1}; // -1 if global / system-wide
    std::string message;
    std::string details_json{"{}"}; // Optional structured payload

    std::string toJson() const {
        return "{\"type\": \"event\", \"timestamp_ms\": " + std::to_string(timestamp_ms) +
               ", \"event_type\": \"" + eventTypeToString(event_type) + "\"" +
               ", \"stream_id\": " + (stream_id >= 0 ? std::to_string(stream_id) : "null") +
               ", \"message\": \"" + message + "\"" +
               ", \"details\": " + (details_json.empty() ? "{}" : details_json) + "}";
    }
};

#endif // ADAPTIVE_IO_EVENT_MODEL_H
