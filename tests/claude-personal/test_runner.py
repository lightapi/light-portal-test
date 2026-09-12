import fcntl
import os
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

spec = importlib.util.spec_from_file_location('claude_runner', Path(__file__).with_name('run.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_timeout_reaps_child(self):
        with tempfile.TemporaryFile() as log:
            with self.assertRaises(subprocess.TimeoutExpired):
                runner.execute([sys.executable, '-c', 'import time; time.sleep(60)'], 0.05, log)

    def test_nonzero_preserved(self):
        with tempfile.TemporaryFile() as log:
            self.assertEqual(runner.execute([sys.executable, '-c', 'raise SystemExit(7)'], 5, log), 7)

    def test_overlap_is_blocked_and_reported(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            runtime = root / 'runtime'
            runtime.mkdir()
            with (runtime / 'claude-personal-e2e.lock').open('a') as lock:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                result = subprocess.run(
                    [sys.executable, str(Path(__file__).with_name('run.py'))],
                    env={**os.environ, 'CLAUDE_E2E_RUNTIME': str(runtime),
                         'CLAUDE_E2E_REPORT_ROOT': str(root / 'reports')},
                    capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 2)
            self.assertIn('another Claude E2E run', result.stdout)
            self.assertEqual(len(list((root / 'reports').glob('*/junit.xml'))), 1)

    def test_reports_distinguish_blocked_failed_and_passed(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            for status, failures, errors in [('passed', '0', '0'), ('failed', '1', '0'), ('blocked', '0', '1')]:
                runner.report(directory, status, 'message <with> & characters', 1)
                suite = ET.parse(directory / 'junit.xml').getroot()
                self.assertEqual(suite.get('failures'), failures)
                self.assertEqual(suite.get('errors'), errors)


if __name__ == '__main__':
    unittest.main()
