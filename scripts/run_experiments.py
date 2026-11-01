"""Counterbalanced paired experiments; only Python standard library required."""
import argparse
import datetime
import hashlib
import json
import math
import platform
import statistics
import subprocess
import sys
import os
import socket
import itertools
import uuid
from collections import defaultdict
from pathlib import Path
try:
    from atomic_io import atomic_replace
except ModuleNotFoundError as error:
    if error.name != 'atomic_io':
        raise
    import importlib.util
    specification = importlib.util.spec_from_file_location('experiment_atomic_io', Path(__file__).with_name('atomic_io.py'))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    atomic_replace = module.atomic_replace


def describe(values):
    values = list(values)
    if any(not math.isfinite(value) for value in values):
        raise ValueError('Statistics require finite measured values')
    return dict(count=len(values), mean=statistics.mean(values) if values else None,
                median=statistics.median(values) if values else None,
                stddev=statistics.stdev(values) if len(values) > 1 else None,
                min=min(values) if values else None, max=max(values) if values else None)


def relative_change(adaptive, fixed):
    return (adaptive - fixed) / fixed * 100 if fixed else None


METRICS = ('simulation_duration_sec', 'throughput_req_per_sec', 'throughput_mb_per_sec',
           'avg_latency_ms', 'p50_latency_upper_ms', 'p95_latency_upper_ms',
           'producer_wait_ms', 'consumer_wait_ms', 'average_utilization_pct',
           'peak_stream_utilization_pct')


def summarize(records):
    grouped = defaultdict(list)
    paired = defaultdict(dict)
    for record in records:
        grouped[(record.get('config_id', record['workload']), record['strategy'])].append(record)
        identity = (record.get('config_id', record['workload']), record['seed'], record['repetition'])
        if record['strategy'] in paired[identity]:
            raise ValueError('Duplicate paired run identity')
        paired[identity][record['strategy']] = record
    groups = []
    for (workload, strategy), runs in sorted(grouped.items()):
        good = [r for r in runs if r['success'] and r.get('workload_equivalent') and r.get('measurements')]
        metrics = {key: describe(r['measurements'][key] for r in good) for key in METRICS}
        metrics.update({key: describe(r[key] for r in good) for key in
                        ('resize_successful', 'resize_deferred', 'resize_rejected')})
        groups.append(dict(workload=runs[0]['workload'], config_id=workload, strategy=strategy, attempted=len(runs),
                           successful=len(good), failed=len(runs)-len(good), metrics=metrics))
    comparisons = []
    for workload in sorted({r.get('config_id', r['workload']) for r in records}):
        pairs = []
        for (name, seed, repetition), strategies in sorted(paired.items()):
            if name != workload or set(strategies) != {'fixed_equal', 'adaptive'}:
                continue
            fixed, adaptive = strategies['fixed_equal'], strategies['adaptive']
            if not all(r['success'] and r.get('workload_equivalent') for r in (fixed, adaptive)):
                continue
            if fixed['input_fingerprint'] != adaptive['input_fingerprint'] or ('configs' in fixed and 'configs' in adaptive and fixed['configs'] != adaptive['configs']):
                raise ValueError('Paired workload fingerprint mismatch')
            pair = dict(seed=seed, repetition=repetition)
            for key in ('throughput_req_per_sec', 'avg_latency_ms'):
                f, a = fixed['measurements'][key], adaptive['measurements'][key]
                pair[key] = dict(absolute=a-f, relative_pct=relative_change(a, f))
            pairs.append(pair)
        display_name = next(r['workload'] for r in records if r.get('config_id', r['workload']) == workload)
        comparison = dict(workload=display_name, config_id=workload, successful_pairs=len(pairs), paired_differences={})
        for key in ('throughput_req_per_sec', 'avg_latency_ms'):
            comparison['paired_differences'][key] = dict(
                absolute=describe(p[key]['absolute'] for p in pairs),
                relative_pct=describe(p[key]['relative_pct'] for p in pairs if p[key]['relative_pct'] is not None))
        means = {(g['strategy']): g for g in groups if g['config_id'] == workload}
        comparison['difference_of_means'] = {}
        for key in ('throughput_req_per_sec', 'avg_latency_ms'):
            if all(s in means and means[s]['successful'] for s in ('fixed_equal', 'adaptive')):
                f, a = (means[s]['metrics'][key]['mean'] for s in ('fixed_equal', 'adaptive'))
                comparison['difference_of_means'][key] = dict(absolute=a-f, relative_pct=relative_change(a, f))
        comparisons.append(comparison)
    return dict(schema_version=1, stddev_definition='sample SD (n-1); null for fewer than 2 runs',
                groups=groups, comparisons=comparisons)


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical_json(value).encode('utf-8')).hexdigest()


