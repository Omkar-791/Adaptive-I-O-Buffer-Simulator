# Phase 11 wireframes

Seven editable, neutral SVG wireframes define the approved information hierarchy and layout. Desktop uses a224px navigation rail,60px header and24px main gutter. Dashboard charts use paired panels; mobile uses independent stacked panels and internally scrolling tables. New Simulation places the live summary beside the form on desktop and below it on mobile. No values in these planning artifacts are production telemetry.

Mapping: Dashboard -> App/Dashboard + RunView; New Simulation -> NewRun; Run Details -> RunContent + RunView/MetricChart; History -> History; Architecture -> Architecture. The shell is shared. Tab content replaces its region rather than displaying every tab concurrently. API-unavailable adaptive thresholds are explained rather than exposed as invented inputs.

The revised wireframe requirement arrived after the initial shell implementation had started under the previous specification. This set was added before further implementation and used for the visual alignment pass. SVG sources and rendered browser screenshots are inspected during Phase11 verification; generated verification images remain ignored.

## Phase13 analysis wireframes

analysis-desktop.svg and analysis-mobile.svg specify the History analysis section: source/pair controls, selected IDs, evidence disclosure, exact values/charts, actual resize timelines and export controls. Both use the existing graphite/teal tokens. They were rendered and inspected before implementation; final real desktop/mobile screenshots were inspected against this hierarchy.
