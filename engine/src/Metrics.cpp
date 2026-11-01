#include "Metrics.h"
#include <iomanip>
#include <sstream>

std::string StreamMetrics::toJson() const {
    std::ostringstream ss;
    ss << std::fixed << std::setprecision(4);
    ss << "{\"stream_id\": " << stream_id
       << ", \"name\": \"" << name << "\""
       << ", \"buffer_capacity\": " << buffer_capacity
       << ", \"target_requests\": " << target_requests
       << ", \"producer_interval_ms\": " << producer_interval_ms
       << ", \"consumer_processing_ms\": " << consumer_processing_ms
       << ", \"random_seed\": " << random_seed
       << ", \"workload_type\": \"" << workload_type << "\""
       << ", \"total_produced\": " << total_produced
       << ", \"total_consumed\": " << total_consumed
       << ", \"total_bytes\": " << total_bytes
       << ", \"throughput_req_per_sec\": " << throughput_req_per_sec
       << ", \"throughput_mb_per_sec\": " << throughput_mb_per_sec
       << ", \"avg_latency_ms\": " << avg_latency_ms
       << ", \"min_latency_ms\": " << min_latency_ms
       << ", \"max_latency_ms\": " << max_latency_ms
       << ", \"total_producer_wait_ms\": " << total_producer_wait_ms
       << ", \"avg_producer_wait_ms\": " << avg_producer_wait_ms
       << ", \"avg_occupancy_slots\": " << avg_occupancy_slots
       << ", \"avg_occupancy_pct\": " << avg_occupancy_pct
       << ", \"max_occupancy_slots\": " << max_occupancy_slots
       << ", \"max_occupancy_pct\": " << max_occupancy_pct
       << ", \"success\": " << (success ? "true" : "false")
       << "}";
    return ss.str();
}

std::string SimulationMetrics::toJson() const {
    std::ostringstream ss;
    ss << std::fixed << std::setprecision(4);
    ss << "{\"type\": \"simulation_completed\""
       << ", \"stream_count\": " << stream_count
       << ", \"workload_type\": \"" << workload_type << "\""
       << ", \"global_buffer_budget\": " << global_buffer_budget
       << ", \"total_allocated_capacity\": " << total_allocated_capacity
       << ", \"free_buffer_budget\": " << free_buffer_budget
       << ", \"min_buffer_capacity\": " << min_buffer_capacity
       << ", \"total_produced\": " << total_produced
       << ", \"total_consumed\": " << total_consumed
       << ", \"total_bytes\": " << total_bytes
       << ", \"simulation_time_sec\": " << simulation_time_sec
       << ", \"throughput_req_per_sec\": " << throughput_req_per_sec
       << ", \"throughput_mb_per_sec\": " << throughput_mb_per_sec
       << ", \"avg_latency_ms\": " << avg_latency_ms
       << ", \"min_latency_ms\": " << min_latency_ms
       << ", \"max_latency_ms\": " << max_latency_ms
       << ", \"total_producer_wait_ms\": " << total_producer_wait_ms
       << ", \"avg_producer_wait_ms\": " << avg_producer_wait_ms
       << ", \"avg_occupancy_slots\": " << avg_occupancy_slots
       << ", \"avg_occupancy_pct\": " << avg_occupancy_pct
       << ", \"max_occupancy_slots\": " << max_occupancy_slots
       << ", \"max_occupancy_pct\": " << max_occupancy_pct
       << ", \"success\": " << (success ? "true" : "false")
       << ", \"streams\": [";

    for (size_t i = 0; i < stream_metrics.size(); ++i) {
        ss << stream_metrics[i].toJson();
        if (i + 1 < stream_metrics.size()) {
            ss << ", ";
        }
    }
    ss << "]}";
    return ss.str();
}