def write_json(path, value):
    """Atomic replacement; a crash may leave an ignored uniquely named staging file."""
    path = Path(path)
    temporary = path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    with temporary.open('x', encoding='utf-8') as stream:
        stream.write(json.dumps(value, indent=2, allow_nan=False)+'\n')
        stream.flush()
        os.fsync(stream.fileno())
    atomic_replace(temporary, path)


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--exe', type=Path, required=True)
    parser.add_argument('--configs', type=Path, nargs='+', required=True)
    parser.add_argument('--strategies', nargs='+', choices=('fixed_equal', 'adaptive'), default=['fixed_equal', 'adaptive'])
    parser.add_argument('--seeds', type=int, nargs='+', default=[42])
    parser.add_argument('--repetitions', type=int, default=3)
    parser.add_argument('--budget', type=int)
    parser.add_argument('--requests', type=int)
    parser.add_argument('--min-capacity', type=int, default=1)
    parser.add_argument('--max-capacity', type=int, default=64)
    parser.add_argument('--metrics-interval-ms', type=int, default=100)
    parser.add_argument('--metrics-window-ms', type=int, default=1000)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--timeout-sec', type=float, default=300)
    parser.add_argument('--grid', type=Path, help='JSON arrays: budgets, requests, metrics_interval_ms, metrics_window_ms')
    parser.add_argument('--max-runs', type=int, default=10000, help='reject selected matrices above this size')
    parser.add_argument('--limit-cells', type=int, help='execute deterministic prefix of parameter/config cells; retain complete pairs')
    parser.add_argument('--resume', action='store_true')
    parser.add_argument('--plan-only', action='store_true')
    args = parser.parse_args(argv)
    if args.repetitions < 1 or not args.seeds or any(s < 0 or s > 2**32-1 for s in args.seeds):
        parser.error('Use positive repetitions and uint32 seeds')
    if len(set(args.seeds)) != len(args.seeds) or len(set(args.strategies)) != len(args.strategies):
        parser.error('Duplicate seeds/strategies would duplicate run identities')
    if len({p.stem for p in args.configs}) != len(args.configs):
        parser.error('Configuration stems must be unique')
    if args.min_capacity < 1 or args.max_capacity < args.min_capacity:
        parser.error('Invalid capacity bounds')
    if not math.isfinite(args.timeout_sec) or args.timeout_sec <= 0:
        parser.error('Timeout must be finite and positive')
    if args.max_runs < 1 or args.limit_cells is not None and args.limit_cells < 1:
        parser.error('Matrix limits must be positive')
    return args


GRID_FIELDS = ('budgets', 'requests', 'metrics_interval_ms', 'metrics_window_ms')


