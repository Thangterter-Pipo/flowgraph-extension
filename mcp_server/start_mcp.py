"""
Daemon supervisor for the Flow_veo MCP server.

Runs headless (no console window): starts the FastMCP server and the SSH
reverse tunnel to the Contabo VPS, supervises both, and restarts whichever
one dies. Designed to be launched by Task Scheduler at logon so the MCP
stays reachable at https://flowveo.thangterter.online even when no terminal
is open.

Management:
    start_mcp.py            -- run as daemon (called by the scheduled task)
    start_mcp.py status     -- print health of server + tunnel
    start_mcp.py stop       -- kill the supervisor + all children

Logs:
    %LOCALAPPDATA%\\FlowVeoMCP\\supervisor.log
    %LOCALAPPDATA%\\FlowVeoMCP\\server.log      (uvicorn)
    %LOCALAPPDATA%\\FlowVeoMCP\\tunnel.log      (ssh)

Lock:
    %LOCALAPPDATA%\\FlowVeoMCP\\supervisor.lock (only one daemon runs)
"""

from __future__ import annotations

import os
import signal
import socket
import subprocess
import sys
import threading
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

HOST = os.environ.get("FLOW_VEO_MCP_HOST", "0.0.0.0")
PORT = int(os.environ.get("FLOW_VEO_MCP_PORT", "3080"))
SSH = r"C:\Windows\System32\OpenSSH\ssh.exe"


def log(msg: str) -> None:
    line = f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}\n"
    with SUP_LOG.open("a", encoding="utf-8") as f:
        f.write(line)


def port_open(host: str, port: int, timeout: float = 2.0) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def start_server() -> subprocess.Popen:
    log(f"Starting MCP server: {VENV_PYTHON} {RUN_PY}")
    with SERVER_LOG.open("ab") as logf:
        return subprocess.Popen(
            [str(VENV_PYTHON), str(RUN_PY)],
            cwd=str(BASE_DIR),
            stdout=logf,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP,
        )


def cleanup_vps_port(port: int = 3080, retries: int = 3) -> bool:
    """Free port 3080 on the VPS before (re)starting the tunnel.

    When a tunnel dies abruptly the VPS sshd keeps an orphan fd bound to the
    forward port, so a new `ssh -R` fails with 'address already in use' and the
    supervisor loops on exit 255. This finds that holding sshd on the VPS and
    kills it so the port is free. Returns True if the port ended free.
    """
    import subprocess as sp

    for _ in range(retries):
        try:
            # Find pid(s) holding the port on the VPS via `ss -tlnp`.
            out = sp.run(
                [SSH, "-o", "BatchMode=yes", "-o", "ConnectTimeout=10",
                 "contabo", f"ss -tlnp | grep ':{port} '"],
                capture_output=True, text=True, timeout=25,
            ).stdout
            # Lines like: LISTEN ... users:(("sshd",pid=1234,fd=5))
            import re

            pids = set(re.findall(r"pid=(\d+)", out))
            for pid in pids:
                log(f"Freeing port {port} on VPS: killing orphan sshd pid {pid}")
                sp.run([SSH, "-o", "BatchMode=yes", "contabo", f"kill {pid}"],
                       capture_output=True, timeout=20)
        except Exception as e:
            log(f"cleanup_vps_port error: {e}")
        # Check if port is now free
        try:
            chk = sp.run(
                [SSH, "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
                 "contabo", f"ss -tln | grep -c ':{port} '"],
                capture_output=True, text=True, timeout=20,
            ).stdout.strip()
            if chk == "0":
                return True
        except Exception:
            pass
        time.sleep(2)
    return False


def start_tunnel(cleanup: bool = True) -> subprocess.Popen:
    log("Starting SSH reverse tunnel to contabo (0.0.0.0:3080 -> local 3080)")
    if cleanup:
        cleanup_vps_port(PORT)
    with TUNNEL_LOG.open("ab") as logf:
        return subprocess.Popen(
            [
                SSH,
                "-o", "ServerAliveInterval=30",
                "-o", "ServerAliveCountMax=3",
                "-o", "ExitOnForwardFailure=yes",
                "-o", "ConnectTimeout=15",
                "-o", "StrictHostKeyChecking=accept-new",
                # NOTE: we deliberately do NOT use ClearAllForwardings here —
                # it also suppresses the -R reverse forward, which is the whole
                # point. The alias's LocalForward lines (20129 -> 20128) are
                # harmless when both ends are this machine.
                "-o", "TCPKeepAlive=yes",
                "-N",
                "-R", f"0.0.0.0:{PORT}:127.0.0.1:{PORT}",
                "contabo",
            ],
            cwd=str(BASE_DIR),
            stdout=logf,
            stderr=subprocess.STDOUT,
            creationflags=subprocess.CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP,
        )


