#include "Simulation.h"
#include "ConfigParser.h"
#include "WorkloadGenerator.h"
#include <iostream>
#include <string>
#include <vector>
#include <cstdlib>
#include <algorithm>

namespace {

void printHelp(const char* prog_name) {
    std::cout << "Adaptive I/O Buffer Management System (Phase 7: Runtime Buffer Resizing)\n\n"
              << "Usage: " << prog_name << " [options]\n\n"
              << "Options:\n"
              << "  --streams <n>         Number of concurrent I/O streams (default: 1)\n"
              << "  --capacity <n>        Buffer capacity per stream in slots (default: 8)\n"
              << "  --budget <n>          Total shared buffer budget across all streams\n"
              << "  --buffer-budget <n>   Alias for --budget\n"
              << "  --min-capacity <n>    Minimum buffer capacity per stream in slots (default: 1)\n"
              << "  --requests <n>        Total requests to simulate per stream (default: 1000)\n"
              << "  --producer-ms <n>     Producer inter-arrival interval in milliseconds (default: 5)\n"
              << "  --consumer-ms <n>     Consumer I/O processing time in milliseconds (default: 10)\n"
              << "  --min-payload <n>     Minimum request payload size in bytes (default: 512)\n"
              << "  --max-payload <n>     Maximum request payload size in bytes (default: 4096)\n"
              << "  --seed <n>            Random seed base for reproducible workloads (default: 42)\n"
              << "  --workload <type>     Workload pattern: steady, burst, periodic, stochastic, mixed (default: steady)\n"
              << "  --burst-interval <ms> Interval during burst phase in milliseconds (default: 1)\n"
              << "  --burst-length <n>    Requests per burst (default: 20)\n"
              << "  --normal-length <n>   Requests per normal period (default: 80)\n"
              << "  --config <path>       Load simulation and workload configuration from JSON file\n"
              << "  --adaptive            Enable controller and runtime queue resizing\n"
              << "  --telemetry           Stream NDJSON snapshots and final summary\n"
              << "  --metrics-interval-ms <n> Sampling interval (default 100)\n"
              << "  --metrics-window-ms <n> Sliding window (default 1000)\n"
              << "  --json                Output machine-readable JSON telemetry to stdout\n"
              << "  -h, --help            Display this help message and exit\n\n"
              << "Examples:\n"
              << "  " << prog_name << " --streams 3 --capacity 8 --requests 500\n"
              << "  " << prog_name << " --streams 3 --budget 32 --requests 500 --json\n"
              << "  " << prog_name << " --workload burst --burst-interval 1 --burst-length 25\n"
              << "  " << prog_name << " --config configs/workload_heterogeneous.json --json\n";
}

bool parsePositiveInt(const std::string& str, size_t& out_val) {
    if (str.empty() || str[0] == '-') {
        return false;
    }
    try {
        size_t idx = 0;
        unsigned long long val = std::stoull(str, &idx);
        if (idx != str.size()) {
            return false;
        }
        out_val = static_cast<size_t>(val);
        return true;
    } catch (...) {
        return false;
    }
}

bool parsePositiveInt32(const std::string& str, uint32_t& out_val) {
    if (str.empty() || str[0] == '-') {
        return false;
    }
    try {
        size_t idx = 0;
        unsigned long val = std::stoul(str, &idx);
        if (idx != str.size()) {
            return false;
        }
        out_val = static_cast<uint32_t>(val);
        return true;
    } catch (...) {
        return false;
    }
}

} // anonymous namespace

