# -*- coding: utf-8 -*-
"""
Daemon supervisor for the Flow_veo MCP server.
Simplified & robust: keeps local MCP and SSH tunnel running in background quietly.
"""
from __future__ import annotations

import os
import signal
import socket
import subprocess as sp
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
VENV_PYTHON = BASE_DIR / ".venv" / "Scripts" / "pythonw.exe"
RUN_PY = BASE_DIR / "run.py"
LOG_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "FlowVeoMCP"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOCK_FILE = LOG_DIR / "supervisor.lock"
SUP_LOG = LOG_DIR / "supervisor.log"
SERVER_LOG = LOG_DIR / "server.log"
TUNNEL_LOG = LOG_DIR / "tunnel.log"

PORT = int(os.environ.get("FLOW_VEO_MCP_PORT", "3080"))
SSH = r"C:\Windows\System32\OpenSSH\ssh.exe"


def try_lock() -> bool:
    """Acquire a single-instance lock. Returns False if another supervisor holds it."""
    try:
        fd = os.open(str(LOCK_FILE), os.O_CREAT | os.O_RDWR)
        try:
            # Windows does not support flock; use msvcrt.locking on the fd.
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(fd)
            return False
        # Keep fd open so the lock persists for the process lifetime.
        _LOCK_FD = fd  # noqa: F841
        return True
    except Exception:
        return False


def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n"
    try:
        with SUP_LOG.open("a", encoding="utf-8") as f:
            f.write(line)
    except Exception:
        pass


def start_server() -> sp.Popen:
    log("Starting MCP server...")
    with SERVER_LOG.open("ab") as logf:
        return sp.Popen(
            [str(VENV_PYTHON), str(RUN_PY)],
            cwd=str(BASE_DIR),
            stdout=logf,
            stderr=sp.STDOUT,
            creationflags=sp.CREATE_NO_WINDOW if hasattr(sp, "CREATE_NO_WINDOW") else 0,
        )


def start_tunnel() -> sp.Popen:
    log("Starting SSH reverse tunnel to contabo (0.0.0.0:3080 -> local 3080)...")
    with TUNNEL_LOG.open("ab") as logf:
        return sp.Popen(
            [
                SSH,
                "-o", "ServerAliveInterval=15",
                "-o", "ServerAliveCountMax=3",
                "-o", "ExitOnForwardFailure=yes",
                "-o", "ConnectTimeout=15",
                "-o", "StrictHostKeyChecking=accept-new",
                "-o", "TCPKeepAlive=yes",
                "-N",
                "-R", f"0.0.0.0:{PORT}:127.0.0.1:{PORT}",
                "contabo",
            ],
            cwd=str(BASE_DIR),
            stdout=logf,
            stderr=sp.STDOUT,
            creationflags=sp.CREATE_NO_WINDOW if hasattr(sp, "CREATE_NO_WINDOW") else 0,
        )


def terminate(proc: sp.Popen | None) -> None:
    if proc and proc.poll() is None:
        try:
            proc.terminate()
            proc.wait(timeout=3)
        except Exception:
            try:
                proc.kill()
            except Exception:
                pass


def main() -> None:
    if not try_lock():
        log("Another supervisor instance is already running; exiting.")
        return

    log("Supervisor started.")
    server = start_server()
    tunnel = start_tunnel()

    try:
        while True:
            time.sleep(5)
            # Check Server
            if server.poll() is not None:
                log(f"MCP server died (code {server.returncode}), restarting...")
                server = start_server()

            # Check Tunnel
            if tunnel.poll() is not None:
                log(f"SSH tunnel died (code {tunnel.returncode}), restarting in 3s...")
                time.sleep(3)
                tunnel = start_tunnel()

    except KeyboardInterrupt:
        pass
    finally:
        log("Supervisor exiting...")
        terminate(server)
        terminate(tunnel)


if __name__ == "__main__":
    main()
