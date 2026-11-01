import { ArrowDown, Boxes, Activity, Cpu, Network, Monitor, Database, GitBranch } from 'lucide-react';
const stages = [
  { title: 'Frontend Dashboard', detail: 'React configuration workspace and live visualization', icon: Monitor },
  { title: 'Express API', detail: 'POST runs / cancel; GET health, runs, status, telemetry and results', icon: Network },
  { title: 'Native Process Management', detail: 'Trusted executable spawn, timeout or cancel termination, and close-confirmed run status', icon: Cpu },
  { title: 'Native C++ Simulation', detail: 'Executes the configured workload with independent producer and consumer threads', icon: Cpu },
  { title: 'Buffer Resource Manager', detail: 'Owns the global slot budget and applies safe capacity changes', icon: Database },
  { title: 'Bounded I/O Streams', detail: 'Producer → bounded buffer → consumer, synchronized with condition variables', icon: Boxes },
  { title: 'Metrics and Adaptive Controller', detail: 'Measures throughput, waiting and occupancy; proposes budget-constrained allocation', icon: GitBranch },
  { title: 'Telemetry and Results', detail: 'Native NDJSON snapshots, resize outcomes and a validated completion record', icon: Activity },
  { title: 'Frontend Visualization', detail: 'Renders measured samples, run state and successful final results', icon: Monitor },
];
export default function Architecture() {
  return <><div className="page-heading"><div><h1>System Architecture</h1><p>From workload configuration to measured native behavior.</p></div></div><div className="architecture-layout"><section className="panel"><h2>Execution and observation flow</h2><ol className="architecture-flow">{stages.map(({ title, detail, icon: Icon }, index) => <li key={title}><div className="architecture-stage"><Icon size={20} aria-hidden="true" /><div><strong>{title}</strong><p className="muted">{detail}</p></div></div>{index < stages.length - 1 && <ArrowDown size={16} aria-hidden="true" className="flow-arrow" />}</li>)}</ol></section><aside className="panel"><span className="eyebrow">RESPONSIBILITY BOUNDARIES</span><h2>A view into the native engine</h2><h3>Backend bridge</h3><p>Accepts supported configurations, starts the trusted executable, limits concurrency and safely parses incremental telemetry. History and telemetry retention are bounded and in memory.</p><h3>Adaptive allocation</h3><p>The C++ controller proposes capacity changes from observed buffer pressure. The runtime executor applies feasible changes while preserving queued requests and the global budget. Fixed runs keep their configured capacities.</p><h3>Measured telemetry</h3><p>Snapshots use the engine’s elapsed time and measurement windows. Resize outcomes include previous, requested and actual capacities. Backend receipt timestamps describe delivery time separately.</p><h3>Frontend scope</h3><p>The UI configures and observes runs. It does not implement the adaptive algorithm, guarantee an improvement, or infer native progress. Cancellation terminates the simulation process; a final successful result is not guaranteed.</p></aside></div></>;
}

