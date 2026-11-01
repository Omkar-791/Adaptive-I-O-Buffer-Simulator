#ifndef ADAPTIVE_IO_STREAM_H
#define ADAPTIVE_IO_STREAM_H

#include "BoundedBuffer.h"
#include "Producer.h"
#include "Consumer.h"
#include "Metrics.h"
#include "WorkloadGenerator.h"
#include <string>
#include <thread>
#include <memory>
#include <cstdint>
#include <cstddef>

/**
 * @brief Configuration parameters for a single I/O stream channel.
 */
struct IOStreamConfig {
    uint32_t stream_id{0};
    std::string name{"Stream"};
    size_t buffer_capacity{8};
    size_t num_requests{1000};
    uint32_t producer_interval_ms{5};
    uint32_t consumer_processing_ms{10};
    size_t min_payload_bytes{512};
    size_t max_payload_bytes{4096};
    uint32_t random_seed{42};
    WorkloadConfig workload{};
    bool use_workload_config{false};
};

/**
 * @brief Encapsulates a complete concurrent I/O stream:
 * Producer Thread -> Bounded Circular Buffer -> Consumer Thread.
 */
class IOStream {
public:
    explicit IOStream(IOStreamConfig config);
    ~IOStream();

    // Non-copyable, non-movable thread owner
    IOStream(const IOStream&) = delete;
    IOStream& operator=(const IOStream&) = delete;
    IOStream(IOStream&&) = delete;
    IOStream& operator=(IOStream&&) = delete;

    /**
     * @brief Spawns the dedicated producer and consumer threads for this stream.
     */
    void start();

    /**
     * @brief Waits for the producer thread to finish generating all requests.
     */
    void joinProducer();

    /**
     * @brief Signals the stream's bounded buffer to close, waking consumers to drain.
     */
    void closeBuffer();

    /**
     * @brief Waits for the consumer thread to finish draining remaining items.
     */
    void joinConsumer();

    /**
     * @brief Complete join sequence: joins producer, closes buffer, and joins consumer.
     */
    void join();

    // Telemetry & State
    uint32_t getId() const noexcept { return config_.stream_id; }
    const std::string& getName() const noexcept { return config_.name; }
    const IOStreamConfig& getConfig() const noexcept { return config_; }

    BoundedBuffer& getBuffer() noexcept { return buffer_; }
    const BoundedBuffer& getBuffer() const noexcept { return buffer_; }

    const Producer& getProducer() const noexcept { return producer_; }
    const Consumer& getConsumer() const noexcept { return consumer_; }

    StreamMetrics getMetrics(double simulation_time_sec) const;

private:
    const IOStreamConfig config_;
    BoundedBuffer buffer_;
    Producer producer_;
    Consumer consumer_;

    std::thread producer_thread_{};
    std::thread consumer_thread_{};
    bool started_{false};
    bool producer_joined_{false};
    bool consumer_joined_{false};
};

#endif // ADAPTIVE_IO_STREAM_H
