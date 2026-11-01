cmake_minimum_required(VERSION 3.15)
project(AdaptiveIOSimulator VERSION 0.2.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Enable compiler warnings
if(MSVC)
    add_compile_options(/W4 /permissive-)
else()
    add_compile_options(-Wall -Wextra -Wpedantic)
endif()

# Threading library
find_package(Threads REQUIRED)

# Common library for simulation engine
add_library(simulation_core STATIC
    engine/src/Request.cpp
    engine/src/BoundedBuffer.cpp
    engine/src/Producer.cpp
    engine/src/Consumer.cpp
    engine/src/IOStream.cpp
    engine/src/StreamManager.cpp
    engine/src/BufferResourceManager.cpp
    engine/src/WorkloadGenerator.cpp
    engine/src/ConfigParser.cpp
    engine/src/ExperimentRunner.cpp
    engine/src/RuntimeResizeExecutor.cpp
    engine/src/AdaptiveController.cpp
    engine/src/MetricsEngine.cpp
    engine/src/Metrics.cpp
    engine/src/Simulation.cpp
)

target_include_directories(simulation_core PUBLIC
    engine/include
)

target_link_libraries(simulation_core PUBLIC
    Threads::Threads
)

# Main simulation CLI executable
add_executable(adaptive_io_sim
    engine/src/main.cpp
)
target_link_libraries(adaptive_io_sim PRIVATE simulation_core)

# Unit tests
add_executable(test_bounded_buffer
    engine/tests/test_bounded_buffer.cpp
)
target_link_libraries(test_bounded_buffer PRIVATE simulation_core)

# Integration tests
add_executable(test_simulation
    engine/tests/test_simulation.cpp
)
target_link_libraries(test_simulation PRIVATE simulation_core)

# Multi-stream tests (Phase 2)
add_executable(test_multi_stream
    engine/tests/test_multi_stream.cpp
)
target_link_libraries(test_multi_stream PRIVATE simulation_core)

# Resource Manager tests (Phase 3)
add_executable(test_resource_manager
    engine/tests/test_resource_manager.cpp
)
target_link_libraries(test_resource_manager PRIVATE simulation_core)

# Workload Generator tests (Phase 4)
add_executable(test_workload_generator
    engine/tests/test_workload_generator.cpp
)
target_link_libraries(test_workload_generator PRIVATE simulation_core)


add_executable(test_metrics_engine engine/tests/test_metrics_engine.cpp)
target_link_libraries(test_metrics_engine PRIVATE simulation_core)
add_executable(test_adaptive_controller engine/tests/test_adaptive_controller.cpp)
target_link_libraries(test_adaptive_controller PRIVATE simulation_core)
add_executable(test_runtime_resizing engine/tests/test_runtime_resizing.cpp)
target_link_libraries(test_runtime_resizing PRIVATE simulation_core)
add_executable(experiment_runner engine/tools/experiment_main.cpp)
target_link_libraries(experiment_runner PRIVATE simulation_core)
add_executable(test_experiment_runner engine/tests/test_experiment_runner.cpp)
target_link_libraries(test_experiment_runner PRIVATE simulation_core)
enable_testing()
foreach(suite bounded_buffer simulation multi_stream resource_manager workload_generator metrics_engine adaptive_controller runtime_resizing experiment_runner)
    # These standalone suites use assert; keep checks active in Release too.
    if(MSVC)
        target_compile_options(test_${suite} PRIVATE /UNDEBUG)
    else()
        target_compile_options(test_${suite} PRIVATE -UNDEBUG)
    endif()
    add_test(NAME ${suite} COMMAND test_${suite})
endforeach()

find_package(Python3 COMPONENTS Interpreter QUIET)
if(Python3_Interpreter_FOUND)
    add_test(NAME experiment_statistics COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/scripts/test_experiments.py)
    add_test(NAME experiment_workflow COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/scripts/test_workflow_phase9.py)
    add_test(NAME experiment_exports COMMAND ${Python3_EXECUTABLE} ${CMAKE_CURRENT_SOURCE_DIR}/scripts/test_exports_phase9.py)
endif()
