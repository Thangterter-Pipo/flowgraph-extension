"""Bounded, buffered long-running process manager.

Each process is registered with a bounded in-memory ring buffer (plus spill to
disk for overflow) so huge logs cannot crash the server. On shutdown every
tracked process is terminated (no zombies).
"""

from __future__ import annotations

import os
import signal
import subprocess
import threading
import time
from collections import deque
from pathlib import Path

MAX_BUFFER_CHARS = int(os.environ.get("MAX_PROCESS_BUFFER_CHARS", "200000"))


class _Buffer:
    """Bounded text buffer that keeps the tail and spills overflow to a temp file."""

    def __init__(self, name: str):
        self.name = name
        self._chunks: deque[str] = deque()
        self._size = 0
        self._lock = threading.Lock()
        self._spill_path: Path | None = None
        self._spill_handle = None

    def _open_spill(self):
        if self._spill_handle is None:
            import tempfile

            fd, path = tempfile.mkstemp(prefix=f"mcp_{self.name}_", suffix=".log")
            self._spill_handle = os.fdopen(fd, "a", encoding="utf-8", errors="replace")
            self._spill_path = Path(path)
        return self._spill_handle

    def write(self, data: str):
        if not data:
            return
        with self._lock:
            if self._size + len(data) > MAX_BUFFER_CHARS:
                # Spill the oldest half to disk, keep the tail in memory.
                self._open_spill()
                drop = 0
                while self._chunks and (self._size - drop) > MAX_BUFFER_CHARS // 2:
                    chunk = self._chunks.popleft()
                    self._spill_handle.write(chunk)
                    drop += len(chunk)
                self._spill_handle.flush()
                self._size -= drop
            self._chunks.append(data)
            self._size += len(data)

    def read(self, offset: int = 0, limit: int = 10000) -> tuple[str, int]:
        """Return text from byte `offset`, plus the new offset."""
        with self._lock:
            # Reconstruct from spill (if any) + in-memory chunks.
            full = ""
            if self._spill_path and self._spill_path.exists():
                try:
                    full = self._spill_path.read_text(encoding="utf-8", errors="replace")
                except OSError:
                    full = ""
            full += "".join(self._chunks)
        if offset >= len(full):
            return "", offset
        data = full[offset:offset + limit]
        new_offset = offset + len(data)
        return data, new_offset

    def close(self):
        with self._lock:
            if self._spill_handle:
                self._spill_handle.close()
                self._spill_handle = None
                if self._spill_path:
                    try:
                        self._spill_path.unlink(missing_ok=True)
                    except OSError:
                        pass


class ManagedProcess:
    __slots__ = (
        "process_id", "pid", "argv", "cwd", "name", "started_at",
        "proc", "stdout", "stderr", "exit_code", "exited_at", "lock",
    )

    def __init__(self, process_id: int, proc: subprocess.Popen, argv: list[str], cwd: str, name: str | None):
        self.process_id = process_id
        self.pid = proc.pid
        self.argv = argv
        self.cwd = cwd
        self.name = name or " ".join(argv[:4])
        self.started_at = time.strftime("%Y-%m-%d %H:%M:%S")
        self.proc = proc
        self.stdout = _Buffer("out")
        self.stderr = _Buffer("err")
        self.exit_code: int | None = None
        self.exited_at: str | None = None
        self.lock = threading.Lock()


class ProcessManager:
    def __init__(self):
        self._procs: dict[int, ManagedProcess] = {}
        self._lock = threading.Lock()
        self._counter = 0
        self._readers: list[threading.Thread] = []

    def start(self, argv: list[str], cwd: str, env: dict | None, name: str | None = None) -> ManagedProcess:
        kwargs = {"env": env or os.environ.copy()}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
            # We read via pipes so we can capture incrementally
        proc = subprocess.Popen(
            argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, bufsize=1, **kwargs,
        )
        with self._lock:
            self._counter += 1
            mp = ManagedProcess(self._counter, proc, argv, cwd, name)
            self._procs[mp.process_id] = mp
        # Start reader threads
        t1 = threading.Thread(target=self._reader, args=(mp, proc.stdout, mp.stdout), daemon=True)
        t2 = threading.Thread(target=self._reader, args=(mp, proc.stderr, mp.stderr), daemon=True)
        self._readers.extend([t1, t2])
        t1.start()
        t2.start()
        return mp

    def _reader(self, mp: ManagedProcess, stream, buf: _Buffer):
        try:
            for line in iter(stream.readline, ""):
                buf.write(line)
        except (ValueError, OSError):
            pass
        finally:
            try:
                stream.close()
            except OSError:
                pass
            if stream is mp.proc.stdout:
                mp.proc.wait()
                with mp.lock:
                    mp.exit_code = mp.proc.returncode
                    mp.exited_at = time.strftime("%Y-%m-%d %H:%M:%S")

    def get(self, process_id: int) -> ManagedProcess | None:
        with self._lock:
            return self._procs.get(process_id)

    def status(self, process_id: int) -> dict:
        mp = self.get(process_id)
        if not mp:
            return {"success": False, "error_code": "PROCESS_NOT_FOUND", "message": f"No process {process_id}", "process_id": process_id}
        running = mp.proc.poll() is None
        with mp.lock:
            exit_code = mp.exit_code
        return {
            "success": True,
            "process_id": mp.process_id,
            "pid": mp.pid,
            "name": mp.name,
            "argv": mp.argv,
            "cwd": mp.cwd,
            "started_at": mp.started_at,
            "status": "running" if running else "exited",
            "exit_code": exit_code,
            "exited_at": mp.exited_at,
        }

    def read_output(self, process_id: int, stream: str = "stdout", offset: int = 0, limit: int = 10000) -> dict:
        mp = self.get(process_id)
        if not mp:
            return {"success": False, "error_code": "PROCESS_NOT_FOUND", "message": f"No process {process_id}", "process_id": process_id}
        buf = mp.stdout if stream == "stdout" else mp.stderr
        text, new_offset = buf.read(offset, limit)
        return {"success": True, "process_id": process_id, "stream": stream, "offset": offset, "content": text, "next_offset": new_offset}

    def kill(self, process_id: int) -> dict:
        mp = self.get(process_id)
        if not mp:
            return {"success": False, "error_code": "PROCESS_NOT_FOUND", "message": f"No process {process_id}", "process_id": process_id}
        proc = mp.proc
        if proc.poll() is None:
            try:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/F", "/T", "/PID", str(proc.pid)], capture_output=True)
                else:
                    os.killpg(proc.pid, signal.SIGKILL)
            except Exception as e:
                return {"success": False, "error_code": "INTERNAL_ERROR", "message": str(e), "process_id": process_id}
        return self.status(process_id)

    def list(self) -> list[dict]:
        with self._lock:
            return [self.status(pid) for pid in list(self._procs.keys())]

    def shutdown(self) -> None:
        with self._lock:
            pids = list(self._procs.keys())
        for pid in pids:
            try:
                self.kill(pid)
            except Exception:
                pass
        for mp in self._procs.values():
            mp.stdout.close()
            mp.stderr.close()


PROCESS_MANAGER = ProcessManager()
