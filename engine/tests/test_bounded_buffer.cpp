#include "BoundedBuffer.h"
#include <iostream>
#include <cassert>
#include <thread>
#include <vector>
#include <atomic>
#include <chrono>

namespace {

void test1_push_pop_single() {
    std::cout << "[RUN] TEST 1: Push into empty buffer, then pop..." << std::flush;
    BoundedBuffer buffer(4);
    assert(buffer.isEmpty());
    assert(buffer.size() == 0);

    Request req1(101, 1024);
    bool pushed = buffer.push(std::move(req1));
    assert(pushed);
    assert(!buffer.isEmpty());
    assert(buffer.size() == 1);

    Request popped;
    bool pop_ok = buffer.pop(popped);
    assert(pop_ok);
    assert(popped.getId() == 101);
    assert(popped.getPayloadBytes() == 1024);
    assert(buffer.isEmpty());
    assert(buffer.size() == 0);
    std::cout << " PASSED\n";
}

void test2_fill_to_capacity_fifo() {
    std::cout << "[RUN] TEST 2: Fill buffer to capacity and verify FIFO order..." << std::flush;
    const size_t cap = 5;
    BoundedBuffer buffer(cap);

    for (size_t i = 1; i <= cap; ++i) {
        Request req(i, i * 100);
        bool pushed = buffer.push(std::move(req));
        assert(pushed);
        assert(buffer.size() == i);
    }
    assert(buffer.isFull());

    for (size_t i = 1; i <= cap; ++i) {
        Request popped;
        bool pop_ok = buffer.pop(popped);
        assert(pop_ok);
        assert(popped.getId() == i);
        assert(popped.getPayloadBytes() == i * 100);
    }
    assert(buffer.isEmpty());
    std::cout << " PASSED\n";
}

void test3_producer_blocks_when_full() {
    std::cout << "[RUN] TEST 3: Producer blocks when buffer is full..." << std::flush;
    const size_t cap = 2;
    BoundedBuffer buffer(cap);

    buffer.push(Request(1, 100));
    buffer.push(Request(2, 200));
    assert(buffer.isFull());

    std::atomic<bool> producer_entered_wait{false};
    std::atomic<bool> producer_finished{false};

    std::thread producer([&]() {
        producer_entered_wait = true;
        std::chrono::nanoseconds wait_time{0};
        bool pushed = buffer.push(Request(3, 300), &wait_time);
        assert(pushed);
        assert(wait_time.count() > 0);
        producer_finished = true;
    });

    // Wait until producer thread has started and is blocked
    while (!producer_entered_wait) {
        std::this_thread::yield();
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    // Producer must STILL be blocked because no one popped
    assert(producer_finished == false);

    // Now consumer pops one item, freeing a slot
    Request popped;
    bool pop_ok = buffer.pop(popped);
    assert(pop_ok);
    assert(popped.getId() == 1);

    producer.join();
    assert(producer_finished == true);
    assert(buffer.size() == 2);
    std::cout << " PASSED\n";
}

void test4_consumer_blocks_when_empty() {
    std::cout << "[RUN] TEST 4: Consumer blocks when buffer is empty..." << std::flush;
    BoundedBuffer buffer(4);
    assert(buffer.isEmpty());

    std::atomic<bool> consumer_started{false};
    std::atomic<bool> consumer_finished{false};
    uint64_t received_id = 0;

    std::thread consumer([&]() {
        consumer_started = true;
        Request popped;
        bool pop_ok = buffer.pop(popped);
        assert(pop_ok);
        received_id = popped.getId();
        consumer_finished = true;
    });

    while (!consumer_started) {
        std::this_thread::yield();
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    // Consumer must STILL be blocked waiting on empty buffer
    assert(consumer_finished == false);

    // Producer pushes item to wake consumer
    buffer.push(Request(999, 4096));

    consumer.join();
    assert(consumer_finished == true);
    assert(received_id == 999);
    assert(buffer.isEmpty());
    std::cout << " PASSED\n";
}

void test5_concurrent_producer_consumer() {
    std::cout << "[RUN] TEST 5: Concurrent producer/consumer (no loss or duplicate)..." << std::flush;
    const size_t num_items = 5000;
    BoundedBuffer buffer(8);

    std::thread producer([&]() {
        for (size_t i = 1; i <= num_items; ++i) {
            bool pushed = buffer.push(Request(i, 512));
            assert(pushed);
        }
    });

    std::vector<uint64_t> received_ids;
    received_ids.reserve(num_items);

    std::thread consumer([&]() {
        for (size_t i = 1; i <= num_items; ++i) {
            Request req;
            bool pop_ok = buffer.pop(req);
            assert(pop_ok);
            received_ids.push_back(req.getId());
        }
    });

    producer.join();
    consumer.join();

    assert(received_ids.size() == num_items);
    for (size_t i = 0; i < num_items; ++i) {
        assert(received_ids[i] == (i + 1));
    }
    std::cout << " PASSED\n";
}

void test6_close_empty_buffer_wakes_consumer() {
    std::cout << "[RUN] TEST 6: Close empty buffer releases waiting consumer..." << std::flush;
    BoundedBuffer buffer(4);

    std::atomic<bool> consumer_waiting{false};
    std::atomic<bool> pop_returned_false{false};

    std::thread consumer([&]() {
        consumer_waiting = true;
        Request req;
        bool pop_ok = buffer.pop(req);
        if (!pop_ok) {
            pop_returned_false = true;
        }
    });

    while (!consumer_waiting) {
        std::this_thread::yield();
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    assert(pop_returned_false == false);

    // Close buffer to unblock consumer
    buffer.close();

    consumer.join();
    assert(pop_returned_false == true);
    assert(buffer.isClosed());
    std::cout << " PASSED\n";
}

void test7_close_full_buffer_wakes_producer() {
    std::cout << "[RUN] TEST 7: Close full buffer releases waiting producer..." << std::flush;
    BoundedBuffer buffer(2);
    buffer.push(Request(1, 100));
    buffer.push(Request(2, 200));
    assert(buffer.isFull());

    std::atomic<bool> producer_waiting{false};
    std::atomic<bool> push_returned_false{false};

    std::thread producer([&]() {
        producer_waiting = true;
        bool pushed = buffer.push(Request(3, 300));
        if (!pushed) {
            push_returned_false = true;
        }
    });

    while (!producer_waiting) {
        std::this_thread::yield();
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(50));
    assert(push_returned_false == false);

    // Close buffer while producer is blocked
    buffer.close();

    producer.join();
    assert(push_returned_false == true);

    // Buffer still allows draining already-queued items
    Request r1, r2, r3;
    assert(buffer.pop(r1));
    assert(r1.getId() == 1);
    assert(buffer.pop(r2));
    assert(r2.getId() == 2);
    assert(!buffer.pop(r3)); // Drained and closed
    std::cout << " PASSED\n";
}

} // anonymous namespace

int main() {
    std::cout << "========================================\n";
    std::cout << "Running BoundedBuffer Unit Tests (Phase 1)\n";
    std::cout << "========================================\n";

    test1_push_pop_single();
    test2_fill_to_capacity_fifo();
    test3_producer_blocks_when_full();
    test4_consumer_blocks_when_empty();
    test5_concurrent_producer_consumer();
    test6_close_empty_buffer_wakes_consumer();
    test7_close_full_buffer_wakes_producer();

    std::cout << "========================================\n";
    std::cout << "All BoundedBuffer Tests Passed Successfully!\n";
    std::cout << "========================================\n";
    return 0;
}
