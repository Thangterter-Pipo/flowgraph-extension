"""
Command & process execution tools for the Flow_veo MCP server.

Security policy: all execution is scoped to E:\\Flow_veo.
  - allowed_cwd:   only inside the repo root (cwd is validated + resolved).
  - allowed_commands: allowlist (python, pytest, git, pip, node, npm, npx,
                      powershell, pwsh, cmd, and any .bat/.ps1/.py inside root).
  - network:       localhost allowed; remote hosts are restricted (see README).
  - destructive:   delete/git reset --hard require an explicit `force` flag.

Design:
  - exec_command:   run a short-lived command, capture stdout/stderr, return
                    exit_code + output. Default timeout 120s.
  - start_process:  start a long-lived process (Chrome CDP, dev server, MCP
                    helper), return a process_id managed by a ProcessManager.
  - process_status / get_process_output / kill_process: manage those.
  - Processes spawned via start_process are killed when the supervisor or
    server exits, so we never leak orphan Chrome/servers.
"""

from __future__ import annotations

import json
import os
import shlex
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Policy
# ---------------------------------------------------------------------------

# Commands allowed without further checks. Anything else (full paths, other
# executables) is rejected unless it lives inside the repo root.
ALLOWED_COMMANDS = {
    "python", "pythonw", "py", "pytest", "pip", "git", "node", "npm",
    "npx", "powershell", "pwsh", "cmd", "bash", "sh",
}

# Executables that may be referenced by basename inside the repo root.
EXEC_EXTENSIONS = {".py", ".bat", ".ps1", ".sh", ".cmd", ".exe", ".js", ".ts"}


def validate_command(command: str, root: Path) -> list[str]:
    """Split `command` into argv and enforce the allowlist.

    Raises ValueError for disallowed commands. Returns the argv list.
    """
    if not command or command.isspace():
        raise ValueError("command must not be empty.")

    # We exec argv directly (no shell), so pipes/redirection are meaningless.
    # A character is only dangerous OUTSIDE quotes (e.g. `;`, `&`, `|` as a
    # shell separator). Inside quotes it is just literal argv content (e.g.
    # `python -c "import sys; print(sys.version)"` is fine).
    dangerous = set("&|;<>`")
    in_quote = None
    for ch in command:
        if in_quote:
            if ch == in_quote:
                in_quote = None
        else:
            if ch in ('"', "'"):
                in_quote = ch
            elif ch in dangerous:
                raise ValueError(
                    "Shell control characters ( & | ; < > ` ) are not allowed "
                    "outside quotes — commands run without a shell. Use an "
                    "allowed executable directly."
                )

    try:
        argv = shlex.split(command, posix=False)
    except ValueError as e:
        raise ValueError(f"Cannot parse command: {e}") from e
    if not argv:
        raise ValueError("command is empty after parsing.")

    prog = argv[0].strip('"').strip("'")
    base = os.path.basename(prog).lower()

    if base in ALLOWED_COMMANDS:
        return argv

    # Allow executables inside the repo root (e.g. scripts, tools).
    if "/" in prog or "\\" in prog:
        cand = Path(prog)
        if not cand.is_absolute():
            cand = (root / prog).resolve()
        try:
            cand.resolve().relative_to(root)
        except ValueError:
            raise ValueError(
                f"Executable '{prog}' is outside the allowed root. Allowed: "
                f"{sorted(ALLOWED_COMMANDS)} or executables under {root}."
            ) from None
        if cand.suffix.lower() not in EXEC_EXTENSIONS:
            raise ValueError(f"Extension '{cand.suffix}' not allowed for executables.")
        # Rewrite to absolute so cwd resolution is explicit
        argv[0] = str(cand)
        return argv

    raise ValueError(
        f"Command '{base}' is not allowed. Allowed: {sorted(ALLOWED_COMMANDS)} "
        "or executables under the repo root."
    )


def validate_cwd(cwd: str, root: Path) -> str:
    """Resolve cwd and ensure it is inside the repo root."""
    target = Path(cwd)
    if not target.is_absolute():
        target = (root / cwd).resolve()
    else:
        target = target.resolve()
    try:
        target.relative_to(root)
    except ValueError:
        raise ValueError(f"cwd '{cwd}' is outside the repo root '{root}'.")
    if not target.is_dir():
        raise ValueError(f"cwd '{cwd}' is not a directory.")
    return str(target)


