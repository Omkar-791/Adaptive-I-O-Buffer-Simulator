# Phase 13 comparison workflow contract

This is an additive client workflow over the unchanged Phase10 REST contract.
There is no comparison registry or persistent storage.

| Operation | Existing request | Response / error behavior |
|---|---|---|
| Pick source or historical runs | GET /api/v1/runs?limit=100 | bounded in-memory summaries; refresh explicitly |
| Launch pair | POST /api/v1/runs twice with identical config/metrics, strategy fixed then adaptive | each independent 202; 422 invalid config, 503 admission/stopping; either can report failed launch in its summary |
| Observe each member | GET /runs/:id then /telemetry?after=cursor&limit=100 | sequential per-run polling, bounded retention, 404 on eviction |
| Obtain measured comparison | GET /runs/:id/result for completed members only | native final JSON; 409 otherwise |
| Terminate a member | POST /runs/:id/cancel | 202 request, authoritative state polled; 409 terminal |
| Export | client Blob download, no new HTTP method | JSON or CSV contains actual fetched data and explicit null/unavailable fields |

Launches may overlap and compete for CPU/timers. This is not a transactional launch:
if fixed is admitted but adaptive is rejected, fixed remains visible and controllable.
No retry automatically creates duplicate simulations. The user can select retained
runs or launch a fresh pair. Existing backend limits may reject even one member.

Comparison requires fixed/adaptive roles and identical effective config and sampling
settings (ignoring object-key and stream-array order). Final counts and per-stream
bytes must also agree. Seeded nominal inputs match; the simulator API does not expose
Phase8 producer checksums, executable hashes, plan IDs, repetitions or a statistical
significance contract. Exports identify this provenance limitation explicitly.

Throughput is whole-run req/s; mean latency and cumulative producer wait are ms.
Delta is adaptive minus fixed; percent is unavailable when fixed is zero. Failed,
cancelled, timed-out, pending or mismatched members never produce a winner or metric
comparison. They remain exportable with their actual status/error and null results.
Telemetry is the bounded client-observed subset, not a complete raw experiment log;
backend/client truncation flags and observation errors are exported.
