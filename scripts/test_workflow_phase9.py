"""Independent Phase 9 plan and recovery validation; no simulation subprocesses mocked as measurements."""
import contextlib
import importlib.util
import io
import json
import pathlib
import subprocess
import os
import socket
import hashlib
import tempfile
import unittest
from unittest import mock

_SCRIPT = pathlib.Path(__file__).with_name('run_experiments.py')
_SPEC = importlib.util.spec_from_file_location('phase9_driver_tests', _SCRIPT)
runner = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(runner)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.base = pathlib.Path(__file__).resolve().parents[1] / 'build_phase9'
        self.base.mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='workflow-test-', dir=self.base)
        self.root = pathlib.Path(self.temp.name).resolve()
        assert self.root.is_relative_to(self.base.resolve())
        self.addCleanup(self.temp.cleanup)
        self.exe = self.root / 'fixture.bin'
        self.exe.write_bytes(b'phase9-test-binary')
        self.config = self.root / 'case.json'
        self.config.write_text(json.dumps(dict(num_streams=1, buffer_capacity=4,
                                             num_requests=4, producer_interval_ms=0,
                                             consumer_processing_ms=0,
                                             min_payload_bytes=64, max_payload_bytes=64,
                                             global_buffer_budget=4)), encoding='utf-8')
        self.output = self.root / 'results'

    def arguments(self, *extra):
        return ['--exe', str(self.exe), '--configs', str(self.config), '--seeds', '17',
                '--repetitions', '1', '--output', str(self.output), *extra]

    @staticmethod
    def reply(command, **kwargs):
        options = dict(zip(command[1::2], command[2::2]))
        seed, repeat = int(options['--seed']), int(options['--repetition'])
        count = int(options.get('--requests', 4))
        budget = int(options.get('--budget', 4))
        capacity = min(budget, int(options.get('--max-capacity', 64)))
        workload = dict(type='STEADY', base_interval_ms=0, burst_interval_ms=1,
                        burst_length=20, normal_length=80, period_length=40, amplitude_pct=50,
                        lambda_=0, min_payload_bytes=64, max_payload_bytes=64,
                        seed=seed, stream_id=0, periodic_intervals_ms=[], phases=[])
        workload['lambda'] = workload.pop('lambda_')
        configs = [dict(stream_id=0, name='Stream-0', buffer_capacity=capacity,
                        num_requests=count, producer_interval_ms=0, consumer_processing_ms=0,
                        min_payload_bytes=64, max_payload_bytes=64, random_seed=seed,
                        use_workload_config=True, workload=workload)]
        measurements = {key: 1.0 for key in runner.METRICS}
        measurements.update(simulation_duration_sec=0.01, throughput_req_per_sec=count/0.01,
                            total_produced=count, total_consumed=count, total_bytes=count*64,
                            peak_global_utilization_pct=None)
        result = dict(type='experiment_result', schema_version=1,
                      workload=options['--name'], strategy=options['--strategy'], seed=seed,
                      repetition=repeat, stream_count=1, global_buffer_budget=budget,
                      request_count=count, input_fingerprint=f'{seed*100+count:016x}',
                      workload_equivalent=True, success=True, error='', configs=configs,
                      initial_allocations=[dict(stream_id=0, capacity=capacity)],
                      final_allocations=[dict(stream_id=0, capacity=capacity)],
                      actual_final_capacities=[dict(stream_id=0, capacity=capacity)],
                      limits=[dict(stream_id=0, minimum=int(options.get('--min-capacity', 1)),
                                   maximum=int(options.get('--max-capacity', 64)))],
                      metrics_config=dict(interval_ms=int(options.get('--metrics-interval-ms', 100)),
                                          window_ms=int(options.get('--metrics-window-ms', 1000))),
                      controller_config=dict(high_utilization_pct=80, low_utilization_pct=30,
                                             producer_pressure_ratio=.05, producer_idle_ratio=.01,
                                             consumer_idle_ratio=.05, confirmation_windows=3,
                                             step_slots=4, update_interval_ms=100, cooldown_ms=500),
                      build=dict(compiler='fixture', cplusplus=201703, optimized=False),
                      resize_successful=0, resize_deferred=0, resize_rejected=0,
                      measurements=measurements)
        return subprocess.CompletedProcess(command, 0, stdout=json.dumps(result), stderr='')

    def execute(self, argv, reply=None):
        with mock.patch.object(runner.subprocess, 'run', side_effect=reply or self.reply) as process, mock.patch.object(runner.platform, 'platform', return_value='fixture-platform'), mock.patch.object(runner.platform, 'machine', return_value='fixture-machine'), contextlib.redirect_stdout(io.StringIO()):
            status = runner.main(argv)
        return status, process.call_count

    def plan(self, *extra):
        return runner.build_plan(runner.parse_args(self.arguments(*extra)))

    def test_legacy_invocation_plan_and_determinism(self):
        one, two = self.plan(), self.plan()
        self.assertEqual(one['plan_id'], two['plan_id'])
        self.assertEqual(one['runs'], two['runs'])
        self.assertEqual(one['total_runs'], 2)
        self.assertEqual({run['strategy'] for run in one['runs']}, {'fixed_equal', 'adaptive'})
        self.assertEqual(len({run['run_id'] for run in one['runs']}), 2)
        self.assertEqual(len({run['pair_id'] for run in one['runs']}), 1)

    def test_grid_count_unique_identities_and_cell_limit(self):
        grid = self.root/'grid.json'
        grid.write_text(json.dumps(dict(budgets=[4, 8], metrics_window_ms=[10, 20],
                                       metrics_interval_ms=[5])), encoding='utf-8')
        argv = self.arguments('--grid', str(grid), '--seeds', '17', '23', '--repetitions', '2')
        plan = runner.build_plan(runner.parse_args(argv))
        self.assertEqual(plan['total_runs'], 32)
        self.assertEqual(len(plan['cells']), 4)
        self.assertEqual(len({run['run_id'] for run in plan['runs']}), 32)
        self.assertEqual(len({run['pair_id'] for run in plan['runs']}), 16)
        limited = runner.build_plan(runner.parse_args(argv+['--limit-cells', '1']))
        self.assertEqual(limited['total_runs'], 8)

    def test_invalid_grid_and_run_limit(self):
        for values in [dict(budgets=[0]), dict(budgets=[4, 4]), dict(metrics_interval_ms=[10], metrics_window_ms=[5]),
                       dict(unknown_dimension=[1])]:
            grid = self.root/'bad-grid.json'; grid.write_text(json.dumps(values), encoding='utf-8')
            with self.assertRaises((ValueError, SystemExit)):
                runner.build_plan(runner.parse_args(self.arguments('--grid', str(grid))))
        with self.assertRaises((ValueError, SystemExit)):
            self.plan('--max-runs', '1')

    def test_plan_saved_before_execution_and_valid_completed_skipped(self):
        def checking_reply(command, **kwargs):
            self.assertTrue((self.output/'plan.json').is_file())
            return self.reply(command, **kwargs)
        status, count = self.execute(self.arguments(), checking_reply)
        self.assertEqual((status, count), (0, 2))
        saved = (self.output/'runs.jsonl').read_bytes()
        status, count = self.execute(self.arguments('--resume'))
        self.assertEqual((status, count), (0, 0))
        records = [json.loads(line) for line in (self.output/'runs.jsonl').read_text().splitlines()]
        self.assertEqual(len(records), 2)
        self.assertEqual(len({record['run_id'] for record in records}), 2)
        self.assertTrue(all(record['success'] for record in records))
        self.assertTrue(saved)

    def test_existing_output_and_mismatched_plan_rejected(self):
        self.assertEqual(self.execute(self.arguments())[0], 0)
        original = (self.output/'plan.json').read_bytes()
        self.assertEqual(self.execute(self.arguments()), (2, 0))
        self.assertEqual(self.execute(self.arguments('--resume', '--budget', '8')), (2, 0))
        self.assertEqual((self.output/'plan.json').read_bytes(), original)

    def test_failed_attempt_preserved_and_retried(self):
        bad = lambda command, **kwargs: subprocess.CompletedProcess(command, 2, stdout='incomplete-json', stderr='fixture')
        self.assertEqual(self.execute(self.arguments(), bad), (1, 2))
        attempts_before = list((self.output/'attempts').rglob('*.json'))
        self.assertEqual(len(attempts_before), 2)
        self.assertEqual(self.execute(self.arguments('--resume')), (0, 2))
        self.assertEqual(len(list((self.output/'attempts').rglob('*.json'))), 4)
        preserved = [json.loads(path.read_text()) for path in attempts_before]
        self.assertTrue(all(not wrapper['record']['success'] for wrapper in preserved))

    def test_missing_attempt_and_corrupt_jsonl_recovered(self):
        self.assertEqual(self.execute(self.arguments())[0], 0)
        attempts = list((self.output/'attempts').rglob('*.json'))
        self.assertEqual(len(attempts), 2)
        attempts[0].unlink()
        (self.output/'runs.jsonl').write_text('{"torn":', encoding='utf-8')
        self.assertEqual(self.execute(self.arguments('--resume')), (0, 1))
        records = [json.loads(line) for line in (self.output/'runs.jsonl').read_text().splitlines()]
        self.assertEqual(len(records), 2)
        self.assertTrue(all(record['success'] for record in records))

    def test_malformed_attempt_retried_without_destroying_it(self):
        self.assertEqual(self.execute(self.arguments())[0], 0)
        attempt = sorted((self.output/'attempts').rglob('*.json'))[0]
        attempt.write_text('{"partial":', encoding='utf-8')
        self.assertEqual(self.execute(self.arguments('--resume')), (0, 1))
        self.assertEqual(attempt.read_text(), '{"partial":')
        self.assertEqual(len(list((self.output/'attempts').rglob('*.json'))), 3)


    def test_incomplete_success_schema_is_not_skipped(self):
        self.assertEqual(self.execute(self.arguments())[0], 0)
        path = sorted((self.output/'attempts').rglob('*.json'))[0]
        wrapper = json.loads(path.read_text())
        del wrapper['record']['measurements']['avg_latency_ms']
        wrapper['record_sha256'] = runner.digest(wrapper['record'])
        path.write_text(json.dumps(wrapper), encoding='utf-8')
        self.assertEqual(self.execute(self.arguments('--resume')), (0, 1))
        self.assertEqual(len(list((self.output/'attempts').rglob('*.json'))), 3)

    def test_record_grid_identity_mismatch_is_not_skipped(self):
        self.assertEqual(self.execute(self.arguments())[0], 0)
        path = sorted((self.output/'attempts').rglob('*.json'))[0]
        wrapper = json.loads(path.read_text())
        wrapper['record']['config_id'] = 'wrong-cell'
        wrapper['record']['pair_id'] = 'wrong-pair'
        wrapper['record_sha256'] = runner.digest(wrapper['record'])
        path.write_text(json.dumps(wrapper), encoding='utf-8')
        self.assertEqual(self.execute(self.arguments('--resume')), (0, 1))

    def test_mismatched_stored_fingerprints_rerun_both_pair_members(self):
        self.assertEqual(self.execute(self.arguments())[0], 0)
        path = sorted((self.output/'attempts').rglob('*.json'))[0]
        wrapper = json.loads(path.read_text())
        wrapper['record']['input_fingerprint'] = 'other-input'
        wrapper['record_sha256'] = runner.digest(wrapper['record'])
        path.write_text(json.dumps(wrapper), encoding='utf-8')
        self.assertEqual(self.execute(self.arguments('--resume')), (0, 2))

    def test_changed_executable_and_source_reject_resume(self):
        self.assertEqual(self.execute(self.arguments())[0], 0)
        before = self.exe.read_bytes()
        self.exe.write_bytes(b'changed binary')
        self.assertEqual(self.execute(self.arguments('--resume')), (2, 0))
        self.exe.write_bytes(before)
        values = json.loads(self.config.read_text())
        values['producer_interval_ms'] = 1
        self.config.write_text(json.dumps(values), encoding='utf-8')
        self.assertEqual(self.execute(self.arguments('--resume')), (2, 0))

    def test_missing_provenance_or_workload_fields_are_not_skipped(self):
        self.assertEqual(self.execute(self.arguments())[0], 0)
        directory = sorted((self.output/'attempts').iterdir())[0]
        for kind in ('build', 'controller_config', 'workload_type', 'total_bytes'):
            with self.subTest(kind=kind):
                path = max(directory.glob('*.json'), key=lambda p: int(p.stem))
                wrapper = json.loads(path.read_text())
                if kind in ('build', 'controller_config'):
                    del wrapper['record'][kind]
                elif kind == 'workload_type':
                    del wrapper['record']['configs'][0]['workload']['type']
                else:
                    del wrapper['record']['measurements']['total_bytes']
                wrapper['record_sha256'] = runner.digest(wrapper['record'])
                path.write_text(json.dumps(wrapper), encoding='utf-8')
                self.assertEqual(self.execute(self.arguments('--resume')), (0, 1))

    def test_atomic_write_failure_preserves_prior_json(self):
        path = self.root/'atomic.json'
        runner.write_json(path, {'old': 1})
        with mock.patch.object(runner.os, 'replace', side_effect=OSError('simulated interrupted replace')):
            with self.assertRaises(OSError):
                runner.write_json(path, {'new': 2})
        self.assertEqual(json.loads(path.read_text()), {'old': 1})
        self.assertEqual(len(list(self.root.glob('atomic.json.*.tmp'))), 1)

    def test_unknown_attempt_run_identity_rejected(self):
        self.assertEqual(self.execute(self.arguments())[0], 0)
        unknown = self.output/'attempts'/'unknown-run'
        unknown.mkdir()
        self.assertEqual(self.execute(self.arguments('--resume')), (2, 0))

    def test_existing_live_writer_metadata_prevents_resume(self):
        self.assertEqual(self.execute(self.arguments('--plan-only')), (0, 0))
        lock = self.output/'.workflow.lock'
        lock.write_text(json.dumps(dict(pid=os.getpid(), host=socket.gethostname(),
                                       token='active-test-owner', released=False)), encoding='utf-8')
        with mock.patch.object(runner, '_pid_alive', return_value=True):
            self.assertEqual(self.execute(self.arguments('--resume')), (2, 0))

    def test_native_file_lock_blocks_second_writer_even_if_metadata_marked_dead(self):
        self.output.mkdir()
        owner = runner.acquire_lock(self.output, False)
        try:
            with mock.patch.object(runner, '_pid_alive', return_value=False):
                with self.assertRaisesRegex(ValueError, 'exclusive|lock|Lock'):
                    runner.acquire_lock(self.output, True)
        finally:
            runner.release_lock(self.output, owner)

    def test_proved_dead_writer_can_recover_pending_plan(self):
        self.assertEqual(self.execute(self.arguments('--plan-only')), (0, 0))
        lock = self.output/'.workflow.lock'
        lock.write_text(json.dumps(dict(pid=99999999, host=socket.gethostname(),
                                       token='dead-test-owner', released=False)), encoding='utf-8')
        with mock.patch.object(runner, '_pid_alive', return_value=False):
            self.assertEqual(self.execute(self.arguments('--resume')), (0, 2))


    def test_prelaunch_binary_or_source_drift_aborts_without_child(self):
        original_verify = runner.verify_provenance
        for label, target in [('binary', self.exe), ('source', self.config)]:
            with self.subTest(label=label):
                original = target.read_bytes()
                output = self.root/('prelaunch-'+label)
                def mutate_then_verify(plan, run):
                    target.write_bytes(original+b'changed-after-plan')
                    return original_verify(plan, run)
                try:
                    with mock.patch.object(runner, 'verify_provenance', side_effect=mutate_then_verify):
                        self.assertEqual(self.execute(self.arguments('--output', str(output))), (2, 0))
                    manifest = json.loads((output/'manifest.json').read_text())
                    self.assertIn('provenance drift', manifest['sessions'][-1]['aborted_reason'])
                    self.assertNotIn('completed_utc', manifest)
                finally:
                    target.write_bytes(original)

    def test_postlaunch_drift_preserves_failed_attempt_and_aborts(self):
        original = self.config.read_bytes()
        def mutate_during_run(command, **kwargs):
            result = self.reply(command, **kwargs)
            self.config.write_bytes(original+b'changed-during-process')
            return result
        try:
            self.assertEqual(self.execute(self.arguments(), mutate_during_run), (2, 1))
            attempts = list((self.output/'attempts').rglob('*.json'))
            self.assertEqual(len(attempts), 1)
            record = json.loads(attempts[0].read_text())['record']
            self.assertFalse(record['success'])
            self.assertTrue(record['provenance_drift'])
            self.assertIsNone(record['measurements'])
            self.assertIn('experiment_result', record['stdout'])
            records = [json.loads(line) for line in (self.output/'runs.jsonl').read_text().splitlines()]
            self.assertEqual(len(records), 1)
            self.assertFalse(records[0]['success'])
            manifest = json.loads((self.output/'manifest.json').read_text())
            self.assertIn('provenance drift', manifest['sessions'][-1]['aborted_reason'])
            self.assertNotIn('completed_utc', manifest)
        finally:
            self.config.write_bytes(original)

    def test_nonobject_lock_metadata_is_refused(self):
        self.assertEqual(self.execute(self.arguments('--plan-only')), (0, 0))
        (self.output/'.workflow.lock').write_text('[]', encoding='utf-8')
        self.assertEqual(self.execute(self.arguments('--resume')), (2, 0))

    def test_workflow_helper_drift_is_detected_without_modifying_project_source(self):
        plan = self.plan()
        helper = self.root/'fixture-helper.py'
        helper.write_text('# initial helper', encoding='utf-8')
        plan['workflow_sources'].append(dict(path=str(helper), sha256=hashlib.sha256(helper.read_bytes()).hexdigest()))
        runner.verify_provenance(plan, plan['runs'][0])
        helper.write_text('# changed helper', encoding='utf-8')
        with self.assertRaisesRegex(runner.ProvenanceError, 'Workflow source provenance drift'):
            runner.verify_provenance(plan, plan['runs'][0])


    def test_nonobject_attempt_record_retried_without_crashing(self):
        self.assertEqual(self.execute(self.arguments())[0], 0)
        path = sorted((self.output/'attempts').rglob('*.json'))[0]
        wrapper = json.loads(path.read_text())
        wrapper['record'] = []
        wrapper['record_sha256'] = runner.digest(wrapper['record'])
        path.write_text(json.dumps(wrapper), encoding='utf-8')
        self.assertEqual(self.execute(self.arguments('--resume')), (0, 1))
        self.assertEqual(json.loads(path.read_text())['record'], [])
        self.assertEqual(len(list((self.output/'attempts').rglob('*.json'))), 3)

    def test_nonobject_configs_and_workloads_retried_without_crashing(self):
        self.assertEqual(self.execute(self.arguments())[0], 0)
        directory = sorted((self.output/'attempts').iterdir())[0]
        for kind in ('config', 'workload'):
            with self.subTest(kind=kind):
                path = max(directory.glob('*.json'), key=lambda p: int(p.stem))
                wrapper = json.loads(path.read_text())
                if kind == 'config':
                    wrapper['record']['configs'][0] = None
                else:
                    wrapper['record']['configs'][0]['workload'] = None
                wrapper['record_sha256'] = runner.digest(wrapper['record'])
                path.write_text(json.dumps(wrapper), encoding='utf-8')
                self.assertEqual(self.execute(self.arguments('--resume')), (0, 1))


    def test_multicell_resume_exports_later_malformed_cache_before_retry(self):
        grid = self.root/'recovery-grid.json'
        grid.write_text(json.dumps(dict(budgets=[4, 8])), encoding='utf-8')
        argv = self.arguments('--grid', str(grid))
        self.assertEqual(self.execute(argv), (0, 4))
        plan = json.loads((self.output/'plan.json').read_text())
        directory = self.output/'attempts'/plan['runs'][-1]['run_id']
        for kind in ('missing_workload', 'nonobject_measurements'):
            with self.subTest(kind=kind):
                path = max(directory.glob('*.json'), key=lambda p: int(p.stem))
                wrapper = json.loads(path.read_text())
                if kind == 'missing_workload':
                    del wrapper['record']['workload']
                else:
                    wrapper['record']['measurements'] = ['malformed measurements']
                wrapper['record_sha256'] = runner.digest(wrapper['record'])
                path.write_text(json.dumps(wrapper), encoding='utf-8')
                self.assertEqual(self.execute(argv+['--resume']), (0, 1))
                records = [json.loads(line) for line in (self.output/'runs.jsonl').read_text().splitlines()]
                self.assertEqual(len(records), 4)
                self.assertTrue(all(record['success'] for record in records))
                manifest = json.loads((self.output/'manifest.json').read_text())
                self.assertEqual(len(manifest['sessions'][-1]['skipped_runs']), 3)
                self.assertEqual(len(manifest['sessions'][-1]['executed_runs']), 1)
                saved = json.loads(path.read_text())['record']
                if kind == 'missing_workload':
                    self.assertNotIn('workload', saved)
                else:
                    self.assertEqual(saved['measurements'], ['malformed measurements'])


if __name__ == '__main__':
    unittest.main()