void SimulationMetrics::printReport(std::ostream& os) const {
    os << "\n==================================================\n";
    os << "Adaptive I/O Buffer Management System\n";
    if (global_buffer_budget > 0) {
        os << "Phase 3: Global Buffer Budget (" << stream_count << " Streams, Budget: " << global_buffer_budget << ")\n";
    } else if (stream_count > 1) {
        os << "Phase 2: Multi-Stream Simulation (" << stream_count << " Streams)\n";
    } else {
        os << "Phase 1: Single-Stream Simulation\n";
    }
    os << "==================================================\n\n";

    if (global_buffer_budget > 0) {
        os << "Global Buffer Resource Management\n";
        os << "--------------------------------\n";
        os << std::left << std::setw(25) << "Global Buffer Budget"     << ": " << global_buffer_budget << " slots\n";
        os << std::left << std::setw(25) << "Total Allocated Buffer"   << ": " << total_allocated_capacity << " slots";
        if (global_buffer_budget > 0) {
            double alloc_pct = (static_cast<double>(total_allocated_capacity) / static_cast<double>(global_buffer_budget)) * 100.0;
            os << " (" << std::fixed << std::setprecision(1) << alloc_pct << " %)";
        }
        os << "\n";
        os << std::left << std::setw(25) << "Free Buffer Budget"       << ": " << free_buffer_budget << " slots\n";
        os << std::left << std::setw(25) << "Min Stream Capacity"      << ": " << min_buffer_capacity << " slots\n\n";
    }

    if (stream_count > 1) {
        os << "Per-Stream Breakdown\n";
        os << "--------------------\n";
        for (const auto& sm : stream_metrics) {
            os << "[" << sm.name << " (ID " << sm.stream_id << ")]\n";
            os << "  Workload: " << sm.workload_type << " | Capacity: " << sm.buffer_capacity << " slots | Requests: "
               << sm.total_consumed << "/" << sm.target_requests << "\n";
            os << "  Producer: " << sm.producer_interval_ms << " ms | Consumer: "
               << sm.consumer_processing_ms << " ms | Seed: " << sm.random_seed << "\n";
            os << "  Throughput: " << std::fixed << std::setprecision(2) << sm.throughput_req_per_sec
               << " req/s (" << sm.throughput_mb_per_sec << " MB/s)\n";
            os << "  Avg Latency: " << std::fixed << std::setprecision(2) << sm.avg_latency_ms
               << " ms (Min: " << sm.min_latency_ms << " ms, Max: " << sm.max_latency_ms << " ms)\n";
            os << "  Producer Wait: " << std::fixed << std::setprecision(2) << sm.total_producer_wait_ms
               << " ms (Avg: " << sm.avg_producer_wait_ms << " ms/req)\n";
            os << "  Buffer Usage: " << std::fixed << std::setprecision(2) << sm.avg_occupancy_slots
               << " slots (" << sm.avg_occupancy_pct << " %) | Peak: "
               << sm.max_occupancy_slots << " slots (" << sm.max_occupancy_pct << " %)\n\n";
        }
        os << "Global System Aggregates\n";
        os << "------------------------\n";
    } else {
        os << "Configuration\n";
        os << "-------------\n";
        os << std::left << std::setw(23) << "Workload Type"       << ": " << workload_type << "\n";
        os << std::left << std::setw(23) << "Buffer Capacity"     << ": " << buffer_capacity << "\n";
        os << std::left << std::setw(23) << "Target Requests"     << ": " << target_requests << "\n";
        os << std::left << std::setw(23) << "Producer Interval"   << ": " << producer_interval_ms << " ms\n";
        os << std::left << std::setw(23) << "Consumer Processing" << ": " << consumer_processing_ms << " ms\n";
        os << std::left << std::setw(23) << "Random Seed"         << ": " << random_seed << "\n\n";

        os << "Results\n";
        os << "-------\n";
    }

    os << std::left << std::setw(23) << "Total Produced"       << ": " << total_produced << "\n";
    os << std::left << std::setw(23) << "Total Consumed"       << ": " << total_consumed << "\n";
    os << std::left << std::setw(23) << "Total Bytes"          << ": " << total_bytes << " bytes ("
       << std::fixed << std::setprecision(2) << (static_cast<double>(total_bytes) / (1024.0 * 1024.0)) << " MB)\n";
    os << std::left << std::setw(23) << "Simulation Time"      << ": " << std::fixed << std::setprecision(3) << simulation_time_sec << " s\n";
    os << std::left << std::setw(23) << "Throughput"           << ": " << std::fixed << std::setprecision(2) << throughput_req_per_sec << " requests/s ("
       << throughput_mb_per_sec << " MB/s)\n";
    os << std::left << std::setw(23) << "Average Latency"      << ": " << std::fixed << std::setprecision(2) << avg_latency_ms << " ms\n";
    os << std::left << std::setw(23) << "Min / Max Latency"    << ": " << std::fixed << std::setprecision(2) << min_latency_ms << " ms / "
       << max_latency_ms << " ms\n";
    os << std::left << std::setw(23) << "Total Producer Wait"  << ": " << std::fixed << std::setprecision(2) << total_producer_wait_ms << " ms\n";
    os << std::left << std::setw(23) << "Avg Producer Wait"    << ": " << std::fixed << std::setprecision(2) << avg_producer_wait_ms << " ms/request\n";
    os << std::left << std::setw(23) << "Average Buffer Usage" << ": " << std::fixed << std::setprecision(2) << avg_occupancy_slots
       << " slots (" << avg_occupancy_pct << " %)\n";
    os << std::left << std::setw(23) << "Maximum Buffer Usage" << ": " << max_occupancy_slots
       << " slots (" << std::fixed << std::setprecision(2) << max_occupancy_pct << " %)\n\n";

    os << "Status: " << (success ? "SUCCESS" : "FAILED") << "\n";
    os << "==================================================\n" << std::endl;
}
