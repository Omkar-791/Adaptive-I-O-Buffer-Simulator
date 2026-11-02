#!/usr/bin/env python3
"""Phase14 standard-library runner; existing suites remain authoritative.

Smoke runs real backend/native HTTP tests and both real browser workflows. Full
also runs all backend and frontend unit/failure cases and all browser cases.
Neither mode is the one-hour native stress test. Requires installed dependencies.
Artifacts are written to a new directory; existing Playwright tests also write
their established ignored client/test-results evidence.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import signal
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def stop_tree(process):
    """Only touch the process group/tree created by this runner."""
    if process.poll() is not None:
        return
    if os.name == 'nt':
        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       timeout=15, check=False)
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            return
    try:
        process.wait(timeout=10)
    except subprocess.TimeoutExpired:
        if os.name != 'nt':
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                return
        process.kill()
        process.wait(timeout=10)


def start(command, cwd, env, log, stdin=False):
    return subprocess.Popen(command, cwd=cwd, env=env, stdout=log,
                            stderr=subprocess.STDOUT,
                            stdin=subprocess.PIPE if stdin else subprocess.DEVNULL,
                            start_new_session=os.name != 'nt',
                            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == 'nt' else 0)


def wait_ready(url, process, timeout=20):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Service exited before readiness: {url}')
        try:
            with urllib.request.urlopen(url, timeout=1) as response:
                if response.status == 200:
                    return response.read()
        except (OSError, TimeoutError):
            pass
        time.sleep(.1)
    raise RuntimeError(f'Service readiness timed out: {url}')


def run_stage(report, output, label, kind, command, cwd, env, timeout):
    record = {'name': label, 'coverageKind': kind, 'command': command,
              'cwd': str(cwd), 'status': 'running'}
    report['stages'].append(record)
    started = time.monotonic()
    process = None
    with (output / f'{label}.log').open('wb') as log:
        try:
            process = start(command, cwd, env, log)
            record['exitCode'] = process.wait(timeout=timeout)
            record['status'] = 'passed' if record['exitCode'] == 0 else 'failed'
        except subprocess.TimeoutExpired:
            record['status'] = 'timed_out'
        except BaseException:
            record['status'] = 'interrupted'
            raise
        finally:
            if process:
                try:
                    stop_tree(process)
                except Exception as error:
                    record['cleanupError'] = str(error)
                    record['status'] = 'failed'
            record['elapsedSeconds'] = time.monotonic() - started
    print(f"{label}: {record['status']}", flush=True)
    if record['status'] != 'passed':
        raise RuntimeError(f'{label} did not pass; inspect {output / (label + ".log")}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native', required=True, type=Path,
                        help='Trusted already-built native simulator, never a fixture')
    parser.add_argument('--mode', choices=['smoke', 'full'], default='smoke')
    parser.add_argument('--output', type=Path,
                        help='New output directory (refuses an existing directory)')
    parser.add_argument('--stage-timeout', type=int, default=240)
    args = parser.parse_args()
    if not 30 <= args.stage_timeout <= 1800:
        parser.error('--stage-timeout must be 30..1800 seconds')
    native = args.native.resolve(strict=True)
    if not native.is_file():
        parser.error('--native must be a regular executable file')
    node = shutil.which('node')
    if not node:
        parser.error('Node.js is required')
    for entry in ['server/node_modules/express/package.json',
                  'client/node_modules/vite/bin/vite.js',
                  'client/node_modules/@playwright/test/cli.js',
                  'client/node_modules/vitest/vitest.mjs']:
        if not (ROOT / entry).is_file():
            parser.error(f'Install project dependencies first: missing {entry}')
    output = (args.output or ROOT / 'build_phase14' / ('integration-' + time.strftime('%Y%m%d-%H%M%S'))).resolve()
    output.mkdir(parents=True, exist_ok=False)
    report = {'schemaVersion': 1, 'mode': args.mode, 'platform': platform.platform(),
              'python': sys.version, 'node': subprocess.check_output([node, '--version'], text=True).strip(),
              'native': str(native), 'nativeSha256': hashlib.sha256(native.read_bytes()).hexdigest(),
              'stages': [], 'status': 'running', 'cleanup': {}}
    env = dict(os.environ)
    env.update(NATIVE_EXECUTABLE=str(native), NATIVE_TEST_EXECUTABLE=str(native),
               HOST='127.0.0.1', PORT='3000', RUN_TIMEOUT_MS='30000',
               MAX_CONCURRENT_RUNS='2', MAX_RUN_HISTORY='20',
               TELEMETRY_RETENTION='100', TELEMETRY_BYTES='1048576')
    for key in ['BROWSER_ORIGIN', 'VITE_API_BASE_URL']:
        env.pop(key, None)
    backend = frontend = None
    handles = []
    try:
        # Never attach to, terminate or silently reuse somebody else's services.
        for port in [3000, 5173]:
            with socket.socket() as probe:
                probe.bind(('127.0.0.1', port))
        backend_files = ['test/*.test.js'] if args.mode == 'full' else ['test/native-integration.test.js', 'test/native-cancel.test.js']
        run_stage(report, output, 'backend', 'mixed real HTTP/native and injected process unit tests' if args.mode == 'full' else 'real HTTP/native execution and cancellation',
                  [node, '--test', '--test-concurrency=1', *backend_files], ROOT / 'server', env, args.stage_timeout)
        if args.mode == 'full':
            run_stage(report, output, 'frontend-unit', 'mocked API unit/component tests; not end-to-end',
                      [node, 'node_modules/vitest/vitest.mjs', 'run'], ROOT / 'client', env, args.stage_timeout)
        # Call the existing stop() on stdin before any forceful fallback. Unlike
        # Windows kill(), this confirms manager shutdown and child cleanup.
        wrapper = "require('./src/index').start().then(({stop})=>process.stdin.once('data',()=>stop().then(()=>process.exit(process.exitCode||0))));"
        handles.append((output / 'backend-service.log').open('wb'))
        backend = start([node, '-e', wrapper], ROOT / 'server', env, handles[-1], stdin=True)
        health = json.loads(wait_ready('http://127.0.0.1:3000/api/v1/health', backend))
        if not health['native']['available']:
            raise RuntimeError('Backend health reports native executable unavailable')
        handles.append((output / 'frontend-service.log').open('wb'))
        frontend = start([node, 'node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5173', '--strictPort'], ROOT / 'client', env, handles[-1])
        wait_ready('http://127.0.0.1:5173', frontend)
        browser_files = [] if args.mode == 'full' else ['e2e/real-workflow.spec.ts', 'e2e/comparison.spec.ts']
        run_stage(report, output, 'browser', 'real browser -> HTTP backend -> native; existing negative UI tests may intercept HTTP in full mode',
                  [node, 'node_modules/@playwright/test/cli.js', 'test', *browser_files], ROOT / 'client', env, args.stage_timeout)
        report['finalHealth'] = json.loads(wait_ready('http://127.0.0.1:3000/api/v1/health', backend))
        if report['finalHealth']['activeRuns'] != 0:
            raise RuntimeError('Native runs remain active after browser suite')
        report['status'] = 'passed'
    except KeyboardInterrupt:
        report['status'] = 'interrupted'
    except Exception as error:
        report['status'] = 'failed'
        report['error'] = str(error)
    finally:
        if backend:
            try:
                backend.stdin.write(b'stop\n')
                backend.stdin.flush()
                backend.wait(timeout=15)
                report['cleanup']['backendGraceful'] = backend.returncode == 0
            except (OSError, subprocess.TimeoutExpired):
                report['cleanup']['backendGraceful'] = False
            finally:
                try:
                    stop_tree(backend)
                except Exception as error:
                    report['cleanup']['backendError'] = str(error)
                try:
                    backend.stdin.close()
                except OSError as error:
                    report['cleanup']['backendStdinError'] = str(error)
        if frontend:
            try:
                stop_tree(frontend)
            except Exception as error:
                report['cleanup']['frontendError'] = str(error)
            report['cleanup']['frontendStopped'] = frontend.poll() is not None
        for handle in handles:
            handle.close()
        cleanup_failed = (report['cleanup'].get('backendGraceful') is False or
                          report['cleanup'].get('frontendStopped') is False or
                          any(key.endswith('Error') for key in report['cleanup']))
        if cleanup_failed and report['status'] == 'passed':
            report['status'] = 'failed'
            report['error'] = 'Service cleanup could not be confirmed'
        (output / 'report.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(f"Integration {report['status']}; report: {output / 'report.json'}", flush=True)
    return 0 if report['status'] == 'passed' else 1


if __name__ == '__main__':
    sys.exit(main())
