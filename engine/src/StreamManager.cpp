#include "StreamManager.h"
#include <stdexcept>

StreamManager::~StreamManager() {
    joinAll();
}

IOStream& StreamManager::addStream(IOStreamConfig config) {
    if (started_) {
        throw std::runtime_error("Cannot add stream while StreamManager is already running");
    }
    streams_.push_back(std::make_unique<IOStream>(std::move(config)));
    return *streams_.back();
}

void StreamManager::startAll() {
    if (started_) {
        return;
    }
    started_ = true;
    for (auto& stream : streams_) {
        stream->start();
    }
}

void StreamManager::joinAll() {
    if (!started_ || joined_) {
        return;
    }

    // Phase 1: Wait for all producers to finish generating and submitting requests
    for (auto& stream : streams_) {
        stream->joinProducer();
    }

    // Phase 2: Signal buffer closure to wake consumers and initiate final queue draining
    for (auto& stream : streams_) {
        stream->closeBuffer();
    }

    // Phase 3: Wait for all consumers to finish draining and terminate
    for (auto& stream : streams_) {
        stream->joinConsumer();
    }

    joined_ = true;
}

IOStream& StreamManager::getStream(size_t index) {
    if (index >= streams_.size()) {
        throw std::out_of_range("StreamManager stream index out of range");
    }
    return *streams_[index];
}

const IOStream& StreamManager::getStream(size_t index) const {
    if (index >= streams_.size()) {
        throw std::out_of_range("StreamManager stream index out of range");
    }
    return *streams_[index];
}

IOStream* StreamManager::getStreamById(uint32_t stream_id) {
    for (auto& stream : streams_) {
        if (stream->getId() == stream_id) {
            return stream.get();
        }
    }
    return nullptr;
}

const IOStream* StreamManager::getStreamById(uint32_t stream_id) const {
    for (const auto& stream : streams_) {
        if (stream->getId() == stream_id) {
            return stream.get();
        }
    }
    return nullptr;
}

std::vector<StreamMetrics> StreamManager::collectMetrics(double simulation_time_sec) const {
    std::vector<StreamMetrics> metrics;
    metrics.reserve(streams_.size());
    for (const auto& stream : streams_) {
        metrics.push_back(stream->getMetrics(simulation_time_sec));
    }
    return metrics;
}