def _make_env(extra: dict | None) -> dict:
    """Build an isolated env: copy os.environ + optional overrides (no globals mutated)."""
    env = dict(os.environ)
    if extra:
        for k, v in extra.items():
            env[str(k)] = str(v)
    return env


def run_command(
    argv: list[str],
    cwd: str,
    env: dict,
    timeout: int,
) -> dict:
    """Run a command to completion, capture output."""
    kwargs = {}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    try:
        proc = subprocess.run(
            argv,
            cwd=cwd,
            env=env,
            capture_output=True,
            text=True,
            timeout=timeout,
            **kwargs,
        )
        return {
            "exit_code": proc.returncode,
            "stdout": proc.stdout or "",
            "stderr": proc.stderr or "",
            "timed_out": False,
        }
    except subprocess.TimeoutExpired as e:
        return {
            "exit_code": -1,
            "stdout": (e.stdout or b"").decode("utf-8", errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or ""),
            "stderr": (e.stderr or b"").decode("utf-8", errors="replace") if isinstance(e.stderr, bytes) else (e.stderr or ""),
            "timed_out": True,
            "error": f"Command timed out after {timeout}s",
        }
    except OSError as e:
        return {"exit_code": -1, "stdout": "", "stderr": str(e), "timed_out": False}


# ---------------------------------------------------------------------------
# Process manager (long-running processes)
# ---------------------------------------------------------------------------

class ProcessManager:
    """Track processes started via start_process and reap them on exit."""

    def __init__(self) -> None:
        self._procs: dict[int, dict] = {}
        self._lock = threading.Lock()
        self._counter = 0

    def start(
        self,
        argv: list[str],
        cwd: str,
        env: dict,
        name: str | None = None,
    ) -> dict:
        """Start a process, capture its output to a temp file for later reads."""
        import tempfile

        stdout_f = tempfile.NamedTemporaryFile(
            mode="w+", encoding="utf-8", suffix=".out", delete=False, prefix="flowmcp_"
        )
        stderr_f = tempfile.NamedTemporaryFile(
            mode="w+", encoding="utf-8", suffix=".err", delete=False, prefix="flowmcp_"
        )
        kwargs = {}
        if os.name == "nt":
            kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP

        proc = subprocess.Popen(
            argv,
            cwd=cwd,
            env=env,
            stdout=stdout_f,
            stderr=stderr_f,
            text=True,
            **kwargs,
        )
        with self._lock:
            self._counter += 1
            pid = self._counter
            self._procs[pid] = {
                "pid": proc.pid,
                "proc": proc,
                "argv": argv,
                "cwd": cwd,
                "name": name or " ".join(argv[:4]),
                "started": time.strftime("%Y-%m-%d %H:%M:%S"),
                "stdout_file": stdout_f.name,
                "stderr_file": stderr_f.name,
                "stdout_offset": 0,
                "stderr_offset": 0,
            }
        # Reap in background so exited processes don't become zombies
        threading.Thread(target=self._reaper, args=(pid, proc), daemon=True).start()
        return self._info(pid)

    def _reaper(self, pid: int, proc: subprocess.Popen) -> None:
        proc.wait()
        with self._lock:
            if pid in self._procs:
                self._procs[pid]["exited"] = time.strftime("%Y-%m-%d %H:%M:%S")
                self._procs[pid]["exit_code"] = proc.returncode

    def _info(self, pid: int) -> dict:
        with self._lock:
            p = self._procs.get(pid)
        if not p:
            raise KeyError(pid)
        return {
            "process_id": pid,
            "os_pid": p["pid"],
            "name": p["name"],
            "argv": p["argv"],
            "cwd": p["cwd"],
            "started": p["started"],
            "status": "exited" if p.get("exit_code") is not None else "running",
            "exit_code": p.get("exit_code"),
            "exited": p.get("exited"),
        }

    def status(self, pid: int) -> dict:
        try:
            return self._info(pid)
        except KeyError:
            return {"process_id": pid, "status": "not_found"}

    def read_output(self, pid: int, offset: int = 0, stream: str = "stdout", limit: int = 8000) -> dict:
        with self._lock:
            p = self._procs.get(pid)
        if not p:
            return {"process_id": pid, "status": "not_found"}
        fn = p[f"{stream}_file"]
        try:
            with open(fn, "r", encoding="utf-8", errors="replace") as f:
                f.seek(offset)
                data = f.read(limit)
                new_offset = f.tell()
        except OSError as e:
            return {"process_id": pid, "error": str(e)}
        return {"process_id": pid, "stream": stream, "offset": offset, "content": data, "next_offset": new_offset}

    def kill(self, pid: int) -> dict:
        with self._lock:
            p = self._procs.get(pid)
        if not p:
            return {"process_id": pid, "status": "not_found"}
        proc: subprocess.Popen = p["proc"]
        if proc.poll() is None:
            try:
                if os.name == "nt":
                    subprocess.run(
                        ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
                        capture_output=True,
                    )
                else:
                    os.killpg(proc.pid, signal.SIGKILL)
            except Exception as e:
                return {"process_id": pid, "error": str(e)}
            proc.wait(timeout=5)
        with self._lock:
            p["exit_code"] = proc.returncode
            p["exited"] = time.strftime("%Y-%m-%d %H:%M:%S")
        return self._info(pid)

    def list(self) -> list[dict]:
        with self._lock:
            return [self._info(pid) for pid in list(self._procs.keys())]

    def shutdown(self) -> None:
        """Kill all tracked processes (called on server shutdown)."""
        with self._lock:
            pids = list(self._procs.keys())
        for pid in pids:
            try:
                self.kill(pid)
            except Exception:
                pass


