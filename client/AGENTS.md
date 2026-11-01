# Adaptive I/O Lab — frontend implementation rules

## Identity and scope
- Build a technical I/O simulation/observability workspace named Adaptive I/O Lab, with a professional dark engineering interface. Follow the Phase11 master specification; no generic marketing/admin template.
- Work locally in client/ using React, Vite, strict TypeScript, React Router, Recharts and Lucide React. Do not modify native/controller/resizing algorithms or historical Phase8/9 measurements/reports.

## Design system
- All colors live in src/styles/tokens.css: background #0B0F12, sidebar #0E1316, surface #11171B, elevated #171F24, hover #202A30, text #E8EEF0, secondary #94A3AA, muted #65747B, border #27333A, accent #36D6C2, accent-subtle #123B38, success #4ADE80, warning #FBBF24, error #F87171, information #60A5FA. No arbitrary component colors. Use secondary rather than muted for readable small labels; muted is reserved for nonessential decoration/disabled treatments.
- Use system sans-serif; tabular numerals for metrics, IDs, counts and timestamps. Titles24–28px, sections15–17px, body13–14px, secondary11–12px, KPIs24–32px.
- Use a4px spacing scale,1px borders,6px controls/8px panels/10px modals, restrained transitions and minimal shadows. No gradients/glassmorphism/neon/decorative orbs/oversized rounded nested cards.
- Lucide icons: navigation18px, controls16px, status14px. Icon-only controls need accessible names and titles. Visible2px accent focus rings; semantic labels/status text; reduced-motion support; mobile touch targets44px.
- Desktop sidebar224px/header60px/padding24px/max-content1600px. At1024px compact navigation and2-column KPIs; at768px stack charts/forms; at<640px accessible navigation drawer/equivalent,2-column KPIs and horizontally scrolling tables. No page overflow at390px.
- Shared charts use token-based colors, subtle grids, explicit units/axis labels/readable tooltips and accessible descriptions. Lines are measured samples without fake interpolation; capacity uses step changes; no fake benchmarks or trends.

## Components and state
- Shared shell/UI components in src/components; feature/page components in src/pages or features. API definitions/types in src/api and src/types; all HTTP goes through one typed API client. Run/telemetry lifecycle lives in hooks/services, never duplicated across pages.
- Dashboard, New Simulation, Run Details, History and Architecture are required. Reuse dashboards/charts/KPIs/events/stream tables across overview/details. Details tabs use URL query state.
- Implement meaningful loading/skeleton, empty, error/retry and terminal states. No inactive buttons, excessive toasts or production demo data. Keep entered form values on errors and disable duplicate submissions.

## Authoritative backend contract
- Phase10 API is authoritative. Use /api/v1 health; POST/GET runs; GET runs/:id, telemetry, result; POST cancel. Requests use strategy fixed/adaptive and supported native config plus metrics. fixed means configured capacities, not benchmark fixed_equal.
- Status: starting/running/completed/failed/cancelled/timed_out. progress is null; never invent progress percentages. Cancel means process termination, never graceful shutdown. History is bounded/in-memory and can disappear after restart; evicted IDs404.
- Status returns effective configuration; display that, not merely form input. Backend names must be safe ASCII and known limits must match server/src/validation.js. The backend remains final authority.
- Telemetry polling uses after cursor, limit and server nextCursor/oldestCursor/truncated. Process successful responses before advancing; deduplicate backend indexes, cap client records at600, drain remaining terminal telemetry then stop; fetch result only on completed. No overlapping requests, abort on unmount/run change, bounded exponential retries with an explicit manual retry state. Communicate truncation: Some earlier telemetry is no longer retained by the backend.
- Native records: metrics_snapshot (native elapsed_ms/window_ms, global+streams), buffer_resize (snapshot_sequence,success,deferred,stale,reason,previous/requested/actual capacities), simulation_completed. Backend event index/receivedAt are separate wall-clock metadata. Do not replace native timing with UI polling time. Stream-specific state is unavailable: use run state explicitly, not invented stream worker states.
- KPIs must label window metrics versus whole-run final summaries. Missing values show an em dash and explanation. Resize reasons and unsuccessful attempts stay visible. Never present partial telemetry as a successful result.

## Verification
- Read this file before editing client files; all subagents must read it. Update it for lasting conventions.
- Run relevant frontend tests/build after changes. Preserve backend/C++/Python regressions. Use deterministic mock data only in tests, isolated from production.
- Real browser integration must launch fixed/adaptive runs, observe actual telemetry/resize/result and exercise truthful cancel. Render AND visually inspect screenshots:1440x900 Dashboard/New/Details/History and390x844 Dashboard/New. Also check1280/1024/768 for overflow. Do not claim visual verification without viewing the captured images.
- Keep dependencies/build/screenshots/browser artifacts ignored; no Git staging/committing unless asked. Document actual results and limitations; do not claim completion for unverified requirements.

## Lasting architecture conventions
- Phase13 analysis is embedded in History; wireframes are analysis-desktop.svg and analysis-mobile.svg. ComparisonView reuses useRun per distinct selected run, RunStrip and AllocationEvents. analysis.ts validates matched effective configurations and serializes truthful exports. No duplicated polling, database, new route or new styling system. Pair launches are independent existing POSTs; preserve partial success and disclose concurrent timing noise. Final comparisons require completed matched inputs/counts/bytes; all outcome directions are valid.
- Routes: /, /simulations/new (canonical), /runs/new (compatibility alias), /runs/:runId with URL query tabs, /history, /architecture. src/app owns routing/shell, src/pages owns forms/history, src/hooks/useRun owns lifecycle, src/components/Charts and RunView share measurements. Pure validation stays in pages/validation.ts. Use the existing custom CSS/token architecture established before the revised prompt; preserve this compatible stack.
- Approved layout references: docs/design/wireframes/. Read these before layout changes. Technical identifiers and numerical configuration values use monospace. Keep formatting helpers separate as reuse grows; keep components focused.
- Verify with npm run lint, npm run typecheck, npm run build, npm test, npm run test:e2e. Never silently swallow API errors. API base is VITE_API_BASE_URL, default /api/v1 through the local proxy.

