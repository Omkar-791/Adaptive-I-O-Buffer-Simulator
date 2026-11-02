"""Read-only descriptive plots of the tracked Phase9 corpus; no simulations run."""
import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import statistics
import sys

ROOT = Path(__file__).resolve().parents[1]
METRICS = ('throughput_req_per_sec', 'avg_latency_ms', 'producer_wait_ms',
           'p50_latency_upper_ms', 'p95_latency_upper_ms', 'average_utilization_pct')


def load_records(source):
    records = [json.loads(line) for line in Path(source).read_text(encoding='utf-8').splitlines() if line.strip()]
    pairs = {}
    ids = set()
    for r in records:
        if r.get('schema_version') != 1 or r.get('type') != 'experiment_result':
            raise ValueError('Unsupported experiment schema')
        if not r.get('success') or not r.get('workload_equivalent'):
            raise ValueError('Failed/incomplete input retained: refuse to silently exclude it')
        if r['run_id'] in ids:
            raise ValueError('Duplicate run ID')
        ids.add(r['run_id'])
        if r['strategy'] not in ('fixed_equal', 'adaptive'):
            raise ValueError('Unsupported strategy')
        m = r['measurements']
        if any(not isinstance(m[k], (float, int)) or not math.isfinite(m[k]) or m[k] < 0 for k in METRICS):
            raise ValueError('Invalid measured value')
        if m['p50_latency_upper_ms'] > m['p95_latency_upper_ms']:
            raise ValueError('Invalid quantile ordering')
        if m['total_produced'] != m['total_consumed'] or m['total_consumed'] != r['request_count']:
            raise ValueError('Incomplete counts')
        physical = sorted(r['actual_final_capacities'], key=lambda s: s['stream_id'])
        if physical != sorted(r['final_allocations'], key=lambda s: s['stream_id']):
            raise ValueError('Physical/accounting mismatch')
        if sum(s['capacity'] for s in physical) > r['global_buffer_budget']:
            raise ValueError('Budget exceeded')
        group = pairs.setdefault(r['pair_id'], {})
        if r['strategy'] in group:
            raise ValueError('Duplicate strategy within pair')
        group[r['strategy']] = r
    if not records:
        raise ValueError('Empty input')
    for pair in pairs.values():
        if set(pair) != {'fixed_equal', 'adaptive'}:
            raise ValueError('Missing paired strategy')
        f, a = pair['fixed_equal'], pair['adaptive']
        for key in ('config_id', 'workload', 'seed', 'repetition', 'configs', 'limits',
                    'initial_allocations', 'metrics_config', 'controller_config',
                    'input_fingerprint', 'global_buffer_budget'):
            if f[key] != a[key]:
                raise ValueError('Mismatched paired ' + key)
        if f['measurements']['total_bytes'] != a['measurements']['total_bytes']:
            raise ValueError('Mismatched paired bytes')
        if f['actual_final_capacities'] != f['initial_allocations'] or f['resize_successful']:
            raise ValueError('Fixed allocations changed')
    return records


def aggregate(records):
    rows = []
    for workload, budget in sorted({(r['workload'], r['global_buffer_budget']) for r in records}):
        for strategy in ('fixed_equal', 'adaptive'):
            group = [r for r in records if (r['workload'], r['global_buffer_budget'], r['strategy']) == (workload, budget, strategy)]
            if not group:
                raise ValueError('Missing cell strategy')
            for metric in (*METRICS, 'final_allocated_budget_pct'):
                values = [(100 * sum(s['capacity'] for s in r['actual_final_capacities']) / budget)
                          if metric == 'final_allocated_budget_pct' else r['measurements'][metric] for r in group]
                rows.append(dict(workload=workload, budget=budget, strategy=strategy, metric=metric,
                                 n=len(values), mean=statistics.mean(values),
                                 sample_sd=statistics.stdev(values) if len(values) > 1 else None,
                                 minimum=min(values), maximum=max(values)))
    return rows


