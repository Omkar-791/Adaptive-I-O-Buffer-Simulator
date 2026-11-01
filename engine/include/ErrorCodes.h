#ifndef ADAPTIVE_IO_ERROR_CODES_H
#define ADAPTIVE_IO_ERROR_CODES_H

#include <string>

/**
 * @brief Canonical error codes for the Adaptive I/O Simulation Engine.
 * These map directly to future backend REST API and IPC error representations.
 */
enum class EngineErrorCode {
    SUCCESS = 0,
    INVALID_CONFIGURATION,
    RESOURCE_LIMIT_EXCEEDED,
    SIMULATION_NOT_FOUND,
    SIMULATION_ALREADY_RUNNING,
    SIMULATION_NOT_RUNNING,
    ENGINE_START_FAILURE,
    ENGINE_RUNTIME_FAILURE,
    IPC_FAILURE,
    INVALID_REQUEST
};

/**
 * @brief Converts an EngineErrorCode to its canonical string representation.
 */
inline std::string errorCodeToString(EngineErrorCode code) {
    switch (code) {
        case EngineErrorCode::SUCCESS:
            return "SUCCESS";
        case EngineErrorCode::INVALID_CONFIGURATION:
            return "INVALID_CONFIGURATION";
        case EngineErrorCode::RESOURCE_LIMIT_EXCEEDED:
            return "RESOURCE_LIMIT_EXCEEDED";
        case EngineErrorCode::SIMULATION_NOT_FOUND:
            return "SIMULATION_NOT_FOUND";
        case EngineErrorCode::SIMULATION_ALREADY_RUNNING:
            return "SIMULATION_ALREADY_RUNNING";
        case EngineErrorCode::SIMULATION_NOT_RUNNING:
            return "SIMULATION_NOT_RUNNING";
        case EngineErrorCode::ENGINE_START_FAILURE:
            return "ENGINE_START_FAILURE";
        case EngineErrorCode::ENGINE_RUNTIME_FAILURE:
            return "ENGINE_RUNTIME_FAILURE";
        case EngineErrorCode::IPC_FAILURE:
            return "IPC_FAILURE";
        case EngineErrorCode::INVALID_REQUEST:
            return "INVALID_REQUEST";
        default:
            return "UNKNOWN_ERROR";
    }
}

/**
 * @brief Structured error descriptor suitable for JSON serialization and backend reporting.
 */
struct EngineError {
    EngineErrorCode code{EngineErrorCode::SUCCESS};
    std::string message;
    std::string details;

    bool isError() const noexcept { return code != EngineErrorCode::SUCCESS; }

    std::string toJson() const {
        return "{\"type\": \"error\", \"code\": \"" + errorCodeToString(code) + "\"" +
               ", \"message\": \"" + message + "\"" +
               ", \"details\": \"" + details + "\"}";
    }
};

#endif // ADAPTIVE_IO_ERROR_CODES_H
