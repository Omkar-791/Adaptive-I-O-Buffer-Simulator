#include "Request.h"

Request::Request()
    : id_(0), payload_bytes_(0), stream_id_(0) {}

Request::Request(uint64_t id, size_t payload_bytes, uint32_t stream_id)
    : id_(id), payload_bytes_(payload_bytes), stream_id_(stream_id) {}

void Request::recordCreation() {
    creation_time_ = std::chrono::steady_clock::now();
}

void Request::recordEnqueue() {
    enqueue_time_ = std::chrono::steady_clock::now();
}

void Request::recordDequeue() {
    dequeue_time_ = std::chrono::steady_clock::now();
}

void Request::recordCompletion() {
    completion_time_ = std::chrono::steady_clock::now();
}

double Request::getTotalLatencyMs() const {
    if (creation_time_.time_since_epoch().count() == 0 ||
        completion_time_.time_since_epoch().count() == 0) {
        return 0.0;
    }
    std::chrono::duration<double, std::milli> duration = completion_time_ - creation_time_;
    return duration.count();
}

double Request::getQueueResidenceMs() const {
    if (enqueue_time_.time_since_epoch().count() == 0 ||
        dequeue_time_.time_since_epoch().count() == 0) {
        return 0.0;
    }
    std::chrono::duration<double, std::milli> duration = dequeue_time_ - enqueue_time_;
    return duration.count();
}

double Request::getServiceTimeMs() const {
    if (dequeue_time_.time_since_epoch().count() == 0 ||
        completion_time_.time_since_epoch().count() == 0) {
        return 0.0;
    }
    std::chrono::duration<double, std::milli> duration = completion_time_ - dequeue_time_;
    return duration.count();
}
