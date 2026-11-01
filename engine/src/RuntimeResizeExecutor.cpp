#include "RuntimeResizeExecutor.h"
#include <algorithm>
#include <set>
#include <stdexcept>
#include <type_traits>
#include <sstream>
#include <iomanip>

RuntimeResizeExecutor::RuntimeResizeExecutor(BufferResourceManager& manager,
    std::vector<BufferBinding> bindings) : manager_(manager), bindings_(std::move(bindings)) {
    std::sort(bindings_.begin(),bindings_.end(),[](const BufferBinding& a,const BufferBinding& b){return a.stream_id<b.stream_id;});
    std::set<BoundedBuffer*> pointers;
    uint32_t previous=0; bool first=true;
    for(const auto& binding:bindings_) {
        if(!binding.buffer || !binding.min_capacity || binding.min_capacity<manager_.min_capacity_ ||
            binding.max_capacity<binding.min_capacity || (!first && previous==binding.stream_id) ||
            !pointers.insert(binding.buffer).second)
            throw std::invalid_argument("Invalid/duplicate runtime buffer bindings");
        previous=binding.stream_id; first=false;
    }
    std::vector<std::unique_lock<std::mutex>> queues;
    queues.reserve(bindings_.size());
    std::unique_lock<std::mutex> resource(manager_.mutex_,std::try_to_lock);
    if(!resource || manager_.resize_owner_) throw std::logic_error("Resource manager busy or already runtime-bound");
    if(manager_.allocations_.size()!=bindings_.size()) throw std::invalid_argument("Binding IDs must match allocation topology");
    size_t current_total=0;
    for(const auto& binding:bindings_) {
        queues.emplace_back(binding.buffer->mutex_,std::try_to_lock);
        if(!queues.back()) throw std::runtime_error("Buffer busy during runtime binding");
        auto allocation=manager_.allocations_.find(binding.stream_id);
        if(allocation==manager_.allocations_.end() || binding.buffer->resize_owner_ ||
            allocation->second!=binding.buffer->capacity_ || allocation->second<binding.min_capacity ||
            allocation->second>binding.max_capacity)
            throw std::invalid_argument("Physical capacity/allocation/bounds mismatch during binding");
        if(allocation->second>manager_.total_budget_-current_total)
            throw std::invalid_argument("Bound physical capacities exceed global budget");
        current_total+=allocation->second;
    }
    if(current_total!=manager_.total_allocated_) throw std::invalid_argument("Allocation accounting total is inconsistent");
    manager_.resize_owner_=this;
    // A newly constructed executor starts a new sequence epoch only after exclusive binding.
    manager_.last_resize_sequence_=0;
    for(const auto& binding:bindings_) binding.buffer->resize_owner_=this;
}
RuntimeResizeExecutor::~RuntimeResizeExecutor() {
    std::lock_guard<std::mutex> resource(manager_.mutex_);
    for(const auto& binding:bindings_) {
        std::lock_guard<std::mutex> queue(binding.buffer->mutex_);
        binding.buffer->resize_owner_=nullptr;
    }
    manager_.resize_owner_=nullptr;
}
ResizeResult RuntimeResizeExecutor::apply(const AllocationDecision& decision) {
    ResizeResult result;
    result.snapshot_sequence=decision.snapshot_sequence;
    auto reject=[&](const std::string& reason,bool deferred=false,bool stale=false) {
        result.reason=reason; result.deferred=deferred; result.stale=stale; return result;
    };
    if(!decision.valid || !decision.evaluated || !decision.snapshot_sequence)
        return reject("Decision is invalid, unevaluated or has no snapshot sequence");
    if(decision.streams.size()!=bindings_.size()) return reject("Decision must contain every bound stream exactly once");
    std::vector<const AllocationRecommendation*> ordered;
    try {
        ordered.reserve(bindings_.size());
        for(const auto& recommendation:decision.streams) ordered.push_back(&recommendation);
    } catch(const std::exception&) { return reject("Unable to allocate decision metadata; transaction unchanged"); }
    std::sort(ordered.begin(),ordered.end(),[](const auto* a,const auto* b){return a->stream_id<b->stream_id;});
    size_t desired_total=0;
    for(size_t i=0;i<bindings_.size();++i) {
        const auto& b=bindings_[i]; const auto& r=*ordered[i];
        if(r.stream_id!=b.stream_id || r.desired_capacity<b.min_capacity || r.desired_capacity>b.max_capacity)
            return reject("Decision IDs or requested minimum/maximum are invalid");
        if(r.desired_capacity>manager_.total_budget_-desired_total) return reject("Requested capacities exceed global budget");
        desired_total+=r.desired_capacity;
    }
    // Allocate staging storage before transaction locks. No real state changes on failure.
    std::vector<std::vector<Request>> staging;
    std::vector<std::unique_lock<std::mutex>> queues;
    try {
        staging.resize(bindings_.size()); queues.reserve(bindings_.size()); result.streams.reserve(bindings_.size());
        for(size_t i=0;i<bindings_.size();++i) {
            const auto& r=*ordered[i];
            if(r.current_capacity!=r.desired_capacity) staging[i].resize(r.desired_capacity);
        }
    } catch(const std::exception&) { return reject("Unable to allocate resize staging storage; transaction unchanged"); }
    std::unique_lock<std::mutex> resource(manager_.mutex_,std::try_to_lock);
    if(!resource) return reject("Resource manager busy; retry with a fresh observation",true);
    if(manager_.resize_owner_!=this) return reject("Executor no longer owns resource manager");

    // Manager lock serializes transactions; queues are acquired in increasing stream-ID order.
    for(size_t i=0;i<bindings_.size();++i) {
        const auto& b=bindings_[i];const auto& r=*ordered[i];
        auto allocation=manager_.allocations_.find(b.stream_id);
        if(allocation==manager_.allocations_.end()) return reject("Allocation topology changed",false,true);
        result.streams.push_back({b.stream_id,allocation->second,r.desired_capacity,allocation->second});
    }
    if(decision.snapshot_sequence<=manager_.last_resize_sequence_) return reject("Stale or replayed snapshot sequence",false,true);
    for(const auto& binding:bindings_) {
        queues.emplace_back(binding.buffer->mutex_,std::try_to_lock);
        if(!queues.back()) return reject("Queue busy; retry with a fresh observation",true);
    }
    for(size_t i=0;i<bindings_.size();++i) {
        const auto& b=bindings_[i]; const auto& r=*ordered[i]; const auto& q=*b.buffer;
        const auto recorded=manager_.allocations_.at(b.stream_id);
        if(q.capacity_!=recorded || recorded!=r.current_capacity)
            return reject("Stale expected capacity or physical/accounting mismatch",false,true);
        if(q.closed_) return reject("Closed queue cannot be resized",true);
        if(q.count_>r.desired_capacity) return reject("Unsafe shrink deferred: live occupancy exceeds target",true);
    }
    static_assert(std::is_nothrow_copy_assignable<Request>::value,"Staging FIFO copies must not throw");
    for(size_t i=0;i<bindings_.size();++i) {
        const auto& q=*bindings_[i].buffer;
        if(ordered[i]->current_capacity==ordered[i]->desired_capacity) continue;
        for(size_t j=0;j<q.count_;++j) staging[i][j]=q.ring_buffer_[(q.head_+j)%q.capacity_];
    }
    result.reason="Applied physical queue capacities and resource accounting atomically";
    // All potentially failing work precedes commit. Shrinks precede growth to respect
    // the slot budget even during the inaccessible intermediate commit state.
    for(int pass=0;pass<2;++pass) for(size_t i=0;i<bindings_.size();++i) {
        auto& q=*bindings_[i].buffer; const auto& r=*ordered[i];
        if(r.current_capacity==r.desired_capacity || ((r.desired_capacity<r.current_capacity)!=(pass==0))) continue;
        q.updateOccupancyStatsUnderLock();
        q.ring_buffer_.swap(staging[i]); q.capacity_=r.desired_capacity;
        q.head_=0; q.tail_=q.count_%q.capacity_;
        q.max_occupancy_pct_=std::max(q.max_occupancy_pct_,q.count_*100.0/q.capacity_);
        manager_.allocations_.at(r.stream_id)=r.desired_capacity;
    }
    manager_.total_allocated_=desired_total;
    manager_.last_resize_sequence_=decision.snapshot_sequence;
    for(size_t i=0;i<result.streams.size();++i) result.streams[i].actual_capacity=ordered[i]->desired_capacity;
    result.success=true;
    for(auto& queue:queues) queue.unlock();
    resource.unlock();
    for(size_t i=0;i<bindings_.size();++i)
        if(ordered[i]->desired_capacity>ordered[i]->current_capacity) bindings_[i].buffer->not_full_.notify_all();
    return result;
}

std::string ResizeResult::toJson() const {
    std::ostringstream out;
    out << "{\"type\":\"buffer_resize\",\"snapshot_sequence\":" << snapshot_sequence
        << ",\"success\":" << (success?"true":"false")
        << ",\"deferred\":" << (deferred?"true":"false")
        << ",\"stale\":" << (stale?"true":"false")
        << ",\"reason\":" << std::quoted(reason) << ",\"streams\":[";
    for(size_t i=0;i<streams.size();++i) {
        if(i) out << ',';
        const auto& stream=streams[i];
        out << "{\"stream_id\":" << stream.stream_id
            << ",\"previous_capacity\":" << stream.previous_capacity
            << ",\"requested_capacity\":" << stream.requested_capacity
            << ",\"actual_capacity\":" << stream.actual_capacity << '}';
    }
    out << "]}";
    return out.str();
}
