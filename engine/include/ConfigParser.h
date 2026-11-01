#ifndef ADAPTIVE_IO_CONFIG_PARSER_H
#define ADAPTIVE_IO_CONFIG_PARSER_H

#include "Simulation.h"
#include "IOStream.h"
#include "WorkloadGenerator.h"
#include <string>
#include <vector>

/**
 * @brief Container for simulation configurations loaded from JSON files.
 * Supports both uniform (single or multi-stream with shared parameters)
 * and heterogeneous configurations (individual stream specifications).
 */
struct ParsedSimulationConfig {
    bool is_heterogeneous{false};
    SimulationConfig sim_config{};
    std::vector<IOStreamConfig> stream_configs{};
    size_t global_budget{0};
};

/**
 * @brief Parses JSON configuration files for simulation and workload execution.
 */
class ConfigParser {
public:
    /**
     * @brief Parses a JSON configuration file from disk.
     * @param filepath Path to the JSON configuration file.
     * @return ParsedSimulationConfig containing simulation or stream configs.
     * @throws std::runtime_error if file cannot be read or JSON syntax is invalid.
     */
    static ParsedSimulationConfig parseFile(const std::string& filepath);

    /**
     * @brief Parses a JSON configuration string in memory.
     * @param json_str JSON contents.
     * @return ParsedSimulationConfig containing simulation or stream configs.
     * @throws std::runtime_error if JSON syntax is invalid.
     */
    static ParsedSimulationConfig parseString(const std::string& json_str);
};

#endif // ADAPTIVE_IO_CONFIG_PARSER_H