def generate(source, output):
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    records = load_records(source)
    rows = aggregate(records)
    if any(r['n'] != 8 for r in rows):
        raise ValueError('This Phase9 figure layout requires eight runs per strategy/cell')
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    names = sorted({r['workload'] for r in records})
    budgets = sorted({r['global_buffer_budget'] for r in records})
    colors = {'fixed_equal': '#3667a6', 'adaptive': '#17816f'}
    labels = {'fixed_equal': 'Fixed equal', 'adaptive': 'Adaptive'}
    plt.rcParams.update({'font.family': 'DejaVu Sans', 'font.size': 10, 'axes.spines.top': False, 'axes.spines.right': False})
    artifacts = []

    def panel(ax, budget, metric, dots=True):
        for offset, strategy in [(-.18, 'fixed_equal'), (.18, 'adaptive')]:
            cells = [next(r for r in rows if (r['workload'], r['budget'], r['strategy'], r['metric']) == (w, budget, strategy, metric)) for w in names]
            positions = [i+offset for i in range(len(names))]
            ax.bar(positions, [c['mean'] for c in cells], .34, label=labels[strategy], color=colors[strategy], alpha=.85)
            ax.errorbar(positions, [c['mean'] for c in cells], yerr=[c['sample_sd'] or 0 for c in cells], fmt='none', ecolor='#242424', capsize=3, linewidth=1)
            if dots:
                for x,w in zip(positions,names):
                    runs = [r for r in records if (r['workload'], r['global_buffer_budget'], r['strategy']) == (w,budget,strategy)]
                    values = [100*sum(s['capacity'] for s in r['actual_final_capacities'])/budget if metric=='final_allocated_budget_pct' else r['measurements'][metric] for r in runs]
                    ax.scatter([x+(i-(len(values)-1)/2)*.018 for i in range(len(values))], values, color='#222222', s=9, zorder=4, alpha=.6)
        ax.set_xticks(range(len(names)), [w.removeprefix('phase9_') for w in names], rotation=15)
        ax.set_title(f'Budget = {budget} logical slots')
        ax.grid(axis='y', alpha=.2); ax.set_axisbelow(True)

    def save(fig, name, definition):
        fig.savefig(output/(name+'.png'), dpi=300, metadata={'Software': 'Adaptive IO Phase15 / matplotlib'})
        plt.close(fig)
        artifacts.append(dict(file=name+'.png', definition=definition))

    fig, axes = plt.subplots(1,len(budgets),figsize=(13,4.8),squeeze=False,layout='constrained')
    for ax,budget in zip(axes[0],budgets):
        panel(ax,budget,'throughput_req_per_sec');ax.set_ylabel('Whole-run throughput (requests/s)')
    axes[0,0].legend();fig.suptitle('Throughput by workload profile — means ± sample SD; dots are all runs (n=8/cell)')
    save(fig,'throughput_workload','Workload categories, separated budgets; run throughput means/sample SD, no significance inference.')

    fig, axes = plt.subplots(len(budgets),len(names),figsize=(14,7),squeeze=False,layout='constrained')
    for row,budget in zip(axes,budgets):
        for ax,w in zip(row,names):
            for off,strategy in [(-.15,'fixed_equal'),(.15,'adaptive')]:
                runs=[r for r in records if (r['workload'],r['global_buffer_budget'],r['strategy'])==(w,budget,strategy)]
                for index,key in enumerate(('p50_latency_upper_ms','p95_latency_upper_ms')):
                    values=[r['measurements'][key] for r in runs]
                    if any(v<=0 for v in values):raise ValueError('Log percentile panel requires positive bounds')
                    ax.scatter([index+off+(i-3.5)*.013 for i in range(len(values))],values,s=14,color=colors[strategy],alpha=.7)
                    ax.plot([index+off-.09,index+off+.09],[statistics.mean(values)]*2,color=colors[strategy],linewidth=3,label=labels[strategy] if index==0 else None)
            ax.set_yscale('log');ax.set_xticks([0,1],['p50 bound','p95 bound']);ax.set_ylabel('Histogram upper bound (ms, log)');ax.set_title(f'{w.removeprefix("phase9_")} / budget {budget}');ax.grid(axis='y',alpha=.2)
    axes[0,0].legend(fontsize=8);fig.suptitle('Per-run histogram percentile upper bounds — dots: 8 runs; line: mean of run bounds\nNot pooled percentiles; exact p50/p95 and p99 are unavailable')
    save(fig,'latency_bounds','Per-run whole-run p50/p95 histogram upper boundaries, not exact or pooled request percentiles.')

    fig, axes=plt.subplots(2,len(budgets),figsize=(13,8),squeeze=False,layout='constrained')
    for col,budget in enumerate(budgets):
        for row,key in enumerate(('final_allocated_budget_pct','average_utilization_pct')):
            panel(axes[row,col],budget,key);axes[row,col].set_ylabel('Final allocated slots / budget (%)' if row==0 else 'Occupancy-time / capacity-time (%)');axes[row,col].set_ylim(bottom=0)
    axes[0,0].legend();fig.suptitle('Logical buffer-resource allocation — means ± sample SD; all runs shown\nFinal allocation and time utilization are different metrics; neither is process memory')
    save(fig,'resource_allocation','Final logical allocation fraction and measured capacity-time utilization; no RSS/heap or byte-memory equivalence.')

    with (output/'figure_data.csv').open('w',newline='',encoding='utf-8') as f:
        writer=csv.DictWriter(f,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    def digest(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
    manifest=dict(schema_version=1,source=Path(source).resolve().relative_to(ROOT).as_posix(),source_sha256=digest(source),
                  script_sha256=digest(__file__),python=sys.version.split()[0],matplotlib=matplotlib.__version__,
                  run_count=len(records),pair_count=len(records)//2,failed_runs=sum(not r['success'] for r in records),excluded_runs=0,
                  command='python scripts/plot_phase15.py',figures=artifacts,
                  output_sha256={a['file']:digest(output/a['file']) for a in artifacts},
                  unavailable=['exact request percentiles','p99','process RSS/heap','exact global peak utilization'],
                  notes='All runs retained; SD descriptive across seeds/repetitions. No trimming or significance claims.')
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
    print(f'Validated {len(records)} runs / {len(records)//2} pairs; generated {len(artifacts)} figures in {output}')


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=ROOT/'data/experiments/phase9_controlled/runs.jsonl')
    parser.add_argument('--output',type=Path,default=ROOT/'data/plots')
    args=parser.parse_args();generate(args.source,args.output)
