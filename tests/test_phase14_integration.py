"""Isolated tests of harness failure handling; these do not prove native E2E."""
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import integration_test as runner


class HarnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        (runner.ROOT / 'build_phase14').mkdir(exist_ok=True)

    def test_readiness_reports_early_exit_without_network_poll(self):
        process = Mock()
        process.poll.return_value = 7
        with patch.object(runner.urllib.request, 'urlopen') as request:
            with self.assertRaisesRegex(RuntimeError, 'exited before readiness'):
                runner.wait_ready('http://127.0.0.1:3000', process)
            request.assert_not_called()

    def test_timeout_records_failure_and_stops_created_tree(self):
        process = Mock()
        process.wait.side_effect = subprocess.TimeoutExpired(['fixture'], 1)
        report = {'stages': []}
        with tempfile.TemporaryDirectory(dir=runner.ROOT / "build_phase14") as directory:
            with patch.object(runner, 'start', return_value=process), patch.object(runner, 'stop_tree') as stop:
                with self.assertRaisesRegex(RuntimeError, 'did not pass'):
                    runner.run_stage(report, Path(directory), 'timeout', 'unit fixture', ['fixture'], Path(directory), {}, 1)
                stop.assert_called_once_with(process)
        self.assertEqual(report['stages'][0]['status'], 'timed_out')

    def test_cleanup_failure_is_recorded_without_losing_stage(self):
        process = Mock()
        process.wait.return_value = 0
        report = {'stages': []}
        with tempfile.TemporaryDirectory(dir=runner.ROOT / "build_phase14") as directory:
            with patch.object(runner, 'start', return_value=process), patch.object(runner, 'stop_tree', side_effect=OSError('denied')):
                with self.assertRaisesRegex(RuntimeError, 'did not pass'):
                    runner.run_stage(report, Path(directory), 'cleanup', 'unit fixture', ['fixture'], Path(directory), {}, 1)
        self.assertEqual(report['stages'][0]['status'], 'failed')
        self.assertEqual(report['stages'][0]['cleanupError'], 'denied')

    def test_existing_output_refused(self):
        with tempfile.TemporaryDirectory(dir=runner.ROOT / "build_phase14") as directory:
            native = Path(directory) / 'fixture-native'
            native.write_bytes(b'test-only fixture; never executed')
            sentinel = Path(directory) / 'keep.txt'
            sentinel.write_text('unchanged')
            with patch.object(sys, 'argv', ['integration_test.py', '--native', str(native), '--output', directory]), patch.object(runner.shutil, 'which', return_value='node'), patch.object(Path, 'is_file', return_value=True):
                with self.assertRaises(FileExistsError):
                    runner.main()
            self.assertEqual(sentinel.read_text(), 'unchanged')


if __name__ == '__main__':
    unittest.main()