def build_plan(args):
    """Expand supported dimensions in a fixed order without materializing unselected cells."""
    exe = args.exe.resolve(strict=True)
    configs = [path.resolve(strict=True) for path in args.configs]
    sources = [dict(path=str(path), name=path.stem, sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                    contents=path.read_text(encoding='utf-8')) for path in configs]
    shapes = {}
    for source in sources:
        document = json.loads(source['contents'])
        if not isinstance(document, dict):
            raise ValueError('Configuration root must be an object')
        heterogeneous = isinstance(document.get('streams'), list)
        if heterogeneous:
            streams = document['streams']
            if not streams or any(not isinstance(stream, dict) for stream in streams):
                raise ValueError('Heterogeneous source requires nonempty object streams')
            ids = [stream.get('stream_id', index) for index, stream in enumerate(streams)]
            source_minimum = args.min_capacity
        else:
            count = document.get('num_streams', 1)
            if type(count) is not int or count < 1 or count > 2**32:
                raise ValueError('Invalid source stream count')
            streams = [document] * count
            ids = list(range(count))
            source_minimum = max(args.min_capacity, document.get('min_buffer_capacity', 1))
        if any(type(stream_id) is not int or not 0 <= stream_id <= 2**32-1 for stream_id in ids) or len(set(ids)) != len(ids):
            raise ValueError('Invalid/duplicate source stream IDs')
        capacities = [stream.get('buffer_capacity', 8) for stream in streams]
        if any(type(capacity) is not int or capacity < 1 for capacity in capacities):
            raise ValueError('Invalid source initial capacities')
        if type(source_minimum) is not int or not 1 <= source_minimum <= args.max_capacity:
            raise ValueError('Source minimum exceeds configured capacity bounds')
        default_budget = document.get('global_buffer_budget') or sum(capacities)
        if type(default_budget) is not int or default_budget < 1:
            raise ValueError('Invalid configured global budget')
        shapes[source['path']] = dict(ids=sorted(ids), minimum=source_minimum, default_budget=default_budget, source=document)
    grid = json.loads(args.grid.read_text(encoding='utf-8')) if args.grid else {}
    if not isinstance(grid, dict) or set(grid)-set(GRID_FIELDS):
        raise ValueError('Grid must be an object containing only '+', '.join(GRID_FIELDS))
    defaults = dict(budgets=args.budget, requests=args.requests,
                    metrics_interval_ms=args.metrics_interval_ms, metrics_window_ms=args.metrics_window_ms)
    dimensions = []
    for field in GRID_FIELDS:
        values = grid.get(field, [defaults[field]])
        if not isinstance(values, list) or not values or len({canonical_json(v) for v in values}) != len(values):
            raise ValueError('Grid dimensions must be nonempty lists without duplicate values: '+field)
        for value in values:
            if value is None and field in ('budgets', 'requests') and field not in grid:
                continue
            if type(value) is not int or value < (0 if field == 'requests' else 1):
                raise ValueError('Invalid grid value for '+field)
        dimensions.append(values)
    # Reject invalid combinations even when they happen to fall beyond a selected prefix.
    if max(dimensions[2]) > min(dimensions[3]):
        raise ValueError('Every metrics window must be >= every sampling interval in the Cartesian grid')
    if max(dimensions[3]) > 86400000 or max(dimensions[3])//min(dimensions[2]) > 100000:
        raise ValueError('Grid metrics window exceeds engine limits')
    all_cells = len(sources)*math.prod(len(values) for values in dimensions)
    selected_cells = min(all_cells, args.limit_cells) if args.limit_cells else all_cells
    total_runs = selected_cells*len(args.seeds)*args.repetitions*len(args.strategies)
    if total_runs > args.max_runs:
        raise ValueError(f'Matrix plans {total_runs} runs, exceeding --max-runs {args.max_runs}; use --limit-cells')
    executable_sha256 = hashlib.sha256(exe.read_bytes()).hexdigest()
    cells, runs = [], []
    block = 0
    for source in sources:
        for values in itertools.product(*dimensions):
            if len(cells) >= selected_cells:
                break
            parameters = dict(zip(GRID_FIELDS, values))
            shape = shapes[source['path']]
            effective_budget = shape['default_budget'] if parameters['budgets'] is None else parameters['budgets']
            if effective_budget < len(shape['ids'])*shape['minimum']:
                raise ValueError('Grid budget cannot satisfy all source/global minimum capacities')
            level = min(args.max_capacity, effective_budget//len(shape['ids']))
            remainder = min(len(shape['ids']), effective_budget-level*len(shape['ids'])) if level < args.max_capacity else 0
            expected_initial = [dict(stream_id=stream_id, capacity=level+(index<remainder)) for index,stream_id in enumerate(shape['ids'])]
            identity = dict(source_sha256=source['sha256'], workload=source['name'], parameters=parameters,
                            min_capacity=shape['minimum'], max_capacity=args.max_capacity)
            config_id = digest(identity)
            cell = dict(identity, config_id=config_id, source_path=source['path'])
            cells.append(cell)
            for seed in args.seeds:
                for repetition in range(args.repetitions):
                    pair_id = digest(dict(config_id=config_id, executable_sha256=executable_sha256, seed=seed, repetition=repetition))
                    order = list(args.strategies)
                    if block % 2:
                        order.reverse()
                    block += 1
                    for execution_order, strategy in enumerate(order):
                        run_id = digest(dict(pair_id=pair_id, strategy=strategy))
                        command = [str(exe), '--config', source['path'], '--name', source['name'],
                                   '--strategy', strategy, '--seed', str(seed), '--repetition', str(repetition),
                                   '--min-capacity', str(args.min_capacity), '--max-capacity', str(args.max_capacity),
                                   '--metrics-interval-ms', str(parameters['metrics_interval_ms']),
                                   '--metrics-window-ms', str(parameters['metrics_window_ms'])]
                        for field, option in [('budgets', '--budget'), ('requests', '--requests')]:
                            if parameters[field] is not None:
                                command += [option, str(parameters[field])]
                        runs.append(dict(run_id=run_id, pair_id=pair_id, config_id=config_id,
                                         workload=source['name'], strategy=strategy, seed=seed,
                                         repetition=repetition, execution_order=execution_order,
                                         parameters=parameters, min_capacity=shape['minimum'],
                                         max_capacity=args.max_capacity, expected_budget=effective_budget,
                                         expected_initial_allocations=expected_initial, source_config=shape['source'], command=command))
    if len({run['run_id'] for run in runs}) != len(runs):
        raise ValueError('Expanded plan contains duplicate run identities')
    workflow_sources = [dict(path=str(path.resolve()), sha256=hashlib.sha256(path.read_bytes()).hexdigest()) for path in (Path(__file__), Path(__file__).with_name('experiment_exports.py'), Path(__file__).with_name('atomic_io.py')) if path.is_file()]
    plan = dict(schema_version=2, workflow_sources=workflow_sources, executable=str(exe), executable_sha256=executable_sha256,
                sources=sources, cells=cells, runs=runs, total_runs=total_runs,
                full_cell_count=all_cells, selected_cell_count=selected_cells, timeout_sec=args.timeout_sec,
                methodology='sequential fresh processes; reverse strategies on alternating pair blocks')
    plan['plan_id'] = digest(plan)
    return plan


def _matches_source(configs, run):
    source = run['source_config']
    heterogeneous = isinstance(source.get('streams'), list)
    supplied = source['streams'] if heterogeneous else [source for _ in range(source.get('num_streams',1))]
    if len(configs) != len(supplied):
        return False
    expected = {}
    for index, original in enumerate(supplied):
        stream_id = original.get('stream_id',index) if heterogeneous else index
        if stream_id in expected:
            return False
        expected[stream_id] = original
    if set(expected) != {config['stream_id'] for config in configs}:
        return False
    for config in configs:
        original = expected[config['stream_id']]
        for field, default in [('producer_interval_ms',5),('consumer_processing_ms',10),('min_payload_bytes',512),('max_payload_bytes',4096)]:
            if config[field] != original.get(field,default):
                return False
        requested = run['parameters']['requests']
        count = original.get('num_requests', source.get('num_requests',1000))
        if config['num_requests'] != (count if requested is None else requested):
            return False
        workload = original.get('workload')
        if isinstance(workload, dict):
            for field, value in workload.items():
                if field in ('seed','stream_id'):
                    continue
                if field == 'type':
                    value = {'CONSTANT':'STEADY','RANDOM':'STOCHASTIC','CUSTOM':'MIXED'}.get(str(value).upper(),str(value).upper())
                if field == 'phases':
                    if len(config['workload'].get('phases',[])) != len(value):
                        return False
                    for saved_phase, original_phase in zip(config['workload']['phases'],value):
                        if any(saved_phase.get(key) != item for key,item in original_phase.items()):
                            return False
                elif config['workload'].get(field) != value:
                    return False
        elif config['workload']['type'] != 'STEADY' or config['workload']['base_interval_ms'] != original.get('producer_interval_ms',5):
            return False
    return True


def valid_result(record, run):
    """Validate measurements and provenance before accepting or skipping a run."""
    try:
        required = {'type', 'schema_version', 'workload', 'strategy', 'seed', 'repetition', 'success',
                    'workload_equivalent', 'measurements', 'configs', 'input_fingerprint',
                    'initial_allocations', 'final_allocations', 'actual_final_capacities',
                    'global_buffer_budget', 'request_count', 'process_exit_code', 'resize_successful', 'resize_deferred', 'resize_rejected', 'build', 'controller_config', 'limits'}
        if not isinstance(record, dict) or not required <= record.keys():
            return False
        if record['type'] != 'experiment_result' or record['schema_version'] != 1 or record['success'] is not True or record['workload_equivalent'] is not True:
            return False
        if any(record[field] != run[field] for field in ('workload', 'strategy', 'seed', 'repetition')):
            return False
        if type(record['process_exit_code']) is not int or record['process_exit_code'] != 0:
            return False
        metrics = record['measurements']
        if not isinstance(metrics, dict) or not (set(METRICS) | {'total_produced','total_consumed','total_bytes'}) <= metrics.keys():
            return False
        if type(record.get('stream_count')) is not int or record['stream_count'] < 1:
            return False
        if type(record['request_count']) is not int or record['request_count'] < 0 or any(type(metrics[key]) is not int or metrics[key] < 0 for key in ('total_produced','total_consumed','total_bytes')):
            return False
        if any(type(metrics[key]) not in (int, float) or not math.isfinite(metrics[key]) or metrics[key] < 0 for key in METRICS):
            return False
        if record['request_count'] and metrics['simulation_duration_sec'] <= 0:
            return False
        if not isinstance(record['input_fingerprint'], str) or not record['input_fingerprint']:
            return False
        budget = record['global_buffer_budget']
        if type(budget) is not int or budget < 1 or not isinstance(record['configs'], list) or not record['configs']:
            return False
        if any(not isinstance(config, dict) or not isinstance(config.get('workload'), dict) for config in record['configs']):
            return False
        parameters = run['parameters']
        if budget != run['expected_budget']:
            return False
        if not isinstance(record['build'], dict) or not {'compiler','cplusplus','optimized'} <= record['build'].keys():
            return False
        if not isinstance(record['build']['compiler'],str) or not record['build']['compiler'] or type(record['build']['cplusplus']) is not int or record['build']['cplusplus'] < 201703 or type(record['build']['optimized']) is not bool:
            return False
        controller = record['controller_config']
        controller_fields = {'high_utilization_pct','low_utilization_pct','producer_pressure_ratio','producer_idle_ratio','consumer_idle_ratio','confirmation_windows','step_slots','update_interval_ms','cooldown_ms'}
        if not isinstance(controller, dict) or not controller_fields <= controller.keys() or any(type(controller[key]) not in (int,float) or not math.isfinite(controller[key]) for key in controller_fields):
            return False
        if not (0 <= controller['low_utilization_pct'] < controller['high_utilization_pct'] <= 100 and 0 <= controller['producer_idle_ratio'] < controller['producer_pressure_ratio'] <= 1 and 0 <= controller['consumer_idle_ratio'] <= 1 and controller['update_interval_ms'] > 0 and controller['cooldown_ms'] >= 0):
            return False
        if any(type(controller[key]) is not int or controller[key] < 1 for key in ('confirmation_windows','step_slots')):
            return False
        if record['metrics_config'] != dict(interval_ms=parameters['metrics_interval_ms'], window_ms=parameters['metrics_window_ms']):
            return False
        if any(type(config.get('num_requests')) is not int or config['num_requests'] < 0 for config in record['configs']):
            return False
        total = sum(config['num_requests'] for config in record['configs'])
        if total != record['request_count'] or metrics['total_produced'] != total or metrics['total_consumed'] != total:
            return False
        configs = sorted(record['configs'], key=lambda config: config['stream_id'])
        if record.get('stream_count') != len(configs) or not _matches_source(configs, run):
            return False
        if len({config['stream_id'] for config in configs}) != len(configs):
            return False
        for index, config in enumerate(configs):
            workload_fields = {'type','base_interval_ms','burst_interval_ms','burst_length','normal_length','period_length','amplitude_pct','lambda','min_payload_bytes','max_payload_bytes','seed','stream_id','periodic_intervals_ms','phases'}
            if not isinstance(config.get('workload'), dict) or not workload_fields <= config['workload'].keys():
                return False
            workload = config['workload']
            integer_fields = ('base_interval_ms','burst_interval_ms','burst_length','normal_length','period_length','min_payload_bytes','max_payload_bytes','seed','stream_id')
            if any(type(workload[key]) is not int or workload[key] < 0 for key in integer_fields):
                return False
            if workload['min_payload_bytes'] > workload['max_payload_bytes'] or workload['type'] not in ('STEADY','BURST','PERIODIC','STOCHASTIC','MIXED'):
                return False
            if any(type(workload[key]) not in (int,float) or not math.isfinite(workload[key]) for key in ('amplitude_pct','lambda')) or not 0 <= workload['amplitude_pct'] <= 100 or workload['lambda'] < 0:
                return False
            if not isinstance(workload['periodic_intervals_ms'],list) or any(type(value) is not int or not 0 <= value <= 2**32-1 for value in workload['periodic_intervals_ms']):
                return False
            if not isinstance(workload['phases'],list):
                return False
            for phase in workload['phases']:
                if not isinstance(phase,dict) or not {'name','interval_ms','request_count','min_payload_bytes','max_payload_bytes'} <= phase.keys() or not isinstance(phase['name'],str):
                    return False
                if any(type(phase[key]) is not int or phase[key] < 0 for key in ('interval_ms','request_count','min_payload_bytes','max_payload_bytes')) or phase['min_payload_bytes'] > phase['max_payload_bytes']:
                    return False
            seed = (run['seed']+index*100) % 2**32
            if config['random_seed'] != seed or config['workload']['seed'] != seed:
                return False
            if parameters['requests'] is not None and config['num_requests'] != parameters['requests']:
                return False
        def allocation(values):
            mapped = {value['stream_id']: value['capacity'] for value in values}
            if len(mapped) != len(values) or set(mapped) != {c['stream_id'] for c in configs}:
                raise ValueError('Invalid allocation IDs')
            if any(type(cap) is not int or not run['min_capacity'] <= cap <= run['max_capacity'] for cap in mapped.values()) or sum(mapped.values()) > budget:
                raise ValueError('Invalid capacity bounds/budget')
            return mapped
        initial = allocation(record['initial_allocations'])
        if initial != allocation(run['expected_initial_allocations']):
            return False
        expected_limits = [{'stream_id':config['stream_id'], 'minimum':run['min_capacity'], 'maximum':run['max_capacity']} for config in configs]
        if sorted(record['limits'], key=lambda value:value['stream_id']) != expected_limits:
            return False
        if any(config['buffer_capacity'] != initial[config['stream_id']] for config in configs):
            return False
        final = allocation(record['final_allocations'])
        if final != allocation(record['actual_final_capacities']):
            return False
        if any(type(record[key]) is not int or record[key] < 0 for key in ('resize_successful', 'resize_deferred', 'resize_rejected')):
            return False
        if run['strategy'] == 'fixed_equal' and (initial != final or any(record[key] for key in ('resize_successful', 'resize_deferred', 'resize_rejected'))):
            return False
        return True
    except (KeyError, TypeError, ValueError, OverflowError, AttributeError, IndexError):
        return False


def load_resume(output, plan):
    """Return latest valid successful per-run result plus auditable malformed diagnostics."""
    cache, audit = {}, []
    known = {run['run_id']: run for run in plan['runs']}
    attempts = Path(output)/'attempts'
    if not attempts.exists():
        return cache, audit
    for directory in sorted(attempts.iterdir()):
        if not directory.is_dir() or directory.name not in known:
            raise ValueError('Unknown/duplicate run identity in attempts: '+directory.name)
        latest = None
        seen = set()
        for path in sorted(directory.iterdir(), key=lambda p: (int(p.name.split('.',1)[0]) if p.name.split('.',1)[0].isdigit() else -1, p.name)):
            if path.suffix != '.json':
                audit.append(dict(path=str(path), error='Incomplete staging/unknown file preserved'))
                latest = None
                continue
            try:
                wrapper = json.loads(path.read_text(encoding='utf-8'))
                attempt = int(path.stem)
                if attempt in seen or wrapper['attempt'] != attempt or wrapper['run_id'] != directory.name or wrapper['plan_id'] != plan['plan_id']:
                    raise ValueError('Attempt identity mismatch or duplicate')
                seen.add(attempt)
                record = wrapper['record']
                if not isinstance(record, dict):
                    raise ValueError('Attempt record must be an object')
                if wrapper['record_sha256'] != digest(record):
                    raise ValueError('Attempt checksum mismatch')
                if any(record.get(key) != known[directory.name][key] for key in ('run_id','pair_id','config_id')) or record.get('plan_id') != plan['plan_id']:
                    raise ValueError('Record identity mismatch')
                latest = record
            except (ValueError, KeyError, TypeError) as error:
                audit.append(dict(path=str(path), error=str(error)))
                latest = None
        if latest is not None:
            if not valid_result(latest, known[directory.name]):
                run = known[directory.name]
                audit.append(dict(path=str(directory), error='Saved completion failed schema validation; retry required'))
                # The immutable attempt retains the malformed original. Derived output must
                # remain safe even while earlier pairs are exported before this run retries.
                latest = dict(type='experiment_result', schema_version=1,
                              workload=run['workload'], strategy=run['strategy'], seed=run['seed'],
                              repetition=run['repetition'], config_id=run['config_id'], pair_id=run['pair_id'],
                              run_id=run['run_id'], plan_id=plan['plan_id'], success=False,
                              workload_equivalent=False, measurements=None, configs=[],
                              initial_allocations=[], final_allocations=[], actual_final_capacities=[],
                              error='Saved record requires retry: '+str(latest.get('error','invalid completion schema')),
                              attempt=latest.get('attempt'), process_exit_code=latest.get('process_exit_code'))
            cache[directory.name] = latest
    # Never skip a pair whose independently stored successful inputs disagree.
    by_pair = defaultdict(list)
    for run_id, record in cache.items():
        if valid_result(record, known[run_id]):
            by_pair[known[run_id]['pair_id']].append(record)
    for records in by_pair.values():
        if len(records) == 2 and (records[0]['configs'] != records[1]['configs'] or records[0]['input_fingerprint'] != records[1]['input_fingerprint']):
            for record in records:
                audit.append(dict(run_id=record['run_id'], error='Stored pair equivalence mismatch; rerun required'))
                cache[record['run_id']] = dict(record, success=False, error='Stored pair equivalence mismatch; retry required')
    return cache, audit


def _pid_alive(pid):
    if type(pid) is not int or pid <= 0:
        return True
    if os.name == 'nt':
        import ctypes
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.restype = ctypes.c_void_p
        kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
        kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return ctypes.get_last_error() != 87  # access denied/ambiguous => alive
        try:
            code = ctypes.c_ulong()
            return not kernel.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value == 259
        finally:
            kernel.CloseHandle(handle)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True


def _file_lock(stream, release=False):
    stream.seek(0)
    if os.name == 'nt':
        import msvcrt
        msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK if release else msvcrt.LK_NBLCK, 1)
    else:
        import fcntl
        fcntl.flock(stream.fileno(), fcntl.LOCK_UN if release else fcntl.LOCK_EX | fcntl.LOCK_NB)