def terminate(proc: subprocess.Popen) -> None:
    if proc.poll() is None:
        try:
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        except Exception:
            pass
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait()


def run_daemon() -> None:
    # Single-instance guard
    if LOCK_FILE.exists():
        try:
            pid = int(LOCK_FILE.read_text().strip())
            if port_open("127.0.0.1", PORT):
                log(f"Supervisor already running (pid {pid}); exiting.")
                return
        except Exception:
            pass
    LOCK_FILE.write_text(str(os.getpid()))
    log(f"Supervisor daemon started (pid {os.getpid()})")

    server = start_server()
    tunnel = start_tunnel()

    # We must keep running; supervisor keeps children alive.
    try:
        while True:
            # Restart server if it died. If the port is still served by a
            # leftover process (from a previous run), terminate that first so
            # we never end up with two servers fighting over :PORT.
            if server.poll() is not None:
                log(f"MCP server exited (code {server.returncode}); restarting.")
                if not port_open(HOST, PORT):
                    server = start_server()
                else:
                    # Port still held by an orphan; give up quietly and wait.
                    log("Port still served by another process; will retry.")
            if tunnel.poll() is not None:
                log(f"SSH tunnel exited (code {tunnel.returncode}); restarting.")
                tunnel = start_tunnel()

            time.sleep(5)
    except KeyboardInterrupt:
        log("Supervisor interrupted; shutting down children.")
    finally:
        terminate(server)
        terminate(tunnel)
        LOCK_FILE.unlink(missing_ok=True)
        log("Supervisor stopped.")


def do_status() -> None:
    # Connect to 127.0.0.1 (0.0.0.0 is not a valid destination to connect to)
    local_ok = port_open("127.0.0.1", PORT)
    # Public endpoint via VPS
    public_ok = False
    try:
        import urllib.request

        with urllib.request.urlopen("https://flowveo.thangterter.online/health", timeout=8) as r:
            public_ok = r.status == 200
    except Exception:
        pass
    print(f"local server (0.0.0.0:{PORT}): {'UP' if local_ok else 'DOWN'}")
    print(f"public endpoint (https://flowveo.thangterter.online): {'UP' if public_ok else 'DOWN'}")
    print(f"lock file: {LOCK_FILE}")
    if LOCK_FILE.exists():
        print(f"supervisor pid: {LOCK_FILE.read_text().strip()}")
    else:
        print("supervisor pid: none (not running)")


def do_stop() -> None:
    if LOCK_FILE.exists():
        pid = int(LOCK_FILE.read_text().strip())
        try:
            # Kill the supervisor tree; children are killed by its finally.
            os.kill(pid, signal.SIGTERM)
            log(f"stop requested: sent SIGTERM to supervisor pid {pid}")
            print(f"Sent stop to supervisor pid {pid}")
        except Exception as e:
            print(f"Could not signal supervisor: {e}")
    else:
        print("Supervisor not running.")
    # Also kill any stragglers
    for name, args in (("server", [str(VENV_PYTHON), str(RUN_PY)]),
                       ("tunnel", [SSH])):
        try:
            subprocess.run(
                ["taskkill", "/F", "/FI", f"IMAGENAME eq {Path(args[0]).name}"],  # noqa: S604
                capture_output=True,
            )
        except Exception:
            pass


if __name__ == "__main__":
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    if arg == "status":
        do_status()
    elif arg == "stop":
        do_stop()
    else:
        # Guard: only run as daemon when no other instance holds the port.
        if port_open(HOST, PORT):
            log("Port already in use; not starting a duplicate supervisor.")
            print("Port already in use. Use 'start_mcp.py stop' first if needed.")
            sys.exit(0)
        run_daemon()
