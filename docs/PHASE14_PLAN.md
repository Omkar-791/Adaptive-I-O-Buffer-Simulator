# Phase14 execution plan and baseline

Scope source: DEVELOPMENT_ROADMAP.md, Phase14 Testing and Integration. Explicit user
instructions preserve Phase11/13 and supersede the old Phase12 sketch. Initial branch
main at67897ba; six existing data/audit_* and validation scratch files remain untouched.

Baseline inventory: build_phase14/protected.json hashes tracked client/server/engine/
configs/scripts/historical experiment files before implementation. Existing frameworks:
nine assert-based native suites, Node built-in test, Vitest, Playwright, Python unittest.

| Requirement / roadmap source | Existing implementation | Required action | Verification / evidence |
|---|---|---|---|
| Comprehensive C++/Node/client integration, Phase14 Features | Real backend native tests and browser workflows; mocked unit failures | tests/integration_test.py coordinates trusted executable, server/client lifecycle and existing suites; label real and mocked stages | Python harness full run and JSON report |
| Extreme burst 10000+ req/sec, Features | Existing zero-delay producer/consumer supported | tests/stress_test.cpp uses actual Simulation, configurable bounded batches; actual completed/elapsed rate | Separate high-intensity smoke; threshold judged on measured output |
| Memory leaks ASan/Valgrind, Features/Criteria | No dedicated CMake sanitizer options | Isolated compiler-gated ASan option, Linux CI leak checker | Probe installed toolchain, execute where supported; report unavailable runtimes |
| Race detection TSan, Features/Criteria | Native concurrency/resizing suites | Separate mutually exclusive TSan build option/CI | Probe and run where supported; never substitute ordinary tests for race proof |
| Cross-platform build verification, Features | Windows GCC manual build; CMake file | CI Windows/Linux native build/test matrix | Fresh local GCC build; remote jobs unverified until executed |
| One-hour sustained dynamic resizing, Tests | No full-duration harness | Explicit full-hour mode, safe short default, retained events/errors/interrupt status | Smoke verifies harness only; hour acceptance requires actual complete duration |
| Zero leaks/races and clean shutdown, Completion Criteria | RunManager close/cancel and native join tests | Reuse lifecycle regressions plus integration owned-process cleanup | Separate unit injection, real process integration and sanitizer evidence |

Workstreams: native agent owns only CMakeLists, stress C++, CI; integration agent owns
only Python orchestrator; root owns roadmap/docs, preservation and frontend regressions.
No algorithm changes or new dependencies planned. Review delegated code before accepting.
New reports/builds live under ignored build_phase14; historical batches never overwritten.

Architecture audited: NewRun validates and sends typed CreateRun via centralized API;
Express validates bounded JSON, RunManager spawns trusted argv executable with shell:false,
isolated config, bounded NDJSON telemetry and authoritative successful-close result.
useRun performs sequential cursor polling and abort/terminal drain; RunView renders native
measurements. ComparisonView submits matched independent runs, canonical matching gates
result comparison, URL selectors and analysis.ts export actual result/event/error context.
Cancellation requests termination and waits on native close/cleanup. Existing failure
tests deliberately inject processes; they are not real end-to-end proof.

Resource policy: first run bounded smoke/high-rate batches; no unrestricted hour run by
default. Report sustained-hour execution separately from harness implementation. CMake,
sanitizer runtimes and a Linux host must be available before claiming their checks.