def acquire_lock(output, resume):
    # Persistent inode/file + native advisory lock avoids unlink/takeover races.
    path = Path(output)/'.workflow.lock'
    stream = path.open('a+b')
    try:
        _file_lock(stream)
        stream.seek(0)
        contents = stream.read()
        if contents:
            try:
                old = json.loads(contents)
            except ValueError:
                raise ValueError('Ambiguous existing writer metadata; refuse automatic takeover')
            if not isinstance(old, dict):
                raise ValueError('Ambiguous non-object writer metadata; refuse automatic takeover')
            if not old.get('released'):
                if not resume or old.get('host') != socket.gethostname() or _pid_alive(old.get('pid')):
                    raise ValueError('Output is locked by an active or unverified writer')
        owner = dict(pid=os.getpid(), host=socket.gethostname(), token=uuid.uuid4().hex)
        stream.seek(0); stream.truncate()
        stream.write(json.dumps(owner).encode('utf-8')); stream.flush(); os.fsync(stream.fileno())
        owner['_stream'] = stream
        return owner
    except (ValueError, OSError) as error:
        stream.close()
        raise ValueError('Cannot acquire exclusive experiment writer: '+str(error))


def release_lock(output, owner):
    stream = owner['_stream']
    try:
        stream.seek(0)
        current = json.loads(stream.read())
        if current.get('token') == owner['token']:
            metadata = {key:value for key,value in owner.items() if key != '_stream'}
            metadata['released'] = True
            stream.seek(0);stream.truncate()
            stream.write(json.dumps(metadata).encode('utf-8'));stream.flush();os.fsync(stream.fileno())
    finally:
        try:
            _file_lock(stream, release=True)
        finally:
            stream.close()


