"""Loss-preserving Phase 9 exports; standard library only."""
import csv
import hashlib
import io
import json
import os
from pathlib import Path
try:
    from atomic_io import atomic_replace
except ModuleNotFoundError:
    import importlib.util
    _spec = importlib.util.spec_from_file_location('atomic_io', Path(__file__).with_name('atomic_io.py'))
    _atomic = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_atomic)
    atomic_replace = _atomic.atomic_replace

UNITS = {
    'simulation_duration_sec': 's', 'throughput_req_per_sec': 'requests/s',
    'throughput_mb_per_sec': 'MiB/s', 'avg_latency_ms': 'ms',
    'p50_latency_upper_ms': 'ms (histogram upper bound)',
    'p95_latency_upper_ms': 'ms (histogram upper bound)',
    'producer_wait_ms': 'ms (sum across producers)',
    'consumer_wait_ms': 'ms (sum across consumers)',
    'average_utilization_pct': '% (occupancy-time/capacity-time)',
    'peak_stream_utilization_pct': '% (largest individual stream peak)',
    'peak_global_utilization_pct': '% (unavailable)',
    'resize_successful': 'transactions', 'resize_deferred': 'transactions',
    'resize_rejected': 'transactions', 'total_produced': 'requests',
    'total_consumed': 'requests', 'total_bytes': 'bytes',
}


def atomic_text(path, text):
    path = Path(path)
    temporary = path.with_name(path.name+'.export.tmp')
    with temporary.open('w', encoding='utf-8', newline='') as output:
        output.write(text)
        output.flush()
        os.fsync(output.fileno())
    atomic_replace(temporary, path)


def scalar(value):
    if value is None:
        return 'NA'
    if isinstance(value, bool):
        return 'true' if value else 'false'
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    return value


def csv_text(rows, preferred):
    fields = list(dict.fromkeys(preferred + sorted({key for row in rows for key in row})))
    output = io.StringIO(newline='')
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator='\n')
    writer.writeheader()
    for row in rows:
        writer.writerow({key: scalar(row.get(key)) for key in fields})
    return output.getvalue()


def flat_record(record):
    result = {key: value for key, value in record.items() if key != 'measurements'}
    result['status'] = 'completed' if record.get('success') else 'failed'
    measurements = record.get('measurements')
    if not isinstance(measurements, dict):
        measurements = {}
    for key in UNITS:
        if not key.startswith('resize_'):
            result['measurements.'+key] = measurements.get(key)
    for key, value in measurements.items():
        result['measurements.'+key] = value
    return result


