"""Bounded POSIX integration tests; never invoke Bun, a monitor or a user tmux socket."""

import importlib.util
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time
import unittest

from harness_process import PrivateTmux, run_owned


HERE = Path(__file__).resolve().parent
FIXTURE = '''
import json, os, signal, sys, time, tty
from pathlib import Path

for sig in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP):
    signal.signal(sig, signal.SIG_IGN)
signal.alarm(40)  # Last resort even if the implementation under test regresses.
if '--unrelated' in sys.argv:
    time.sleep(35)
    sys.exit(0)
child = os.fork()
if not child:
    time.sleep(35)
    os._exit(0)
folder = Path(os.environ['FIXTURE_TEST'])
(folder / 'tmp-ready').write_text(json.dumps([os.getpid(), child]))
(folder / 'tmp-ready').rename(folder / 'ready')
while not (folder / 'go').exists():
    time.sleep(.01)
mode = os.environ['FIXTURE_MODE']
if mode == 'pass':
    tty.setraw(0)
    os.write(1, b'sloppytop q quit > 123 ')
    sys.exit(0 if os.read(0, 1) == b'q' else 1)
if mode == 'bad-frame':
    print('PID fixture-worker', flush=True)
if mode == 'early-exit':
    sys.exit(42)
time.sleep(35)
'''


def process_table():
    rows = subprocess.check_output(['ps', '-axo', 'pid=,ppid='], text=True, timeout=3)
    return {int(pid): int(parent) for pid, parent in (line.split() for line in rows.splitlines())}


def family(pid):
    parents = process_table()
    found = {pid}
    while True:
        children = {child for child, parent in parents.items() if parent in found}
        if children <= found:
            return found
        found.update(children)


def eventually(predicate, seconds=4):
    until = time.monotonic() + seconds
    while time.monotonic() < until:
        if predicate():
            return True
        time.sleep(.04)
    return False