def _save_attempt(output, plan, run, record):
    directory = Path(output)/'attempts'/run['run_id']
    directory.mkdir(parents=True, exist_ok=True)
    numbers = []
    for path in directory.iterdir():
        prefix = path.name.split('.', 1)[0]
        if prefix.isdigit():
            numbers.append(int(prefix))
    attempt = max(numbers, default=0)+1
    record.update(run_id=run['run_id'], pair_id=run['pair_id'], config_id=run['config_id'],
                  plan_id=plan['plan_id'], attempt=attempt, execution_order=run['execution_order'], command=run['command'])
    wrapper = dict(plan_id=plan['plan_id'], run_id=run['run_id'], attempt=attempt,
                   record_sha256=digest(record), record=record)
    write_json(directory/f'{attempt:06d}.json', wrapper)
    return record


class ProvenanceError(ValueError):
    pass


def verify_provenance(plan, run):
    """Check the measured binary and this run's source immediately around execution."""
    try:
        if hashlib.sha256(Path(plan['executable']).read_bytes()).hexdigest() != plan['executable_sha256']:
            raise ProvenanceError('Executable provenance drift detected')
        for workflow in plan.get('workflow_sources', []):
            if hashlib.sha256(Path(workflow['path']).read_bytes()).hexdigest() != workflow['sha256']:
                raise ProvenanceError('Workflow source provenance drift detected: '+workflow['path'])
        source = next(source for source in plan['sources'] if source['name'] == run['workload'])
        if hashlib.sha256(Path(source['path']).read_bytes()).hexdigest() != source['sha256']:
            raise ProvenanceError('Source configuration provenance drift detected: '+source['name'])
    except OSError as error:
        raise ProvenanceError('Unable to verify executable/source provenance: '+str(error)) from error


