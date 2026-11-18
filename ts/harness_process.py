"""POSIX process ownership for the PTY harnesses; never select targets by name."""

from contextlib import closing, contextmanager
import errno
import os
from pathlib import Path
import select
import signal
import socket
import subprocess
import sys
import tempfile
import time

_parent = None
_cancel = 0


def _cancelled(signum, _frame):
    global _cancel
    _cancel = signum


def checkpoint():
    if _cancel or (_parent is not None and os.getppid() != _parent):
        raise SystemExit(128 + (_cancel or signal.SIGTERM))


def harness_entry():
    """Keep cleanup in a worker outside the caller's (possibly killed) group.

    Signal handlers only set a flag: never interrupt fork/registration/reaping.
    The worker checks its parent at bounded cancellation points, including if a
    timeout supervisor sends SIGKILL rather than giving the CLI a grace period.
    """
    global _parent
    _parent = os.getppid()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, _cancelled)
    if sys.argv[1:2] == ['--harness-worker']:
        _parent = int(sys.argv[2])
        del sys.argv[1:3]
        checkpoint()
        return
    worker = subprocess.Popen([sys.executable, sys.argv[0], '--harness-worker', str(os.getpid()), *sys.argv[1:]],
                              start_new_session=True)
    forwarded = False
    while True:
        if not forwarded and (_cancel or os.getppid() != _parent):
            worker.send_signal(_cancel or signal.SIGTERM)
            forwarded = True
        try:
            status = worker.wait(timeout=.2)
            if _cancel:
                raise SystemExit(128 + _cancel)
            raise SystemExit(status if status >= 0 else 128 - status)
        except subprocess.TimeoutExpired:
            pass


def pause(seconds):
    until = time.monotonic() + seconds
    while True:
        checkpoint()
        remaining = until - time.monotonic()
        if remaining <= 0:
            return
        time.sleep(min(.2, remaining))


def exited(pid):
    """Check a direct child *without reaping*: its PID/PGID cannot be reused."""
    if hasattr(os, 'waitid'):
        return os.waitid(os.P_PID, pid, os.WEXITED | os.WNOHANG | os.WNOWAIT) is not None
    # Older macOS Python builds do not expose waitid.
    with closing(select.kqueue()) as queue:
        event = select.kevent(pid, filter=select.KQ_FILTER_PROC, flags=select.KQ_EV_ADD, fflags=select.KQ_NOTE_EXIT)
        try:
            return bool(queue.control([event], 1, 0))
        except ProcessLookupError:
            return True


def kill_owned_group(pid):
    # Caller owns the unreaped session leader (Popen(start_new_session=True)
    # or forkpty); no ps/kill race and no signal to our own process group.
    # forkpty can return in the parent before the child finishes setsid().
    try:
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    except PermissionError:
        # Darwin returns EPERM, not ESRCH, for an all-zombie group. Confirm
        # that state before reaping; don't treat a live member as cleaned up.
        if sys.platform != 'darwin' or not exited(pid):
            raise
        states = subprocess.check_output(['ps', '-g', str(pid), '-o', 'state='], text=True, timeout=2).split()
        if not states or any(not state.startswith('Z') for state in states):
            raise


@contextmanager
def owned_process(command, **kwargs):
    """Caller may use pipes but must not poll/wait/communicate (all can reap)."""
    checkpoint()
    child = subprocess.Popen(command, start_new_session=True, **kwargs)
    try:
        yield child
    finally:
        try:
            kill_owned_group(child.pid)
        finally:
            for pipe in (child.stdin, child.stdout, child.stderr):
                if pipe:
                    pipe.close()
            child.wait(timeout=3)


def run_owned(command, *, env=None, timeout, text=False, check=True):
    # Files, unlike pipes, cannot deadlock a verbose child while we wait.
    with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
        with owned_process(command, env=env, stdout=out, stderr=err) as child:
            until = time.monotonic() + timeout
            while not exited(child.pid):
                checkpoint()
                if time.monotonic() >= until:
                    raise subprocess.TimeoutExpired(command, timeout)
                time.sleep(.02)
        out.seek(0)
        err.seek(0)
        stdout, stderr = out.read(), err.read()
    result = subprocess.CompletedProcess(command, child.returncode, stdout.decode() if text else stdout,
                                         stderr.decode() if text else stderr)
    if check:
        result.check_returncode()
    return result