@unittest.skipUnless(os.name == 'posix', 'POSIX PTY harnesses')
class HarnessProcessTest(unittest.TestCase):
    def setUp(self):
        # Short paths also work on Darwin's 104-byte sockaddr_un.
        temp = tempfile.TemporaryDirectory(prefix='nht-owned-', dir='/tmp')
        self.addCleanup(temp.cleanup)
        self.folder = Path(temp.name)
        self.fixture = self.folder / 'fixture'
        self.fixture.write_text(f'#!{sys.executable}\n' + FIXTURE)
        self.fixture.chmod(0o700)
        self.env = dict(os.environ, TMPDIR=temp.name, HOME=temp.name, TMUX_TMPDIR=temp.name,
                        SHELL='/bin/sh', FIXTURE_TEST=temp.name, XDG_CONFIG_HOME=temp.name)
        self.env.pop('TMUX', None)
        self.env.pop('TMUX_PANE', None)
        # Same executable and UID; different, deliberately unrelated session.
        self.other = subprocess.Popen([self.fixture, '--unrelated'], env=self.env, start_new_session=True)
        self.addCleanup(self.stop_other)

    def stop_other(self):
        was_alive = self.other.poll() is None
        self.other.kill()
        self.other.wait(timeout=2)
        self.assertTrue(was_alive, 'unrelated process was terminated')

    def assert_gone(self, owned):
        self.assertTrue(eventually(lambda: not (owned & process_table().keys())),
                        f'owned PIDs not reaped: {owned & process_table().keys()}')
        self.assertFalse(list(self.folder.rglob('tmux.sock')), 'left a private server socket')

    def exercise(self, script, args, mode, *, signum=None, expected=0, error=None, timeout=8, launcher=False):
        if script != 'smoke-tui' and not shutil.which('tmux'):
            self.skipTest('tmux not installed')
        with tempfile.TemporaryFile() as log:
            command = [sys.executable, HERE / (script + '.py'), *args]
            if launcher:
                command = [sys.executable, '-c', 'import subprocess,sys; subprocess.call(sys.argv[1:])', *command]
            proc = subprocess.Popen(command,
                                    env=dict(self.env, FIXTURE_MODE=mode), start_new_session=True,
                                    stdout=log, stderr=log)
            try:
                ready = self.folder / 'ready'
                if not eventually(lambda: ready.exists() or proc.poll() is not None) or not ready.exists():
                    log.seek(0)
                    self.fail('fixture did not start: ' + log.read().decode())
                owned = family(proc.pid)
                self.assertTrue(set(json.loads(ready.read_text())) <= owned)
                if script != 'smoke-tui':
                    self.assertEqual(len(list(self.folder.rglob('tmux.sock'))), 1)
                (self.folder / 'go').touch()
                if signum:
                    proc.send_signal(signum)  # external interruption; no exception injection
                self.assertEqual(proc.wait(timeout=timeout), expected)
                self.assert_gone(owned)
                if error:
                    log.seek(0)
                    self.assertIn(error, log.read().decode())
            finally:
                if proc.poll() is None:
                    proc.kill()
                    proc.wait(timeout=2)

    def test_direct_success_reaps_helpers_even_after_leader_exits(self):
        self.exercise('smoke-tui', [self.fixture], 'pass')

    def test_direct_early_failure(self):
        self.exercise('smoke-tui', [self.fixture], 'early-exit', expected=1, error='exit 42')

    def test_direct_external_sigint(self):
        self.exercise('smoke-tui', [self.fixture], 'hang', signum=signal.SIGINT, expected=130)

    def test_direct_launcher_death(self):
        self.exercise('smoke-tui', [self.fixture], 'hang', launcher=True,
                      signum=signal.SIGKILL, expected=-signal.SIGKILL)

    def test_visual_bad_baseline(self):
        self.exercise('visual-tui', [self.fixture, self.folder / 'frames'], 'bad-frame', expected=1,
                      error='styled frame changed')

    def test_visual_marker_timeout(self):
        self.exercise('visual-tui', [self.fixture, self.folder / 'frames', '--review-only'], 'bad-frame',
                      expected=1, error='01b-tree-fold-wide: expected', timeout=16)

    def test_visual_external_sigterm(self):
        self.exercise('visual-tui', [self.fixture, self.folder / 'frames'], 'hang',
                      signum=signal.SIGTERM, expected=143)

    def test_bench_parent_sigkill(self):
        self.exercise('bench-tui', [self.fixture, self.fixture, '--workload', '100'], 'hang',
                      signum=signal.SIGKILL, expected=-signal.SIGKILL)

    def test_cli_status_from_exited_leader_without_helpers(self):
        result = run_owned([sys.executable, '-c', "print('done'); raise SystemExit(7)"],
                           env=self.env, text=True, check=False, timeout=3)
        self.assertEqual((result.returncode, result.stdout), (7, 'done\n'))

    def test_cli_probe_timeout(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            run_owned([self.fixture], env=self.env, timeout=.6)
        self.assert_gone(set(json.loads((self.folder / 'ready').read_text())))

    def test_nested_smoke_timeout(self):
        spec = importlib.util.spec_from_file_location('bench', HERE / 'bench-tui.py')
        bench = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(bench)
        with self.assertRaises(subprocess.TimeoutExpired):
            bench.smoke_output([sys.executable, HERE / 'smoke-tui.py', self.fixture], self.env, 1.5)
        self.assert_gone(set(json.loads((self.folder / 'ready').read_text())))

    @unittest.skipUnless(shutil.which('tmux'), 'tmux not installed')
    def test_unexpected_server_death(self):
        with PrivateTmux(self.folder, self.env) as tmux:
            pid = tmux.start('disposable', 80, 24, [self.fixture])
            self.assertTrue(eventually(lambda: (self.folder / 'ready').exists()))
            owned = family(tmux.server.pid)
            self.assertIn(pid, owned)
            tmux.server.kill()
            tmux.server.wait(timeout=2)
            # Neither a cooperative renderer nor a functioning tmux client
            # connection is needed after a server crash.
            self.assertTrue(eventually(lambda: not (owned & process_table().keys())))
        self.assert_gone(owned)

    @unittest.skipUnless(shutil.which('tmux'), 'tmux not installed')
    def test_normal_private_session_exit_and_restart(self):
        with PrivateTmux(self.folder, self.env) as tmux:
            server = tmux.server.pid
            owned = {server}
            for _ in range(2):
                pid = tmux.start('disposable', 80, 24, [sys.executable, '-c', 'input()'])
                owned.update(family(server))
                self.assertIn(pid, owned)
                tmux('send-keys', '-t', 'disposable', 'Enter')
                self.assertTrue(eventually(lambda: not tmux('list-panes', '-t', 'disposable', check=False)))
        self.assert_gone(owned)


if __name__ == '__main__':
    unittest.main()
