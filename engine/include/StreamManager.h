#ifndef ADAPTIVE_IO_STREAM_MANAGER_H
#define ADAPTIVE_IO_STREAM_MANAGER_H

#include "IOStream.h"
#include <vector>
#include <memory>
#include <cstddef>
#include <cstdint>

/**
 * @brief Manages the lifecycle and orchestration of multiple concurrent I/O streams.
 */
class StreamManager {
public:
    StreamManager() = default;
    ~StreamManager();

    // Non-copyable, non-movable thread manager
    StreamManager(const StreamManager&) = delete;
    StreamManager& operator=(const StreamManager&) = delete;
    StreamManager(StreamManager&&) = delete;
    StreamManager& operator=(StreamManager&&) = delete;

    /**
     * @brief Adds a new configured I/O stream to the manager.
     * @param config The stream's configuration settings.
     * @return Reference to the newly created IOStream.
     */
    IOStream& addStream(IOStreamConfig config);

    /**
     * @brief Starts all managed streams concurrently (spawning 2N worker threads).
     */
    void startAll();

    /**
     * @brief Synchronously orchestrates a clean multi-stream shutdown:
     * 1. Joins all producer threads.
     * 2. Closes all stream buffers to initiate draining.
     * 3. Joins all consumer threads.
     */
    void joinAll();

    // Accessors
    size_t size() const noexcept { return streams_.size(); }
    IOStream& getStream(size_t index);
    const IOStream& getStream(size_t index) const;
    IOStream* getStreamById(uint32_t stream_id);
    const IOStream* getStreamById(uint32_t stream_id) const;

    /**
     * @brief Collects telemetry metrics across all managed streams.
     * @param simulation_time_sec Total elapsed simulation duration.
     * @return Vector of per-stream metrics.
     */
    std::vector<StreamMetrics> collectMetrics(double simulation_time_sec) const;

    // Phase 3: Resource Manager Association
    void setResourceManager(std::shared_ptr<class BufferResourceManager> rm) { resource_manager_ = std::move(rm); }
    std::shared_ptr<class BufferResourceManager> getResourceManager() const noexcept { return resource_manager_; }

private:
    std::vector<std::unique_ptr<IOStream>> streams_{};
    std::shared_ptr<class BufferResourceManager> resource_manager_{};
    bool started_{false};
    bool joined_{false};
};

#endif // ADAPTIVE_IO_STREAM_MANAGER_H