def _write_outputs(output, records, plan):
    target = Path(output)/'runs.jsonl'
    temporary = target.with_name(target.name+'.'+uuid.uuid4().hex+'.tmp')
    with temporary.open('x', encoding='utf-8') as stream:
        for record in records:
            stream.write(json.dumps(record, allow_nan=False)+'\n')
        stream.flush()
        os.fsync(stream.fileno())
    atomic_replace(temporary, target)
    summary = summarize(records)
    write_json(Path(output)/'summary.json', summary)
    try:
        # importlib-based tests do not necessarily place this directory on sys.path.
        import importlib.util
        module_path = Path(__file__).with_name('experiment_exports.py')
        if module_path.is_file():
            specification = importlib.util.spec_from_file_location('experiment_exports', module_path)
            module = importlib.util.module_from_spec(specification)
            specification.loader.exec_module(module)
            module.write_exports(Path(output), records, summary, plan)
    except ImportError:
        raise


def main(argv=None):
    args = parse_args(argv)
    try:
        plan = build_plan(args)
        print(f"Planned {plan['total_runs']} runs across {plan['selected_cell_count']} selected cells ({plan['full_cell_count']} total cells)", flush=True)
        if args.resume:
            saved = json.loads((args.output/'plan.json').read_text(encoding='utf-8'))
            if saved != plan:
                raise ValueError('Requested plan differs from saved plan (sources/executable/options/order must match)')
        else:
            args.output.mkdir(parents=True, exist_ok=False)
        owner = acquire_lock(args.output, args.resume)
        try:
            if not args.resume:
                write_json(args.output/'plan.json', plan)
                write_json(args.output/'manifest.json', dict(schema_version=2, plan_id=plan['plan_id'],
                           started_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                           executable=plan['executable'], executable_sha256=plan['executable_sha256'],
                           environment=dict(platform=platform.platform(), python=sys.version, machine=platform.machine()),
                           sources=plan['sources'], total_runs=plan['total_runs']))
            cache, audit = load_resume(args.output, plan) if args.resume else ({}, [])
            manifest = json.loads((args.output/'manifest.json').read_text(encoding='utf-8'))
            session = dict(started_utc=datetime.datetime.now(datetime.timezone.utc).isoformat(), resumed=args.resume, plan_only=args.plan_only,
                           skipped_runs=[run['run_id'] for run in plan['runs'] if run['run_id'] in cache and valid_result(cache[run['run_id']],run)], executed_runs=[], recovery_diagnostics=audit)
            sessions = manifest.setdefault('sessions', [])
            sessions.append(session)
            manifest.pop('completed_utc', None)
            write_json(args.output/'manifest.json', manifest)
            statuses = {run['run_id']: ('skipped' if run['run_id'] in cache and valid_result(cache[run['run_id']],run) else 'planned') for run in plan['runs']}
            write_json(args.output/'states.json', statuses)
            if args.plan_only:
                return 0
            by_pair = defaultdict(list)
            for run in plan['runs']:
                by_pair[run['pair_id']].append(run)
            for runs in by_pair.values():
                for run in runs:
                    if run['run_id'] in cache and valid_result(cache[run['run_id']],run):
                        print(run['run_id'][:12]+' SKIP completed', flush=True)
                        continue
                    try:
                        verify_provenance(plan, run)
                    except ProvenanceError as error:
                        statuses[run['run_id']] = 'failed'
                        session['aborted_reason'] = str(error)
                        write_json(args.output/'states.json', statuses)
                        write_json(args.output/'manifest.json', manifest)
                        raise
                    statuses[run['run_id']] = 'running'
                    write_json(args.output/'states.json', statuses)
                    process = None
                    try:
                        process = subprocess.run(run['command'], capture_output=True, text=True, timeout=plan['timeout_sec'])
                        verify_provenance(plan, run)
                        record = json.loads(process.stdout, parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite JSON constant '+value)))
                        if not isinstance(record, dict):
                            raise ValueError('Result must be an object')
                        record['process_exit_code'] = process.returncode
                        record['stderr'] = process.stderr
                        if not valid_result(record, run):
                            raise ValueError('Result schema, identity, metrics, invariants or process status invalid: '+str(record.get('error', '')))
                    except (subprocess.TimeoutExpired, ValueError, OSError) as error:
                        record = dict(type='experiment_result', schema_version=1, workload=run['workload'],
                                      strategy=run['strategy'], seed=run['seed'], repetition=run['repetition'], success=False,
                                      workload_equivalent=False, measurements=None, error=str(error),
                                      process_exit_code=process.returncode if process else None,
                                      stdout=process.stdout[:16384] if process else None,
                                      stderr=process.stderr[:16384] if process else None,
                                      provenance_drift=isinstance(error, ProvenanceError))
                    cache[run['run_id']] = _save_attempt(args.output, plan, run, record)
                    session['executed_runs'].append(run['run_id'])
                    statuses[run['run_id']] = 'completed' if record['success'] else 'failed'
                    write_json(args.output/'states.json', statuses)
                    write_json(args.output/'manifest.json', manifest)
                    if record.get('provenance_drift'):
                        _write_outputs(args.output, [cache[item['run_id']] for item in plan['runs'] if item['run_id'] in cache], plan)
                        session['aborted_reason'] = record['error']
                        write_json(args.output/'manifest.json', manifest)
                        raise ProvenanceError('Post-execution provenance drift; failed attempt preserved')
                    print(f"{run['workload']} cell={run['config_id'][:8]} seed={run['seed']} repeat={run['repetition']} {run['strategy']}: "+('PASS' if record['success'] else 'FAIL'), flush=True)
                pair = [cache[run['run_id']] for run in runs if run['run_id'] in cache]
                if len(pair) == 2 and all(record['success'] for record in pair):
                    if pair[0]['input_fingerprint'] != pair[1]['input_fingerprint'] or pair[0]['configs'] != pair[1]['configs']:
                        for run in runs:
                            record = dict(cache[run['run_id']]);record.update(success=False, error='Paired workload/configuration equivalence failed')
                            cache[run['run_id']] = _save_attempt(args.output, plan, run, record)
                            statuses[run['run_id']] = 'failed'
                        write_json(args.output/'states.json', statuses)
                _write_outputs(args.output, [cache[run['run_id']] for run in plan['runs'] if run['run_id'] in cache], plan)
            records = [cache[run['run_id']] for run in plan['runs'] if run['run_id'] in cache]
            _write_outputs(args.output, records, plan)
            manifest['completed_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            manifest['run_count'] = len(records)
            manifest['failed_runs'] = sum(not record['success'] for record in records)
            session['completed_utc'] = manifest['completed_utc']
            write_json(args.output/'manifest.json', manifest)
            return 1 if manifest['failed_runs'] else 0
        finally:
            release_lock(args.output, owner)
    except (ValueError, OSError) as error:
        print('Experiment workflow error: '+str(error), file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