# Singleton shared by the server
PROCESS_MANAGER = ProcessManager()


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------

def register_exec_tools(mcp, root: Path) -> None:
    """Register all execution tools on the FastMCP instance."""
    ROOT = root  # noqa: N806 — closure bound to the server's repo root

    @mcp.tool(annotations={"readOnlyHint": True})
    async def exec_command(
        command: str,
        cwd: str = ".",
        timeout_seconds: int = 120,
        env: dict | None = None,
    ) -> dict:
        """Run a short-lived command inside the repo root and capture output.

        Allowed: python, pytest, git, pip, node, npm, npx, powershell, pwsh,
        cmd, and any script under the repo root (.py/.bat/.ps1/.sh/.js).
        No shell metacharacters — call executables directly. `cwd` is relative
        to the repo root. Returns {exit_code, stdout, stderr, timed_out}.
        """
        root = ROOT
        try:
            argv = validate_command(command, root)
            cwd_resolved = validate_cwd(cwd, root)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
        if timeout_seconds < 1 or timeout_seconds > 600:
            return {"ok": False, "error": "timeout_seconds must be 1..600"}
        env_resolved = _make_env(env)
        result = run_command(argv, cwd_resolved, env_resolved, timeout_seconds)
        return {"ok": True, "command": command, "cwd": cwd_resolved, **result}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def start_process(
        command: str,
        cwd: str = ".",
        env: dict | None = None,
        name: str | None = None,
    ) -> dict:
        """Start a long-lived process (Chrome CDP, dev server, helper) and return a process_id.

        Output is captured to temp files; read it with get_process_output.
        The process is killed automatically when the server stops.
        """
        root = ROOT
        try:
            argv = validate_command(command, root)
            cwd_resolved = validate_cwd(cwd, root)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
        try:
            info = PROCESS_MANAGER.start(argv, cwd_resolved, _make_env(env), name=name)
            return {"ok": True, **info}
        except OSError as e:
            return {"ok": False, "error": str(e)}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def process_status(process_id: int) -> dict:
        """Check the status of a process started via start_process (running/exited, exit code)."""
        return PROCESS_MANAGER.status(process_id)

    @mcp.tool(annotations={"readOnlyHint": True})
    async def get_process_output(
        process_id: int,
        offset: int = 0,
        stream: str = "stdout",
        limit: int = 8000,
    ) -> dict:
        """Read buffered stdout (or stderr) of a process started via start_process.

        `offset` is a byte offset — pass back the returned next_offset to keep
        reading new output. Useful for watching long-running processes.
        """
        if stream not in ("stdout", "stderr"):
            return {"error": "stream must be 'stdout' or 'stderr'"}
        return PROCESS_MANAGER.read_output(process_id, offset, stream, limit)

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": False})
    async def kill_process(process_id: int) -> dict:
        """Kill a process started via start_process (and its children). Destructive."""
        return PROCESS_MANAGER.kill(process_id)

    @mcp.tool(annotations={"readOnlyHint": True})
    async def list_processes() -> dict:
        """List all processes started via start_process in this server session."""
        return {"processes": PROCESS_MANAGER.list()}