class PrivateTmux:
    """Foreground, directly waitable server. Clients can never start another."""

    def __init__(self, folder, env=None):
        self.folder = Path(folder)
        self.env = {k: v for k, v in (os.environ if env is None else env).items() if k not in ('TMUX', 'TMUX_PANE')}
        self.path = self.folder / 'tmux.sock'
        self.base = ['tmux', '-S', str(self.path), '-f', '/dev/null']
        self.guard = None

    def __enter__(self):
        checkpoint()
        if os.path.lexists(self.path):
            raise FileExistsError(self.path)
        self.server = subprocess.Popen([*self.base, '-D'], env=self.env, stdin=subprocess.DEVNULL,
                                       stdout=subprocess.DEVNULL, start_new_session=True)
        try:
            until = time.monotonic() + 3
            while self._call('show-options', '-g', check=False).returncode:
                if self.server.poll() is not None or time.monotonic() >= until:
                    raise RuntimeError('private tmux server failed to start')
                pause(.02)
        except BaseException:
            self.__exit__(None, None, None)
            raise
        return self

    def _call(self, *args, check=True):
        return subprocess.run([*self.base, '-N', *args], env=self.env, timeout=5,
                              capture_output=True, text=True, check=check)

    def __call__(self, *args, check=True):
        checkpoint()
        return self._call(*args, check=check).stdout

    def start(self, session, width, height, command):
        """Return the workload PID (not the guard) for CPU/RSS or PID search."""
        self.close_guard()
        path = str(self.folder / 'pane.sock')
        with socket.socket(socket.AF_UNIX) as listener:
            listener.bind(path)
            try:
                listener.listen(1)
                listener.settimeout(4)
                self('new-session', '-d', '-s', session, '-x', str(width), '-y', str(height),
                     sys.executable, '-S', str(Path(__file__).resolve()), path, *command)
                self.guard, _ = listener.accept()
                self.guard.settimeout(3)
                with self.guard.makefile('rb') as stream:
                    return int(stream.readline(32))
            finally:
                os.unlink(path)

    def close_guard(self):
        if self.guard is not None:
            with self.guard as guard:
                self.guard = None
                # EOF requests termination; EOF back means the group leader
                # has exited. No signal by cached pane PID, even on restart.
                try:
                    guard.shutdown(socket.SHUT_WR)
                except OSError as error:
                    if error.errno != errno.ENOTCONN:
                        raise
                if guard.recv(1):
                    raise RuntimeError('unexpected pane guard response')

    def __exit__(self, *_):
        try:
            self.close_guard()
        finally:
            if self.server.poll() is None:
                self.server.terminate()
                try:
                    self.server.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    self.server.kill()
                    self.server.wait(timeout=2)
            self.path.unlink(missing_ok=True)  # -D can leave its socket after exit


def _pane(path, command):
    # tmux gives each pane a new session. Pin its process-group identity by
    # staying the leader, even if the target exits leaving helpers behind.
    if os.getpgrp() != os.getpid() or os.getsid(0) != os.getpid():
        raise RuntimeError('refusing to guard a shared process group')
    with socket.socket(socket.AF_UNIX) as peer:
        peer.connect(path)
        # The renderer, not its guard, handles terminal signals. HUP from an
        # unexpectedly lost server must still trigger cleanup via the socket
        # or parent check. Do not pass ignored dispositions on to the target.
        for sig in (signal.SIGINT, signal.SIGHUP, signal.SIGTERM):
            signal.signal(sig, _cancelled)
        server = os.getppid()
        child = None
        try:
            child = subprocess.Popen(command)
            peer.sendall(f'{child.pid}\n'.encode())
            while child.poll() is None and os.getppid() == server and _cancel not in (signal.SIGHUP, signal.SIGTERM):
                if select.select([peer], [], [], .05)[0]:
                    break
        finally:
            try:
                if child is not None:
                    child.kill()
                    child.wait(timeout=2)
            finally:
                os.killpg(os.getpid(), signal.SIGKILL)


if __name__ == '__main__':
    _pane(sys.argv[1], sys.argv[2:])