def attempt_records(output):
    records = []
    root = output/'attempts'
    if root.is_dir():
        for path in sorted(p for p in root.rglob('*') if p.is_file()):
            raw = path.read_bytes()
            try:
                value = json.loads(raw, parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite JSON')))
                if not isinstance(value, dict):
                    raise ValueError('attempt is not an object')
                if 'record' in value:
                    nested = value['record']
                    if not isinstance(nested, dict):
                        raise ValueError('attempt record is not an object')
                    canonical = json.dumps(nested, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
                    if value.get('record_sha256') != hashlib.sha256(canonical.encode('utf-8')).hexdigest():
                        raise ValueError('attempt checksum mismatch')
                    record = dict(nested)
                    record['attempt'] = value.get('attempt')
                else:
                    record = dict(value)
            except (ValueError, UnicodeDecodeError) as error:
                record = dict(success=False, status='malformed', error=str(error),
                              malformed_sha256=hashlib.sha256(raw).hexdigest(), byte_count=len(raw))
            record['attempt_file'] = path.relative_to(output).as_posix()
            if record.get('status') != 'malformed':
                record = flat_record(record)
            records.append(record)
    return records


def write_exports(output, records, summary, plan):
    """Export every supplied latest record and every on-disk attempt; no filtering."""
    output = Path(output)
    rows = [flat_record(record) for record in records]
    identities = ['plan_id', 'run_id', 'pair_id', 'config_id', 'workload', 'strategy', 'seed',
                  'repetition', 'status', 'success', 'error']
    attempts = attempt_records(output)
    atomic_text(output/'raw_runs.csv', csv_text(rows, identities))
    atomic_text(output/'attempt_records.csv', csv_text(attempts, identities+['attempt_file']))
    aggregates = []
    for group in summary.get('groups', []):
        identity = dict(plan_id=plan.get('plan_id'), **{key: group.get(key) for key in ['config_id', 'workload', 'strategy', 'attempted', 'successful', 'failed']})
        for metric, statistics in group.get('metrics', {}).items():
            aggregates.append(dict(identity, metric=metric, unit=UNITS.get(metric, 'unspecified'), **statistics))
    atomic_text(output/'aggregate_statistics.csv', csv_text(aggregates,
                ['config_id', 'workload', 'strategy', 'metric', 'unit', 'attempted', 'successful',
                 'failed', 'count', 'mean', 'median', 'stddev', 'min', 'max']))
    comparison_rows = []
    for comparison in summary.get('comparisons', []):
        identity = dict(plan_id=plan.get('plan_id'), **{key: comparison.get(key) for key in ['config_id', 'workload', 'successful_pairs']})
        for metric, differences in comparison.get('paired_differences', {}).items():
            for kind, statistics in differences.items():
                comparison_rows.append(dict(identity, metric=metric, kind='paired_'+kind,
                                            unit='%' if kind == 'relative_pct' else UNITS.get(metric, 'unspecified'), **statistics))
        for metric, differences in comparison.get('difference_of_means', {}).items():
            for kind, value in differences.items():
                comparison_rows.append(dict(identity, metric=metric, kind='difference_of_means_'+kind,
                                            unit='%' if kind == 'relative_pct' else UNITS.get(metric, 'unspecified'), value=value))
    atomic_text(output/'paired_comparisons.csv', csv_text(comparison_rows,
                ['config_id', 'workload', 'metric', 'kind', 'unit', 'successful_pairs',
                 'value', 'count', 'mean', 'median', 'stddev', 'min', 'max']))
    state_path = output/'states.json'
    states = json.loads(state_path.read_text(encoding='utf-8')) if state_path.exists() else None
    bundle = dict(schema_version=2, plan=plan, records=records, attempts=attempts, summary=summary, states=states)
    atomic_text(output/'results.json', json.dumps(bundle, indent=2, ensure_ascii=False, allow_nan=False)+'\n')
    atomic_text(output/'units.json', json.dumps(dict(schema_version=1, csv_missing_value='NA',
                json_missing_value=None, units=UNITS,
                definitions={'stddev': 'sample SD (n-1); unavailable for n<2',
                             'paired': 'matching config_id/seed/repetition with validated nominal fingerprints',
                             'relative_pct': '100*(adaptive-fixed)/fixed; unavailable for fixed=0',
                             'peak_stream_utilization_pct': 'largest individual stream peak, not exact simultaneous global peak',
                             'quantiles': 'means of per-run whole-run histogram bounds; not pooled exact percentiles'}), indent=2)+'\n')
    lines = ['# Experiment workflow summary', '', f"Plan: `{plan.get('plan_id', 'unavailable')}`", '',
             f'Latest run records: {len(records)}. Failed latest records: {sum(not r.get("success") for r in records)}.',
             f'Attempt artifacts preserved/exported: {len(attempts)}. See attempts/ for immutable originals.', '',
             'CSV uses `NA` for unavailable values; JSON uses null. Numeric units are in units.json.',
             'Summary statistics exclude failed runs but failed records remain in raw_runs.csv and attempts.', '',
             '| Configuration | Workload | Strategy | Successful / attempted | Throughput mean (req/s) | Latency mean (ms) |',
             '|---|---|---|---:|---:|---:|']
    def printable(value):
        return 'NA' if value is None else f'{value:.6g}'
    for group in summary.get('groups', []):
        metrics = group.get('metrics', {})
        workload = str(group.get('workload', '')).replace('|', '\\|').replace('\n', ' ')
        lines.append(f"| {group.get('config_id', 'legacy')} | {workload} | {group['strategy']} | "
                     f"{group['successful']} / {group['attempted']} | "
                     f"{printable(metrics.get('throughput_req_per_sec', {}).get('mean'))} | "
                     f"{printable(metrics.get('avg_latency_ms', {}).get('mean'))} |")
    lines += ['', 'Paired changes and differences between strategy means are separately named in paired_comparisons.csv.',
              'These are descriptive measurements; no statistical significance or universal adaptive benefit is asserted.', '']
    atomic_text(output/'summary.md', '\n'.join(lines))
