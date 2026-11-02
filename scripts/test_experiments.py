"""Independent descriptive-statistics tests for the experiment CLI driver."""
import importlib.util
import math
import pathlib
import unittest
from unittest import mock
import tempfile
import json
import subprocess
import contextlib
import io

_module_path = pathlib.Path(__file__).with_name('run_experiments.py')
_spec = importlib.util.spec_from_file_location('run_experiments', _module_path)
runner = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(runner)


class ExperimentStatisticsTests(unittest.TestCase):
    def test_sample_statistics_even_and_unsorted(self):
        result = runner.describe([4.0, 1.0, 3.0, 2.0])
        self.assertEqual(result['count'], 4)
        self.assertEqual(result['mean'], 2.5)
        self.assertEqual(result['median'], 2.5)
        self.assertAlmostEqual(result['stddev'], math.sqrt(5.0 / 3.0))
        self.assertEqual(result['min'], 1.0)
        self.assertEqual(result['max'], 4.0)

    def test_median_odd_and_repeated(self):
        result = runner.describe([9, 3, 3])
        self.assertEqual(result['median'], 3)
        self.assertEqual(result['mean'], 5)
        self.assertAlmostEqual(result['stddev'], math.sqrt(12))
        self.assertEqual(runner.describe([7, 7, 7])['stddev'], 0)

    def test_empty_and_single_observation(self):
        result = runner.describe([])
        self.assertEqual(result['count'], 0)
        for key in ('mean', 'median', 'stddev', 'min', 'max'):
            self.assertIsNone(result[key])
        one = runner.describe([4])
        self.assertEqual(one['mean'], 4)
        self.assertEqual(one['median'], 4)
        self.assertIsNone(one['stddev'])

    def test_relative_differences_and_zero_denominator(self):
        self.assertEqual(runner.relative_change(120, 100), 20)
        self.assertEqual(runner.relative_change(80, 100), -20)
        self.assertEqual(runner.relative_change(100, 100), 0)
        self.assertEqual(runner.relative_change(0, 100), -100)
        self.assertIsNone(runner.relative_change(100, 0))
        self.assertIsNone(runner.relative_change(0, 0))

    def test_group_aggregation_and_paired_vs_mean_differences(self):
        def record(strategy, repetition, throughput, latency, success=True):
            measured = {key: 1.0 for key in runner.METRICS}
            measured.update(throughput_req_per_sec=throughput, avg_latency_ms=latency)
            return dict(workload='case', strategy=strategy, seed=42, repetition=repetition,
                        success=success, workload_equivalent=success,
                        input_fingerprint='same'+str(repetition), measurements=measured,
                        resize_successful=0, resize_deferred=0, resize_rejected=0)
        records = [record('fixed_equal', 0, 100, 10), record('adaptive', 0, 110, 12),
                   record('fixed_equal', 1, 200, 20), record('adaptive', 1, 180, 18),
                   record('fixed_equal', 2, 9999, 9999, False)]
        result = runner.summarize(records)
        fixed = next(group for group in result['groups'] if group['strategy'] == 'fixed_equal')
        self.assertEqual((fixed['attempted'], fixed['successful'], fixed['failed']), (3, 2, 1))
        self.assertEqual(fixed['metrics']['throughput_req_per_sec']['mean'], 150)
        comparison = result['comparisons'][0]
        self.assertEqual(comparison['successful_pairs'], 2)
        paired = comparison['paired_differences']
        self.assertEqual(paired['throughput_req_per_sec']['absolute']['mean'], -5)
        self.assertAlmostEqual(paired['throughput_req_per_sec']['relative_pct']['mean'], 0)
        self.assertAlmostEqual(paired['avg_latency_ms']['relative_pct']['mean'], 5)
        means = comparison['difference_of_means']
        self.assertAlmostEqual(means['throughput_req_per_sec']['relative_pct'], -100/30)
        self.assertEqual(means['avg_latency_ms']['absolute'], 0)

    def test_paired_fingerprint_mismatch_rejected(self):
        values = {key: 1.0 for key in runner.METRICS}
        records = [dict(workload='case', strategy=strategy, seed=42, repetition=0,
                        success=True, workload_equivalent=True, input_fingerprint=strategy,
                        measurements=values, resize_successful=0, resize_deferred=0, resize_rejected=0)
                   for strategy in ('fixed_equal', 'adaptive')]
        with self.assertRaisesRegex(ValueError, 'fingerprint mismatch'):
            runner.summarize(records)

    def test_duplicate_paired_identity_rejected(self):
        record = dict(workload='case', strategy='fixed_equal', seed=42, repetition=0,
                      success=False, workload_equivalent=False, measurements=None)
        with self.assertRaisesRegex(ValueError, 'Duplicate paired'):
            runner.summarize([record, record])

    def test_driver_preserves_malformed_subprocess_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            exe = root/'fake.exe'; exe.write_bytes(b'fixture')
            config = root/'case.json'; config.write_text('{}', encoding='utf-8')
            output = root/'results'
            process = subprocess.CompletedProcess([], 2, stdout='malformed', stderr='fixture failure')
            real_run = runner.subprocess.run
            def native_failure(command, *args, **kwargs):
                # platform.platform() itself invokes subprocess.run on macOS.
                # Inject only the intended native child, preserving host discovery.
                if isinstance(command, (list, tuple)) and command and pathlib.Path(command[0]).resolve() == exe.resolve():
                    return process
                return real_run(command, *args, **kwargs)
            with mock.patch.object(runner.platform, 'platform', return_value='test-platform'), \
                 mock.patch.object(runner.subprocess, 'run', side_effect=native_failure), \
                 contextlib.redirect_stdout(io.StringIO()):
                status = runner.main(['--exe', str(exe), '--configs', str(config), '--strategies', 'fixed_equal',
                                      '--repetitions', '1', '--output', str(output)])
            self.assertEqual(status, 1)
            record = json.loads((output/'runs.jsonl').read_text())
            self.assertFalse(record['success'])
            self.assertEqual(record['process_exit_code'], 2)
            self.assertEqual(record['stderr'], 'fixture failure')
            self.assertIsNone(record['measurements'])
            summary = json.loads((output/'summary.json').read_text())
            self.assertEqual(summary['groups'][0]['failed'], 1)
            self.assertIsNone(summary['groups'][0]['metrics']['avg_latency_ms']['mean'])

    def test_nonfinite_statistics_rejected(self):
        for value in (float('inf'), float('-inf'), float('nan')):
            with self.assertRaises(ValueError):
                runner.describe([1, value])


if __name__ == '__main__':
    unittest.main()
