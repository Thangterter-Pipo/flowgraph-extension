"""
Testing, Git, System, File-ops and CDP tools for the Flow_veo MCP server.

These extend the base filesystem tools with the capabilities the FlowVeo
reverse-engineering workflow needs: run pytest, verify docs, git checkpoints,
file hashes/diffs, disk usage, temp workspaces, and CDP (Chrome DevTools
Protocol) capture of the Google Flow UI.

Security: same policy as exec_tools — everything scoped to the repo root,
localhost network only for CDP, no global env mutation.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path
from typing import Any

from exec_tools import (
    PROCESS_MANAGER,
    _make_env,
    run_command,
    validate_command,
    validate_cwd,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _git(args: list[str], root: Path) -> dict:
    """Run a git command inside the repo root."""
    return run_command(["git", *args], str(root), _make_env(None), 60)


def _cdp(method: str, params: dict | None = None, port: int = 9222, timeout: float = 8) -> dict:
    """Send a CDP HTTP request to a local Chrome debugging endpoint."""
    url = f"http://127.0.0.1:{port}/json"
    try:
        if method == "list":
            with urllib.request.urlopen(url + "/list", timeout=timeout) as r:
                return {"ok": True, "targets": json.loads(r.read().decode())}
        raise ValueError(f"Unknown CDP method {method}")
    except Exception as e:
        return {"ok": False, "error": str(e)}


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------

def register_extra_tools(mcp, root: Path) -> None:
    ROOT = root  # noqa: N806

    # ---- Testing ---------------------------------------------------------

    @mcp.tool(annotations={"readOnlyHint": True})
    async def run_pytest(
        path: str = "tests",
        args: str | None = None,
        cwd: str = ".",
        timeout_seconds: int = 300,
    ) -> dict:
        """Run pytest inside the repo root. Returns a parsed summary.

        `path` is the test file/dir (e.g. 'tests/test_flow.py').
        `args` is an optional string of extra pytest flags, e.g. '-m live_paid -vv'.
        """
        root_resolved = ROOT
        try:
            cwd_resolved = validate_cwd(cwd, root_resolved)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
        argv = ["python", "-m", "pytest", path]
        if args:
            try:
                import shlex

                argv += shlex.split(args)
            except ValueError as e:
                return {"ok": False, "error": f"Cannot parse args: {e}"}
        result = run_command(argv, cwd_resolved, _make_env(None), timeout_seconds)
        # Parse summary
        stdout = result.get("stdout", "")
        summary = {"passed": 0, "failed": 0, "skipped": 0, "errors": 0, "duration": None}
        for line in stdout.splitlines():
            if line.strip().startswith("=") and "passed" in line or "failed" in line:
                for label in ("passed", "failed", "skipped", "errors", "error"):
                    marker = f"{label}="
                    idx = line.find(marker)
                    if idx != -1:
                        val = line[idx + len(marker):].split()[0].rstrip(",")
                        if val.isdigit():
                            summary[label] = int(val)
            if "in " in line and "s" in line and "(" in line and ")" in line and "passed" not in line:
                # e.g. "===== 76 passed in 4.72s ====="
                import re

                m = re.search(r"in\s+([\d.]+)s", line)
                if m:
                    summary["duration"] = float(m.group(1))
        summary["exit_code"] = result.get("exit_code")
        summary["timed_out"] = result.get("timed_out", False)
        if result.get("exit_code") == 0:
            summary["status"] = "OK"
        elif result.get("timed_out"):
            summary["status"] = "TIMEOUT"
        else:
            summary["status"] = "FAILED"
        # include tail of stderr for diagnostics
        if result.get("stderr"):
            summary["stderr_tail"] = result["stderr"][-2000:]
        return {"ok": True, "command": " ".join(argv), **summary}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def run_python_script(
        script: str,
        args: str | None = None,
        cwd: str = ".",
        timeout_seconds: int = 300,
    ) -> dict:
        """Run a .py script inside the repo root (e.g. '_ctl/verify_docs.py').

        Returns exit_code + stdout/stderr + parsed 'checks'/'docs' if the
        script prints 'checks=N' style lines.
        """
        try:
            cwd_resolved = validate_cwd(cwd, ROOT)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
        # Validate script path is inside root
        script_path = Path(script)
        if not script_path.is_absolute():
            script_path = (ROOT / script).resolve()
        try:
            script_path.resolve().relative_to(ROOT)
        except ValueError:
            return {"ok": False, "error": f"script '{script}' is outside the repo root."}
        if script_path.suffix.lower() != ".py":
            return {"ok": False, "error": "script must be a .py file."}
        argv = ["python", str(script_path)]
        if args:
            try:
                import shlex

                argv += shlex.split(args)
            except ValueError as e:
                return {"ok": False, "error": f"Cannot parse args: {e}"}
        result = run_command(argv, cwd_resolved, _make_env(None), timeout_seconds)
        stdout = result.get("stdout", "")
        # Extract structured fields if script prints 'key=value' summary lines
        parsed: dict[str, Any] = {}
        for line in stdout.splitlines():
            line = line.strip()
            if line.startswith("checks=") or line.startswith("docs=") or line.startswith("master="):
                k, _, v = line.partition("=")
                parsed[k] = int(v) if v.strip().isdigit() else v.strip()
            if line.startswith("status="):
                k, _, v = line.partition("=")
                parsed[k] = v.strip()
        result["parsed"] = parsed
        return {"ok": True, "command": " ".join(argv), **result}

    # ---- Git -------------------------------------------------------------

    @mcp.tool(annotations={"readOnlyHint": True})
    async def git_status() -> dict:
        """Show git working-tree status (short) of the repo."""
        return _git(["status", "--short"], ROOT)

    @mcp.tool(annotations={"readOnlyHint": True})
    async def git_diff(path: str | None = None, staged: bool = False) -> dict:
        """Show git diff of unstaged (or staged) changes. `path` optional."""
        args = ["diff"]
        if staged:
            args.append("--cached")
        if path:
            args.append(path)
        return _git(args, ROOT)

    @mcp.tool(annotations={"readOnlyHint": True})
    async def git_log(limit: int = 10) -> dict:
        """Show recent git commits."""
        return _git(["log", "--oneline", "-n", str(max(1, min(limit, 100)))], ROOT)

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": False})
    async def git_commit(
        message: str,
        add: bool = True,
        all_changes: bool = False,
    ) -> dict:
        """Create a git checkpoint. `add` stages new/modified files first;
        `all_changes` runs `git add -A`. Destructive only in the sense that it
        writes history — a checkpoint, not a destructive op.
        """
        if add:
            add_args = ["add", "-A"] if all_changes else ["add", "-u"]
            r = _git(add_args, ROOT)
            if r.get("exit_code") != 0:
                return r
        return _git(["commit", "-m", message], ROOT)

    # ---- File hashes / compare / copy ------------------------------------

    @mcp.tool(annotations={"readOnlyHint": True})
    async def file_hash(path: str, algorithm: str = "sha256") -> dict:
        """Compute a file's hash (sha256 default; md5/sha1 also supported)."""
        try:
            target = _resolve_path(path, ROOT)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
        if not target.is_file():
            return {"ok": False, "error": f"'{path}' is not a file."}
        h = hashlib.new(algorithm)
        with target.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return {
            "ok": True,
            "path": target.relative_to(ROOT).as_posix(),
            "algorithm": algorithm,
            "hash": h.hexdigest(),
            "size": target.stat().st_size,
        }

    @mcp.tool(annotations={"readOnlyHint": True})
    async def compare_files(path_a: str, path_b: str) -> dict:
        """Compare two files: same hash? sizes? Optional unified diff snippet."""
        try:
            a = _resolve_path(path_a, ROOT)
            b = _resolve_path(path_b, ROOT)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
        if not a.is_file() or not b.is_file():
            return {"ok": False, "error": "Both paths must be files."}
        same = _sha256(a) == _sha256(b)
        return {
            "ok": True,
            "a": a.relative_to(ROOT).as_posix(),
            "b": b.relative_to(ROOT).as_posix(),
            "identical": same,
            "size_a": a.stat().st_size,
            "size_b": b.stat().st_size,
        }

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
    async def copy_file(src: str, dst: str) -> dict:
        """Copy a file to a new path (backup evidence before editing)."""
        try:
            s = _resolve_path(src, ROOT, for_write=True)
            d = _resolve_path(dst, ROOT, for_write=True)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
        if not s.is_file():
            return {"ok": False, "error": f"'{src}' is not a file."}
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(s, d)
        return {
            "ok": True,
            "from": s.relative_to(ROOT).as_posix(),
            "to": d.relative_to(ROOT).as_posix(),
            "bytes": d.stat().st_size,
        }

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
    async def copy_directory(src: str, dst: str) -> dict:
        """Recursively copy a directory (snapshot of the repo or a folder)."""
        try:
            s = _resolve_path(src, ROOT, for_write=True)
            d = _resolve_path(dst, ROOT, for_write=True)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
        if not s.is_dir():
            return {"ok": False, "error": f"'{src}' is not a directory."}
        d.mkdir(parents=True, exist_ok=True)
        count = 0
        for item in s.rglob("*"):
            if item.is_file():
                rel = item.relative_to(s)
                target = d / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, target)
                count += 1
        return {"ok": True, "from": s.relative_to(ROOT).as_posix(), "to": d.relative_to(ROOT).as_posix(), "files_copied": count}

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
    async def mkdir_temp(prefix: str = "tmp_") -> dict:
        """Create a temp workspace inside the repo root (e.g. for test/capture)."""
        import tempfile

        try:
            base = ROOT
            d = Path(tempfile.mkdtemp(prefix=prefix, dir=str(base)))
            return {"ok": True, "path": d.relative_to(ROOT).as_posix(), "abs": str(d)}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def tail_file(path: str, lines: int = 50, max_chars: int = 4000) -> dict:
        """Read the last N lines of a text file (log tailing)."""
        try:
            target = _resolve_path(path, ROOT)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
        if not target.is_file():
            return {"ok": False, "error": f"'{path}' is not a file."}
        try:
            data = target.read_text(encoding="utf-8", errors="replace")
        except OSError as e:
            return {"ok": False, "error": str(e)}
        tail_lines = data.splitlines()[-max(1, min(lines, 500)):]
        text = "\n".join(tail_lines)
        if len(text) > max_chars:
            text = text[-max_chars:]
        return {"ok": True, "path": target.relative_to(ROOT).as_posix(), "lines": len(tail_lines), "content": text}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def get_disk_usage(base: str = ".") -> dict:
        """Total size and file count of a directory (MP4 evidence can grow fast)."""
        try:
            target = _resolve_path(base, ROOT)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
        if not target.is_dir():
            return {"ok": False, "error": f"'{base}' is not a directory."}
        total = 0
        count = 0
        for item in target.rglob("*"):
            if item.is_file():
                try:
                    total += item.stat().st_size
                    count += 1
                except OSError:
                    pass
        return {
            "ok": True,
            "path": target.relative_to(ROOT).as_posix(),
            "bytes": total,
            "files": count,
            "human": _human(total),
        }

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
    async def zip_directory(src: str, dst: str, exclude: str | None = None) -> dict:
        """Zip a directory into a .zip archive (package evidence/release)."""
        try:
            s = _resolve_path(src, ROOT, for_write=True)
            d = _resolve_path(dst, ROOT, for_write=True)
        except ValueError as e:
            return {"ok": False, "error": str(e)}
        if not s.is_dir():
            return {"ok": False, "error": f"'{src}' is not a directory."}
        d.parent.mkdir(parents=True, exist_ok=True)
        excluded = set(exclude.split(",")) if exclude else set()
        with zipfile.ZipFile(d, "w", zipfile.ZIP_DEFLATED) as zf:
            for item in s.rglob("*"):
                if any(seg in excluded for seg in item.parts):
                    continue
                if item.is_file():
                    zf.write(item, item.relative_to(s).as_posix())
        return {
            "ok": True,
            "src": s.relative_to(ROOT).as_posix(),
            "dst": d.relative_to(ROOT).as_posix(),
            "bytes": d.stat().st_size,
        }

    # ---- System ----------------------------------------------------------

    @mcp.tool(annotations={"readOnlyHint": True})
    async def get_env(name: str | None = None) -> dict:
        """Read one environment variable, or list names of safe allowlisted ones."""
        if name:
            val = os.environ.get(name)
            return {"ok": True, "name": name, "value": val if val is not None else "(unset)"}
        # Return only a fixed allowlist of keys, never full env
        allowlist = {
            "PATH", "PYTHONPATH", "HOME", "USERNAME", "USERPROFILE",
            "LOCALAPPDATA", "TEMP", "FLOW_VEO_MCP_ROOT",
            "FLOW_VEO_MCP_PORT", "FLOW_VEO_MCP_HOST",
        }
        return {
            "ok": True,
            "available": sorted(k for k in allowlist if k in os.environ),
        }

    @mcp.tool(annotations={"readOnlyHint": True})
    async def tcp_check(host: str = "127.0.0.1", port: int = 9222, timeout: float = 3.0) -> dict:
        """Check if a TCP port is open (local Chrome CDP, dev server, MCP)."""
        import socket

        if host not in ("127.0.0.1", "localhost"):
            return {"ok": False, "error": "Only localhost checks allowed (security)."}
        try:
            with socket.create_connection((host, port), timeout=timeout):
                return {"ok": True, "host": host, "port": port, "open": True}
        except OSError:
            return {"ok": True, "host": host, "port": port, "open": False}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def system_info() -> dict:
        """Versions/paths of python, node, git, chrome, pytest — for capability checks."""
        def which(name: str) -> str | None:
            p = shutil.which(name)
            return p

        def run_ver(cmd: list[str]) -> str | None:
            try:
                r = subprocess.run(
                    cmd, capture_output=True, text=True, timeout=10,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
                )
                return (r.stdout or r.stderr).strip().splitlines()[0] if (r.stdout or r.stderr) else None
            except Exception:
                return None

        import platform

        info = {
            "platform": platform.platform(),
            "python": f"{sys.version.split()[0]} @ {which('python')}",
        }
        for tool, cmd in [
            ("node", ["node", "--version"]),
            ("npm", ["npm", "--version"]),
            ("git", ["git", "--version"]),
            ("pytest", [sys.executable, "-m", "pytest", "--version"]),
            ("playwright", [sys.executable, "-m", "playwright", "--version"]),
            ("chrome", None),
        ]:
            if cmd is None:
                for candidate in (
                    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
                    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                ):
                    if Path(candidate).exists():
                        info["chrome"] = candidate
                        break
                continue
            info[tool] = run_ver(cmd)
        return {"ok": True, **info}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def dependency_check(packages: str) -> dict:
        """Check whether comma-separated python packages are importable."""
        result = {}
        for pkg in [p.strip() for p in packages.split(",") if p.strip()]:
            r = subprocess.run(
                [sys.executable, "-c", f"import {pkg}; print(getattr({pkg}, '__version__', 'ok'))"],
                capture_output=True, text=True, timeout=15,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            result[pkg] = {
                "installed": r.returncode == 0,
                "version": (r.stdout or "").strip() or None,
            }
        return {"ok": True, "packages": result}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def find_process(name_pattern: str) -> dict:
        """Find OS processes by name substring (e.g. 'chrome', 'python')."""
        if os.name == "nt":
            r = subprocess.run(
                ["tasklist", "/FO", "CSV", "/NH"],
                capture_output=True, text=True, timeout=15,
                creationflags=subprocess.CREATE_NO_WINDOW,
            )
            matches = []
            for line in r.stdout.splitlines():
                parts = line.strip('"').split('","')
                if len(parts) >= 2 and name_pattern.lower() in parts[0].lower():
                    matches.append({"name": parts[0], "pid": parts[1], "session": parts[2] if len(parts) > 2 else "", "mem": parts[4] if len(parts) > 4 else ""})
            return {"ok": True, "pattern": name_pattern, "count": len(matches), "processes": matches[:50]}
        # POSIX fallback
        r = subprocess.run(["ps", "aux"], capture_output=True, text=True, timeout=15)
        matches = [l for l in r.stdout.splitlines() if name_pattern.lower() in l.lower()]
        return {"ok": True, "pattern": name_pattern, "count": len(matches), "processes": matches[:50]}

    # ---- CDP (Chrome DevTools Protocol) ----------------------------------

    @mcp.tool(annotations={"readOnlyHint": True})
    async def cdp_list_pages(port: int = 9222) -> dict:
        """List Chrome targets (pages) attached to a local CDP port."""
        return _cdp("list", port=port)

    @mcp.tool(annotations={"readOnlyHint": True})
    async def cdp_get_page_url(port: int = 9222, target_id: str | None = None) -> dict:
        """Get the URL of a CDP page (or the first page if target_id omitted)."""
        res = _cdp("list", port=port)
        if not res.get("ok"):
            return res
        targets = res.get("targets", [])
        if not targets:
            return {"ok": True, "url": None, "reason": "no targets"}
        target = next((t for t in targets if t.get("id") == target_id), targets[0])
        return {"ok": True, "target_id": target.get("id"), "title": target.get("title"), "url": target.get("url")}

    # ---- CDP WebSocket commands ------------------------------------------

    async def _cdp_ws(port: int, target_id: str, method: str, params: dict | None = None) -> dict:
        """Send a CDP command via WebSocket and return the result."""
        import asyncio, json as _json
        ws_url = f"ws://127.0.0.1:{port}/devtools/page/{target_id}"
        msg_id = 1
        try:
            import websockets
            async with websockets.connect(ws_url, max_size=10_485_760, ping_interval=30) as ws:
                cmd = _json.dumps({"id": msg_id, "method": method, "params": params or {}})
                await ws.send(cmd)
                resp = await asyncio.wait_for(ws.recv(), timeout=30)
                data = _json.loads(resp) if isinstance(resp, str) else _json.loads(resp.decode())
                if "error" in data:
                    return {"ok": False, "error": data["error"].get("message", str(data["error"]))}
                return {"ok": True, "result": data.get("result")}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def cdp_evaluate(port: int = 9222, target_id: str | None = None, expression: str = "document.title") -> dict:
        """Evaluate JavaScript in a CDP page (e.g. read DOM, trigger events)."""
        res = _cdp("list", port=port)
        if not res.get("ok"): return res
        tid = target_id or (res["targets"][0]["id"] if res["targets"] else None)
        if not tid: return {"ok": False, "error": "no targets"}
        return await _cdp_ws(port, tid, "Runtime.evaluate", {"expression": expression, "returnByValue": True})

    @mcp.tool(annotations={"readOnlyHint": True})
    async def cdp_click(port: int = 9222, target_id: str | None = None, selector: str = "") -> dict:
        """Click an element in a CDP page via JavaScript."""
        expr = f"document.querySelector({selector!r})?.click()" if selector else "document.activeElement?.click()"
        return await cdp_evaluate(port=port, target_id=target_id, expression=expr)

    @mcp.tool(annotations={"readOnlyHint": True})
    async def cdp_fill(port: int = 9222, target_id: str | None = None, selector: str = "", value: str = "") -> dict:
        """Fill an input field in a CDP page."""
        expr = f"const e=document.querySelector({selector!r}); if(e){{e.value={value!r}; e.dispatchEvent(new Event('input',{{bubbles:true}}))}}"
        return await cdp_evaluate(port=port, target_id=target_id, expression=expr)

    @mcp.tool(annotations={"readOnlyHint": True})
    async def cdp_wait_for_selector(port: int = 9222, target_id: str | None = None, selector: str = "", timeout_ms: int = 5000) -> dict:
        """Wait until a selector appears in the DOM. Polls CDP Runtime.evaluate."""
        import asyncio
        expr = f"!!document.querySelector({selector!r})"
        deadline = time.monotonic() + timeout_ms / 1000
        while time.monotonic() < deadline:
            r = await cdp_evaluate(port=port, target_id=target_id, expression=expr)
            if r.get("ok") and r.get("result", {}).get("result", {}).get("value"):
                return {"ok": True, "found": True, "selector": selector}
            await asyncio.sleep(0.3)
        return {"ok": True, "found": False, "selector": selector}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def cdp_screenshot(port: int = 9222, target_id: str | None = None, format: str = "png") -> dict:
        """Take a screenshot of a CDP page. Returns base64-encoded image."""
        if format not in ("png", "jpeg"):
            return {"ok": False, "error": "format must be 'png' or 'jpeg'"}
        res = _cdp("list", port=port)
        if not res.get("ok"): return res
        tid = target_id or (res["targets"][0]["id"] if res["targets"] else None)
        if not tid: return {"ok": False, "error": "no targets"}
        r = await _cdp_ws(port, tid, "Page.captureScreenshot", {"format": format})
        if r.get("ok"):
            r["mime_type"] = f"image/{format}"
        return r

    @mcp.tool(annotations={"readOnlyHint": True})
    async def cdp_network_enable(port: int = 9222, target_id: str | None = None) -> dict:
        """Enable network tracking on a CDP page (must be called before capturing requests)."""
        res = _cdp("list", port=port)
        if not res.get("ok"): return res
        tid = target_id or (res["targets"][0]["id"] if res["targets"] else None)
        if not tid: return {"ok": False, "error": "no targets"}
        return await _cdp_ws(port, tid, "Network.enable")

    @mcp.tool(annotations={"readOnlyHint": True})
    async def cdp_network_events(port: int = 9222, target_id: str | None = None, timeout_ms: int = 5000) -> dict:
        """Collect buffered network events from a CDP page. Returns requestWillBeSent + responseReceived pairs."""
        import asyncio, json as _json
        res = _cdp("list", port=port)
        if not res.get("ok"): return res
        tid = target_id or (res["targets"][0]["id"] if res["targets"] else None)
        if not tid: return {"ok": False, "error": "no targets"}
        ws_url = f"ws://127.0.0.1:{port}/devtools/page/{tid}"
        events = []
        try:
            import websockets
            async with websockets.connect(ws_url, max_size=10_485_760, ping_interval=30) as ws:
                await ws.send(_json.dumps({"id": 1, "method": "Network.enable"}))
                deadline = time.monotonic() + timeout_ms / 1000
                while time.monotonic() < deadline:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=0.5)
                        data = _json.loads(raw) if isinstance(raw, str) else _json.loads(raw.decode())
                        if data.get("method") in ("Network.requestWillBeSent", "Network.responseReceived"):
                            events.append(data)
                    except (asyncio.TimeoutError, asyncio.CancelledError):
                        break
            return {"ok": True, "events": events, "count": len(events)}
        except Exception as e:
            return {"ok": False, "error": str(e)}


def _resolve_path(path: str, root: Path, for_write: bool = False) -> Path:
    """Shared path validation (mirrors server.py's)."""
    if not path or path.isspace():
        raise ValueError("path must not be empty.")
    rel = path.strip().replace("\\", "/").lstrip("/")
    candidate = (root / rel).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        raise ValueError(f"Path '{path}' escapes the root '{root}'.") from None
    if for_write and candidate == root:
        raise ValueError("Cannot use the root directory itself as a write target.")
    return candidate


def _human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024
    return f"{n:.1f} TB"