int main(int argc, char* argv[]) {
    std::string config_path;
    bool output_json = false;
    bool telemetry = false;
    bool adaptive = false;
    MetricsConfig metrics_config;

    // Scan for help or config path first
    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];
        if (arg == "-h" || arg == "--help") {
            printHelp(argv[0]);
            return 0;
        } else if (arg == "--config") {
            if (++i >= argc) {
                std::cerr << "Error: --config requires a file path argument.\n";
                return 1;
            }
            config_path = argv[i];
        }
    }

    ParsedSimulationConfig parsed;
    if (!config_path.empty()) {
        try {
            parsed = ConfigParser::parseFile(config_path);
        } catch (const std::exception& ex) {
            std::cerr << "Error loading config file: " << ex.what() << "\n";
            return 1;
        }
    }

    SimulationConfig& config = parsed.sim_config;
    bool workload_explicitly_set = false;
    std::string workload_str;
    uint32_t burst_interval_ms = 1;
    size_t burst_length = 20;
    size_t normal_length = 80;

    for (int i = 1; i < argc; ++i) {
        std::string arg = argv[i];

        if (arg == "-h" || arg == "--help") {
            // Already handled
            continue;
        } else if (arg == "--config") {
            ++i; // skip path
            continue;
        } else if (arg == "--streams") {
            if (++i >= argc || !parsePositiveInt(argv[i], config.num_streams) || config.num_streams == 0) {
                std::cerr << "Error: --streams requires a positive integer argument.\n";
                return 1;
            }
        } else if (arg == "--capacity") {
            if (++i >= argc || !parsePositiveInt(argv[i], config.buffer_capacity) || config.buffer_capacity == 0) {
                std::cerr << "Error: --capacity requires a positive integer argument.\n";
                return 1;
            }
            config.capacity_explicitly_set = true;
        } else if (arg == "--budget" || arg == "--buffer-budget") {
            if (++i >= argc || !parsePositiveInt(argv[i], config.global_buffer_budget) || config.global_buffer_budget == 0) {
                std::cerr << "Error: " << arg << " requires a positive integer argument.\n";
                return 1;
            }
        } else if (arg == "--min-capacity") {
            if (++i >= argc || !parsePositiveInt(argv[i], config.min_buffer_capacity) || config.min_buffer_capacity == 0) {
                std::cerr << "Error: --min-capacity requires a positive integer argument.\n";
                return 1;
            }
        } else if (arg == "--requests") {
            if (++i >= argc || !parsePositiveInt(argv[i], config.num_requests) || config.num_requests == 0) {
                std::cerr << "Error: --requests requires a positive integer argument.\n";
                return 1;
            }
        } else if (arg == "--producer-ms") {
            if (++i >= argc || !parsePositiveInt32(argv[i], config.producer_interval_ms)) {
                std::cerr << "Error: --producer-ms requires a non-negative integer argument.\n";
                return 1;
            }
        } else if (arg == "--consumer-ms") {
            if (++i >= argc || !parsePositiveInt32(argv[i], config.consumer_processing_ms)) {
                std::cerr << "Error: --consumer-ms requires a non-negative integer argument.\n";
                return 1;
            }
        } else if (arg == "--min-payload") {
            if (++i >= argc || !parsePositiveInt(argv[i], config.min_payload_bytes)) {
                std::cerr << "Error: --min-payload requires a non-negative integer argument.\n";
                return 1;
            }
        } else if (arg == "--max-payload") {
            if (++i >= argc || !parsePositiveInt(argv[i], config.max_payload_bytes)) {
                std::cerr << "Error: --max-payload requires a non-negative integer argument.\n";
                return 1;
            }
        } else if (arg == "--seed") {
            if (++i >= argc || !parsePositiveInt32(argv[i], config.random_seed)) {
                std::cerr << "Error: --seed requires a non-negative integer argument.\n";
                return 1;
            }
        } else if (arg == "--workload") {
            if (++i >= argc) {
                std::cerr << "Error: --workload requires a workload type argument.\n";
                return 1;
            }
            workload_str = argv[i];
            workload_explicitly_set = true;
        } else if (arg == "--burst-interval") {
            if (++i >= argc || !parsePositiveInt32(argv[i], burst_interval_ms)) {
                std::cerr << "Error: --burst-interval requires a non-negative integer argument.\n";
                return 1;
            }
        } else if (arg == "--burst-length") {
            if (++i >= argc || !parsePositiveInt(argv[i], burst_length) || burst_length == 0) {
                std::cerr << "Error: --burst-length requires a positive integer argument.\n";
                return 1;
            }
        } else if (arg == "--normal-length") {
            if (++i >= argc || !parsePositiveInt(argv[i], normal_length) || normal_length == 0) {
                std::cerr << "Error: --normal-length requires a positive integer argument.\n";
                return 1;
            }
        } else if (arg == "--adaptive") {
            adaptive = true;
        } else if (arg == "--telemetry") {
            telemetry = true;
        } else if (arg == "--metrics-interval-ms" || arg == "--metrics-window-ms") {
            size_t value=0;
            if (++i >= argc || !parsePositiveInt(argv[i],value) || value==0) {
                std::cerr << "Error: metrics interval/window requires a positive integer.\n"; return 1;
            }
            if(arg=="--metrics-interval-ms") metrics_config.interval_ms=value;
            else metrics_config.window_ms=value;
        } else if (arg == "--json") {
            output_json = true;
        } else {
            std::cerr << "Error: Unrecognized option '" << arg << "'. Use --help for usage.\n";
            return 1;
        }
    }

    if (config.min_payload_bytes > config.max_payload_bytes) {
        std::cerr << "Error: --min-payload cannot exceed --max-payload.\n";
        return 1;
    }

    if (workload_explicitly_set) {
        std::string w_upper = workload_str;
        std::transform(w_upper.begin(), w_upper.end(), w_upper.begin(), ::toupper);

        if (w_upper != "STEADY" && w_upper != "BURST" && w_upper != "PERIODIC" &&
            w_upper != "STOCHASTIC" && w_upper != "MIXED") {
            std::cerr << "Error: Invalid workload type '" << workload_str
                      << "'. Valid options are: steady, burst, periodic, stochastic, mixed.\n";
            return 1;
        }

        config.use_workload_config = true;
        config.workload.type = stringToWorkloadType(w_upper);
        config.workload.base_interval_ms = config.producer_interval_ms;
        config.workload.burst_interval_ms = burst_interval_ms;
        config.workload.burst_length = burst_length;
        config.workload.normal_length = normal_length;
        config.workload.min_payload_bytes = config.min_payload_bytes;
        config.workload.max_payload_bytes = config.max_payload_bytes;
        config.workload.seed = config.random_seed;
    }

    try {
        if (parsed.is_heterogeneous) {
            Simulation simulation(parsed.stream_configs, parsed.global_budget);
            simulation.setMetricsConfig(metrics_config);
            if(adaptive) simulation.enableAdaptive();
            simulation.setResizeCallback([telemetry](const ResizeResult& r) {
                if(telemetry) std::cout << r.toJson() << std::endl;
                else if(!r.success) std::cerr << "Resize not applied: " << r.reason << "\n";
            });
            if(telemetry) simulation.setMetricsCallback([](const MetricsSnapshot& s) { std::cout << s.toJson() << std::endl; });
            SimulationMetrics metrics = simulation.run();

            if (output_json || telemetry) {
                std::cout << metrics.toJson() << "\n";
            } else {
                metrics.printReport(std::cout);
            }
            return metrics.success ? 0 : 1;
        } else {
            Simulation simulation(config);
            simulation.setMetricsConfig(metrics_config);
            if(adaptive) simulation.enableAdaptive();
            simulation.setResizeCallback([telemetry](const ResizeResult& r) {
                if(telemetry) std::cout << r.toJson() << std::endl;
                else if(!r.success) std::cerr << "Resize not applied: " << r.reason << "\n";
            });
            if(telemetry) simulation.setMetricsCallback([](const MetricsSnapshot& s) { std::cout << s.toJson() << std::endl; });
            SimulationMetrics metrics = simulation.run();

            if (output_json || telemetry) {
                std::cout << metrics.toJson() << "\n";
            } else {
                metrics.printReport(std::cout);
            }
            return metrics.success ? 0 : 1;
        }
    } catch (const std::exception& ex) {
        std::cerr << "Error: " << ex.what() << "\n";
        return 1;
    }
}
