"""Independent CSV/JSON/Markdown export integrity tests."""
import contextlib
import csv
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from unittest import mock

path = pathlib.Path(__file__).with_name('experiment_exports.py')
spec = importlib.util.spec_from_file_location('exports', path)
exports = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exports)


class ExportTests(unittest.TestCase):
    @contextlib.contextmanager
    def directory(self):
        parent = (path.parent.parent/'build_phase9'/'export_test_fixtures').resolve()
        parent.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=parent) as directory:
            root = pathlib.Path(directory).resolve()
            assert root.is_relative_to(parent)
            yield root

    def records(self):
        return [dict(plan_id='p', config_id='c', pair_id='q', run_id='ok', workload='quoted,"case\n|',
                     strategy='fixed_equal', seed=42, repetition=0, success=True, error='',
                     configs=[dict(stream_id=0, num_requests=2)], measurements=dict(avg_latency_ms=2.0)),
                dict(plan_id='p', config_id='c', pair_id='q', run_id='bad', workload='case',
                     strategy='adaptive', seed=42, repetition=0, success=False, error='bad,"\n', measurements=None)]

    def summary(self):
        stats = dict(count=1, mean=2.0, median=2.0, stddev=None, min=2.0, max=2.0)
        return dict(groups=[dict(config_id='c', workload='case', strategy='fixed_equal', attempted=1,
                                 successful=1, failed=0, metrics={'avg_latency_ms': stats})],
                    comparisons=[dict(config_id='c', workload='case', successful_pairs=1,
                                      paired_differences={'avg_latency_ms': {'absolute': stats}},
                                      difference_of_means={'avg_latency_ms': {'absolute': 2.0, 'relative_pct': None}})])

    def test_transient_windows_replace_retries(self):
        helper_spec = importlib.util.spec_from_file_location('atomic_fixture', path.with_name('atomic_io.py'))
        helper = importlib.util.module_from_spec(helper_spec); helper_spec.loader.exec_module(helper)
        error = PermissionError('sharing violation'); error.winerror = 32
        with mock.patch.object(helper.os, 'replace', side_effect=[error, None]) as replace, mock.patch.object(helper.time, 'sleep') as sleep:
            helper.atomic_replace('source', 'target')
            self.assertEqual(replace.call_count, 2)
            sleep.assert_called_once_with(0.01)

    def test_persistent_windows_replace_stops_and_other_errors_propagate(self):
        helper_spec = importlib.util.spec_from_file_location('atomic_fixture', path.with_name('atomic_io.py'))
        helper = importlib.util.module_from_spec(helper_spec); helper_spec.loader.exec_module(helper)
        error = PermissionError('denied'); error.winerror = 5
        with mock.patch.object(helper.os, 'replace', side_effect=error) as replace, mock.patch.object(helper.time, 'sleep'):
            with self.assertRaises(PermissionError): helper.atomic_replace('source', 'target')
            self.assertEqual(replace.call_count, 6)
        with mock.patch.object(helper.os, 'replace', side_effect=OSError('other')) as replace:
            with self.assertRaises(OSError): helper.atomic_replace('source', 'target')
            self.assertEqual(replace.call_count, 1)

    def test_raw_failed_missing_and_quoted_fields(self):
        with self.directory() as root:
            exports.write_exports(root, self.records(), self.summary(), {'plan_id': 'p'})
            with (root/'raw_runs.csv').open(newline='', encoding='utf-8') as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0]['workload'], self.records()[0]['workload'])
            self.assertEqual(json.loads(rows[0]['configs']), self.records()[0]['configs'])
            self.assertEqual(rows[1]['status'], 'failed')
            self.assertEqual(rows[1]['measurements.avg_latency_ms'], 'NA')
            self.assertEqual(rows[1]['error'], self.records()[1]['error'])

    def test_statistics_and_pair_kinds_units(self):
        with self.directory() as root:
            exports.write_exports(root, self.records(), self.summary(), {'plan_id': 'p'})
            rows = list(csv.DictReader(io.StringIO((root/'aggregate_statistics.csv').read_text())))
            self.assertEqual(rows[0]['unit'], 'ms')
            self.assertEqual(rows[0]['stddev'], 'NA')
            self.assertEqual(rows[0]['plan_id'], 'p')
            pairs = list(csv.DictReader(io.StringIO((root/'paired_comparisons.csv').read_text())))
            self.assertEqual({p['kind'] for p in pairs}, {'paired_absolute','difference_of_means_absolute','difference_of_means_relative_pct'})
            relative = next(p for p in pairs if p['kind'].endswith('relative_pct'))
            self.assertEqual(relative['value'], 'NA')
            self.assertEqual(relative['unit'], '%')

    def test_attempt_wrappers_and_malformed_records_preserved(self):
        import hashlib
        with self.directory() as root:
            attempts = root/'attempts'/'bad'; attempts.mkdir(parents=True)
            record = self.records()[1]
            canonical = json.dumps(record, sort_keys=True, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
            (attempts/'000001.json').write_text(json.dumps(dict(record=record, record_sha256=hashlib.sha256(canonical.encode()).hexdigest(), attempt=1)))
            broken = attempts/'000002.json'; broken.write_text('{"torn":')
            exports.write_exports(root, self.records(), self.summary(), {'plan_id': 'p'})
            self.assertEqual(broken.read_text(), '{"torn":')
            rows = list(csv.DictReader(io.StringIO((root/'attempt_records.csv').read_text())))
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0]['status'], 'failed')
            self.assertEqual(rows[1]['status'], 'malformed')
            self.assertEqual(rows[1]['byte_count'], '8')

    def test_json_bundle_states_and_atomic_refresh(self):
        with self.directory() as root:
            (root/'states.json').write_text('{"ok":"skipped"}')
            exports.write_exports(root, self.records(), self.summary(), {'plan_id':'p'})
            first = json.loads((root/'results.json').read_text())
            self.assertEqual(first['records'], self.records())
            self.assertEqual(first['states']['ok'], 'skipped')
            self.assertIn('NA', (root/'summary.md').read_text())
            exports.write_exports(root, [], {'groups':[], 'comparisons':[]}, {'plan_id':'p'})
            self.assertEqual(json.loads((root/'results.json').read_text())['records'], [])
            self.assertEqual(list(root.glob('*.export.tmp')), [])
            self.assertEqual(json.loads((root/'units.json').read_text())['csv_missing_value'], 'NA')


if __name__ == '__main__':
    unittest.main()
