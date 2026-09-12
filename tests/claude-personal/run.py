"""Bounded host-side runner for the deployed Claude personal suite."""
import datetime
import fcntl
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]


def execute(command, timeout, log):
    """Kill and reap the entire test subprocess group on timeout."""
    with subprocess.Popen(command, stdout=log, stderr=log, start_new_session=True) as child:
        try:
            return child.wait(timeout=timeout)
        except (subprocess.TimeoutExpired, KeyboardInterrupt):
            os.killpg(child.pid, signal.SIGTERM)
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            raise


def report(directory, status, detail, elapsed):
    (directory / 'result.json').write_text(json.dumps(dict(
        suite='claude-personal-e2e', status=status, detail=detail,
        durationSeconds=round(elapsed, 3)), indent=2) + '\n')
    suite = ET.Element('testsuite', name='claude-personal-e2e', tests='1',
                       failures=str(int(status == 'failed')),
                       errors=str(int(status == 'blocked')), time=str(elapsed))
    case = ET.SubElement(suite, 'testcase', name='deployed-six-turn-session', time=str(elapsed))
    if status != 'passed':
        ET.SubElement(case, 'error' if status == 'blocked' else 'failure', message=detail)
    ET.ElementTree(suite).write(directory / 'junit.xml', encoding='utf-8', xml_declaration=True)


def main():
    os.umask(0o077)
    runtime = Path(os.environ.get('CLAUDE_E2E_RUNTIME', str(
        ROOT.parent / 'portal-config-loc/all-in-lt/light-workflow-runner-claude-personal/.runtime'))).resolve()
    base = Path(os.environ.get('CLAUDE_E2E_REPORT_ROOT', str(ROOT / 'reports/claude-personal')))
    base.mkdir(parents=True, exist_ok=True)
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ-')
    directory = Path(tempfile.mkdtemp(prefix=stamp, dir=base))
    started = time.monotonic()
    status, detail = 'blocked', 'preflight did not complete'
    try:
        timeout = int(os.environ.get('CLAUDE_E2E_TIMEOUT', '900'))
        if timeout <= 0:
            raise ValueError('timeout must be positive')
        if not runtime.is_dir():
            raise RuntimeError('runner runtime directory is missing; enroll the runner first')
        # Shared across report locations and checkouts targeting the same enrollment.
        with (runtime / 'claude-personal-e2e.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise RuntimeError('another Claude E2E run owns this runtime') from None
            with (directory / 'private.log').open('w') as log:
                lifecycle = Path(os.environ.get('CLAUDE_E2E_LIFECYCLE', str(
                    ROOT.parent / 'portal-config-loc/scripts/personal-runner-lifecycle.py')))
                distribution = Path(os.environ.get('CLAUDE_E2E_DISTRIBUTION', str(runtime.parent.parent)))
                for command in [
                    [sys.executable, '-c', 'import websocket, yaml'],
                    [sys.executable, str(lifecycle), 'preflight', str(distribution)],
                    [sys.executable, str(lifecycle), 'check', str(distribution), '--timeout', '30'],
                ]:
                    remaining = timeout - (time.monotonic() - started)
                    if remaining <= 0:
                        raise RuntimeError('suite deadline expired during preflight')
                    if execute(command, min(60, remaining), log):
                        raise RuntimeError('readiness/dependency check failed; inspect private.log')
                status = 'failed'
                remaining = timeout - (time.monotonic() - started)
                if remaining <= 0:
                    raise RuntimeError('suite deadline expired during preflight')
                code = execute([sys.executable, str(Path(__file__).with_name('deployment.py')),
                                '--runtime', str(runtime), '--url', os.environ.get(
                                    'CLAUDE_E2E_URL', 'ws://127.0.0.1:8090/chat'),
                                '--report', str(directory / 'evidence.json')], remaining, log)
                if code:
                    raise RuntimeError('deployment test failed; inspect private.log and runtime diagnostics')
                status, detail = 'passed', 'six-turn deployed Agent/Controller/worker checks passed'
    except subprocess.TimeoutExpired:
        detail = 'suite timed out; inspect retained runtime state before retrying'
    except KeyboardInterrupt:
        detail = 'suite interrupted; inspect retained runtime state before retrying'
    except Exception as error:
        detail = str(error)
    report(directory, status, detail, time.monotonic() - started)
    print(f'{status}: {detail}\nReports: {directory.resolve()}')
    return 0 if status == 'passed' else 2 if status == 'blocked' else 1


if __name__ == '__main__':
    sys.exit(main())
