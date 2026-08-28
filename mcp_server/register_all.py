"""
Central tool registration for the Computer MCP server.

Wires every tool module onto the FastMCP instance with:
  - audit logging (timestamp, tool, params redacted, ok, duration)
  - correct annotations (readOnlyHint / destructiveHint / idempotentHint)
  - structured error responses (success, error_code, message) instead of raw
    stack traces

All tools run under the current Windows user's permissions — no privilege
escalation, no ACL bypass.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

from security.audit import Audit, setup_audit_log, AUDIT_LOG_ENABLED, sanitize_params
from services.process_manager import PROCESS_MANAGER

# ---------------------------------------------------------------------------
# Generic exec helper (no command whitelist — runs as current user)
# ---------------------------------------------------------------------------

# Git scope: the repo root that git tools are allowed to operate within.
# Flow_veo is a subdirectory of the E:/ repo, so git tools run with cwd =
# GIT_SCOPE (-C) but OUTPUT is filtered to only paths under GIT_PROJECT
# (default E:\\Flow_veo). This prevents listing TapHoaAI, $RECYCLE.BIN,
# System Volume Information etc., which live in the same E:/ repo.
GIT_PROJECT = os.environ.get("FLOW_VEO_MCP_GIT_PROJECT", r"E:\Flow_veo")
GIT_SCOPE = os.environ.get("FLOW_VEO_MCP_GIT_SCOPE", r"E:")


def _resolve_project_path(path: str) -> str:
    """Resolve a path and assert it is inside GIT_PROJECT."""
    from security import paths

    p = paths.normalize(path)
    if not p.resolve().is_relative_to(Path(GIT_PROJECT).resolve()):
        raise paths.PathError("INVALID_PATH", f"path '{path}' is outside the project '{GIT_PROJECT}'.")
    return str(p)


def _git_run(args: list[str], cwd: str | None = None, timeout: int = 60) -> dict:
    """Run a git command with output filtered to GIT_PROJECT paths only.

    Prevents git from leaking the parent repo (E:/) contents outside the
    project directory. Rejects if the resolved cwd is not under the project.
    """
    import shlex

    # Resolve cwd: default to project root, but allow explicit cwd under project.
    scope = cwd or GIT_SCOPE
    if not Path(scope).resolve().is_relative_to(Path(GIT_PROJECT).resolve()):
        return {
            "success": False,
            "error_code": "GIT_OUT_OF_SCOPE",
            "message": f"git scope '{scope}' is outside the project '{GIT_PROJECT}'. "
            "git tools are confined to the project directory.",
        }
    # Run git with -C <cwd> so it does NOT walk up looking for a parent repo.
    # For status/diff/log, add an explicit pathspec so git itself confines the
    # output to the project directory (no manual filter, no parent leakage).
    cmd = ["git", "-C", scope, "--no-pager"] + args
    use_pathspec = args[0] in ("status", "diff") or (
        args[0] == "log" and "|" not in " ".join(args)
    )
    if use_pathspec and not _wants_full_repo(args):
        cmd.append("--")
        cmd.append(str(Path(GIT_PROJECT).resolve()))
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                              creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    except FileNotFoundError:
        return {"success": False, "error_code": "COMMAND_NOT_FOUND", "message": "git not found"}
    except subprocess.TimeoutExpired:
        return {"success": False, "error_code": "COMMAND_TIMEOUT", "message": f"git timed out after {timeout}s", "exit_code": -1}

    stdout = proc.stdout or ""
    stderr = proc.stderr or ""

    return {"success": True, "exit_code": proc.returncode, "stdout": stdout, "stderr": stderr}


def _wants_full_repo(args: list[str]) -> bool:
    """True if the caller explicitly asked for whole-repo scope (e.g. git log)."""
    return "--all" in args or bool(set(args) & {"-n", "--stat", "--name-only", "--name-status"})


def _parse_pytest_summary(stdout: str) -> dict:
    """Parse pytest's summary line into a structured dict.

    Handles both modern ("1 failed, 75 passed in 0.60s") and older
    ("75 passed in 4.72s") formats, including skipped/error/xfailed counts.
    """
    import re

    summary = {"passed": 0, "failed": 0, "skipped": 0, "errors": 0, "xfailed": 0, "duration": None}
    # Find the trailing summary line (last line containing 'passed' or 'failed')
    summary_line = ""
    for line in stdout.splitlines():
        if re.search(r"\bpassed\b|\bfailed\b", line):
            summary_line = line
    if not summary_line:
        return summary

    counts = {"passed": 0, "failed": 0, "skipped": 0, "errors": 0, "warning": 0, "xfailed": 0, "xpassed": 0}
    for label in counts:
        m = re.search(rf"(\d+)\s+{label}", summary_line)
        if m:
            counts[label] = int(m.group(1))

    summary["passed"] = counts["passed"]
    summary["failed"] = counts["failed"]
    summary["skipped"] = counts["skipped"]
    summary["errors"] = counts["errors"]
    summary["xfailed"] = counts["xfailed"]

    m = re.search(r"in\s+([\d.]+)s", summary_line)
    if m:
        summary["duration"] = float(m.group(1))
    return summary


def _is_drive_path(s: str) -> bool:
    """True if s looks like an absolute Windows path (C:\\..., \\\\server\\..., or .\\)."""
    return bool(re.match(r"^[A-Za-z]:[\\/]", s) or s.startswith("\\\\") or s.startswith(".\\") or s.startswith("..\\"))


def _split_command(command: str) -> list[str]:
    """Split a command line into argv, correctly handling full paths with spaces.

    shlex.split(..., posix=False) splits on every space, which breaks executable
    paths like 'C:\\Program Files\\...\\chrome.exe'. Strategy:
      - If the command starts with an absolute Windows path (drive or UNC), find
        where that path ends (the first token that is a flag/arg, i.e. no longer
        a backslash-continued path segment), quote that leading path, then shlex
        the rest. This keeps 'C:\\Program Files\\...\\chrome.exe' as argv[0].
    """
    import shlex

    command = command.strip()
    if not command:
        return []

    # If already starts with a quoted path, just shlex it.
    if command.startswith('"') or command.startswith("'"):
        return shlex.split(command, posix=False)

    # Determine the executable path length if it is a drive/UNC path.
    if _is_drive_path(command):
        idx = _end_of_path(command)
        if idx != -1:
            exe = command[:idx].strip()
            rest = command[idx:].strip()
            command = '"' + exe + '"'
            if rest:
                command += " " + rest
            tokens = shlex.split(command, posix=False)
            # When we quote the executable ourselves, shlex(posix=False) keeps the
            # quotes; strip them from argv[0] since we added them.
            if tokens and tokens[0].startswith('"') and tokens[0].endswith('"'):
                tokens[0] = tokens[0][1:-1]
            return tokens

    # Default: shlex with posix=False handles quoting itself; it fails only on
    # unquoted space-containing paths (already handled above).
    return shlex.split(command, posix=False)


def _end_of_path(cmd: str) -> int:
    """Return the index where the leading executable path ends (before first arg).

    Walks the command; a path segment is a run of chars with no space, OR a space
    followed immediately by another path segment (contains a backslash / continues
    a directory). The path ends at the first token that does not continue a path
    (a flag like '--xxx' or a bare word).
    """
    import re

    # Split candidate into space-separated chunks and decide where the path stops.
    # A chunk belongs to the path if it contains a backslash (Windows dir) or the
    # accumulated path so far has backslashes and this chunk starts with a space-intact
    # segment. Simpler: regex all path segments from the start.
    m = re.match(r"^((?:[A-Za-z]:[\\/](?:[^ ]+[\\/])*[^ ]*|\\\\[^ ]+))(?=\s|$)", cmd)
    # Our path can include spaces inside segments (e.g. "Program Files").
    # We instead scan: consume chars; a space consumes the NEXT token too only if
    # that token later contains a backslash (part of a deep path).
    i = 0
    n = len(cmd)
    # We'll collect token words until we hit a word that is clearly a flag.
    while i < n:
        # read one word
        start = i
        while i < n and cmd[i] != " ":
            i += 1
        word = cmd[start:i]
        # skip spaces
        while i < n and cmd[i] == " ":
            i += 1
        # If word is a flag (starts with -) and we already have a path, stop.
        if word.startswith("-") and i != 0:
            # find index of start of this word
            return cmd.rfind(word)
        # If word contains a backslash, it's still path; continue.
        if "\\" in word or ":" in word:
            continue
        # bare word without backslash that is not a flag — this could be a path
        # segment if we're still early (e.g. drive "C:\" handled) — but for
        # "C:\Program Files\chrome.exe", "Files\chrome.exe" has backslash.
        # If no backslash and it's the first word, probably not a drive path.
        return start
    return n


def _run_exec(command: str, cwd: str, shell: bool, timeout: int, env: dict | None, argv: list[str] | None = None) -> dict:
    """Run a short-lived command, capturing output. No command whitelist."""
    import shlex

    start = time.monotonic()
    kwargs: dict = {"env": env or os.environ.copy()}
    if os.name == "nt":
        kwargs["creationflags"] = subprocess.CREATE_NO_WINDOW
    # timeout<=0 means "no limit" (run to completion) — used for long operations.
    run_timeout = timeout if timeout and timeout > 0 else None
    try:
        if shell:
            # Explicit user request to use a shell (PowerShell/cmd).
            proc = subprocess.run(
                command, cwd=cwd, capture_output=True, text=True,
                shell=True, timeout=run_timeout, **kwargs,
            )
        else:
            if argv is None:
                argv = _split_command(command)
            proc = subprocess.run(
                argv, cwd=cwd, capture_output=True, text=True,
                timeout=run_timeout, **kwargs,
            )
        duration_ms = int((time.monotonic() - start) * 1000)
        # Cap output size
        max_out = int(os.environ.get("MAX_COMMAND_OUTPUT_MB", "10")) * 1024 * 1024
        stdout = (proc.stdout or "")[:max_out]
        stderr = (proc.stderr or "")[:max_out]
        truncated = len(proc.stdout or "") > max_out
        return {
            "success": True,
            "exit_code": proc.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "duration_ms": duration_ms,
            "truncated": truncated,
            "cwd": cwd,
        }
    except subprocess.TimeoutExpired as e:
        duration_ms = int((time.monotonic() - start) * 1000)
        return {
            "success": False,
            "error_code": "COMMAND_TIMEOUT",
            "message": f"Command timed out after {timeout}s",
            "exit_code": -1,
            "stdout": (e.stdout or "")[:2000] if isinstance(e.stdout, str) else "",
            "stderr": (e.stderr or "")[:2000] if isinstance(e.stderr, str) else "",
            "duration_ms": duration_ms,
        }
    except FileNotFoundError as e:
        return {"success": False, "error_code": "COMMAND_NOT_FOUND", "message": f"Executable not found: {e}", "exit_code": -1}
    except OSError as e:
        return {"success": False, "error_code": "ACCESS_DENIED", "message": str(e), "exit_code": -1}


def register_all_tools(mcp) -> None:
    """Register all tool suites. `mcp` is a FastMCP instance."""
    from security import paths as _paths

    if AUDIT_LOG_ENABLED:
        log_dir = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "FlowVeoMCP"
        setup_audit_log(log_dir / "audit.jsonl")

    # ======================================================================
    # Filesystem / navigation (extended_tools)
    # ======================================================================
    import extended_tools as ext

    @mcp.tool(annotations={"readOnlyHint": True})
    async def get_roots() -> dict:
        """READ-ONLY. List all drive roots (for example C:, D:, E:) with size, free space and drive type."""
        with Audit("get_roots", {}) as a:
            res = ext.get_roots()
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"readOnlyHint": True})
    async def list_directory(path: str = ".", include_hidden: bool = False) -> dict:
        """READ-ONLY. List immediate contents of a directory. `path` may be any absolute Windows path."""
        with Audit("list_directory", {"path": path, "include_hidden": include_hidden}) as a:
            res = ext.list_directory(path, include_hidden)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"readOnlyHint": True})
    async def list_tree(path: str = ".", max_depth: int = 3, max_entries: int = 500, include_hidden: bool = False) -> dict:
        """READ-ONLY. List a directory tree up to max_depth, bounded by max_entries."""
        with Audit("list_tree", {"path": path, "max_depth": max_depth}) as a:
            res = ext.list_tree(path, max_depth, max_entries, include_hidden)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"readOnlyHint": True})
    async def stat_path(path: str) -> dict:
        """READ-ONLY. Stat a file or directory (size, mtime, ctime, type)."""
        with Audit("stat_path", {"path": path}) as a:
            res = ext.stat_path(path)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"readOnlyHint": True})
    async def path_exists(path: str) -> dict:
        """READ-ONLY. Check whether a path exists and its type."""
        with Audit("path_exists", {"path": path}) as a:
            res = ext.path_exists(path)
            a.success = res.get("success", False)
            return res

    # ======================================================================
    # File reading
    # ======================================================================

    @mcp.tool(annotations={"readOnlyHint": True})
    async def read_file_range(path: str, start_line: int | None = None, end_line: int | None = None, max_chars: int | None = None) -> dict:
        """READ-ONLY. Read a text file, optionally by line range. Large-file safe (returns FILE_TOO_LARGE for huge files instead of loading them)."""
        with Audit("read_file_range", {"path": path, "start_line": start_line, "end_line": end_line}) as a:
            res = ext.read_file_range(path, start_line, end_line, max_chars)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"readOnlyHint": True})
    async def tail_file(path: str, lines: int = 50, max_chars: int = 5000) -> dict:
        """READ-ONLY. Read the last N lines of a file (log tailing)."""
        with Audit("tail_file", {"path": path, "lines": lines}) as a:
            res = ext.tail_file(path, lines, max_chars)
            a.success = res.get("success", False)
            return res

    # ======================================================================
    # Writing / editing
    # ======================================================================

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
    async def write_file(path: str, content: str, encoding: str = "utf-8", create_parents: bool = True, overwrite: bool = True) -> dict:
        """WRITE. Create or overwrite a file. Use patch_file instead when only a small portion of an existing file needs changing."""
        with Audit("write_file", {"path": path, "overwrite": overwrite, "bytes": len(content.encode(encoding))}) as a:
            res = ext.write_file(path, content, encoding, create_parents, overwrite)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
    async def append_file(path: str, content: str, encoding: str = "utf-8") -> dict:
        """WRITE. Append text to a file, creating it if missing."""
        with Audit("append_file", {"path": path, "bytes": len(content.encode(encoding))}) as a:
            res = ext.append_file(path, content, encoding)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": False})
    async def patch_file(path: str, old_text: str, new_text: str, replace_all: bool = False, expected_occurrences: int | None = None) -> dict:
        """WRITE. Apply a precise text patch to a file (replace old_text with new_text). Returns before_hash/after_hash. Fails with PATCH_CONFLICT if the match count differs — never silently overwrites."""
        with Audit("patch_file", {"path": path, "replace_all": replace_all, "expected_occurrences": expected_occurrences}) as a:
            res = ext.patch_file(path, old_text, new_text, replace_all, expected_occurrences)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": False})
    async def replace_text(path: str, old_text: str, new_text: str, replace_all: bool = True, expected_occurrences: int | None = None) -> dict:
        """WRITE. Replace text occurrences in a file. Errors if occurrence count differs from expected."""
        with Audit("replace_text", {"path": path, "replace_all": replace_all, "expected_occurrences": expected_occurrences}) as a:
            res = ext.replace_text(path, old_text, new_text, replace_all, expected_occurrences)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": False})
    async def insert_text(path: str, anchor_text: str, new_text: str, after: bool = True, occurrence: int = 1) -> dict:
        """WRITE. Insert text before/after the Nth occurrence of anchor_text."""
        with Audit("insert_text", {"path": path, "after": after, "occurrence": occurrence}) as a:
            res = ext.insert_text(path, anchor_text, new_text, after, occurrence)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": False})
    async def delete_text_range(path: str, start_text: str, end_text: str, occurrence: int = 1) -> dict:
        """WRITE. Delete text from start_text to the first end_text after it (inclusive)."""
        with Audit("delete_text_range", {"path": path, "occurrence": occurrence}) as a:
            res = ext.delete_text_range(path, start_text, end_text, occurrence)
            a.success = res.get("success", False)
            return res

    # ======================================================================
    # File operations
    # ======================================================================

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
    async def copy_file(src: str, dst: str, overwrite: bool = False) -> dict:
        """WRITE. Copy a file. Fails if dst exists unless overwrite=true."""
        with Audit("copy_file", {"src": src, "dst": dst, "overwrite": overwrite}) as a:
            res = ext.copy_file(src, dst, overwrite)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
    async def copy_directory(src: str, dst: str, overwrite: bool = False) -> dict:
        """WRITE. Recursively copy a directory tree."""
        with Audit("copy_directory", {"src": src, "dst": dst, "overwrite": overwrite}) as a:
            res = ext.copy_directory(src, dst, overwrite)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
    async def move_file(src: str, dst: str, overwrite: bool = False) -> dict:
        """WRITE. Move a file. Fails if dst exists unless overwrite=true."""
        with Audit("move_file", {"src": src, "dst": dst, "overwrite": overwrite}) as a:
            res = ext.move_file(src, dst, overwrite)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
    async def move_directory(src: str, dst: str, overwrite: bool = False) -> dict:
        """WRITE. Move a directory tree."""
        with Audit("move_directory", {"src": src, "dst": dst, "overwrite": overwrite}) as a:
            res = ext.move_directory(src, dst, overwrite)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
    async def rename_path(path: str, new_name: str) -> dict:
        """WRITE. Rename or move a file/directory. Destructive if target exists."""
        with Audit("rename_path", {"path": path, "new_name": new_name}) as a:
            res = ext.rename_path(path, new_name)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": False})
    async def delete_file(path: str) -> dict:
        """DESTRUCTIVE. Permanently delete a file. Not recoverable. Confirm before calling."""
        with Audit("delete_file", {"path": path}) as a:
            res = ext.delete_file(path)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": False})
    async def delete_directory(path: str, recursive: bool = False) -> dict:
        """DESTRUCTIVE. Delete a directory. Recursive deletes require recursive=true (never default)."""
        with Audit("delete_directory", {"path": path, "recursive": recursive}) as a:
            res = ext.delete_directory(path, recursive)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
    async def create_directory(path: str) -> dict:
        """WRITE. Create a directory (and parents)."""
        with Audit("create_directory", {"path": path}) as a:
            res = ext.create_directory(path)
            a.success = res.get("success", False)
            return res

    # ======================================================================
    # Search
    # ======================================================================

    @mcp.tool(annotations={"readOnlyHint": True})
    async def search_files(root: str = ".", name_pattern: str | None = None, extension: str | None = None, recursive: bool = True, max_results: int = 100) -> dict:
        """READ-ONLY. Search for files by name pattern (glob) and/or extension under root."""
        with Audit("search_files", {"root": root, "name_pattern": name_pattern, "extension": extension}) as a:
            res = ext.search_files(root, name_pattern, extension, recursive, max_results)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"readOnlyHint": True})
    async def grep(root: str = ".", pattern: str = "", file_glob: str | None = None, regex: bool = False, case_sensitive: bool = False, max_results: int = 100) -> dict:
        """READ-ONLY. Search file contents for text or regex. Returns {file, line, column, matching_text}."""
        with Audit("grep", {"root": root, "pattern": pattern, "regex": regex}) as a:
            res = ext.grep(root, pattern, file_glob, regex, case_sensitive, max_results)
            a.success = res.get("success", False)
            return res

    # ======================================================================
    # Hash / compare
    # ======================================================================

    @mcp.tool(annotations={"readOnlyHint": True})
    async def file_hash(path: str, algorithm: str = "sha256") -> dict:
        """READ-ONLY. Compute a file's SHA-256 (or md5/sha1) hash, streamed for large files."""
        with Audit("file_hash", {"path": path, "algorithm": algorithm}) as a:
            res = ext.file_hash(path, algorithm)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"readOnlyHint": True})
    async def compare_files(path_a: str, path_b: str) -> dict:
        """READ-ONLY. Compare two files: identical (by hash), sizes, hashes."""
        with Audit("compare_files", {"path_a": path_a, "path_b": path_b}) as a:
            res = ext.compare_files(path_a, path_b)
            a.success = res.get("success", False)
            return res

    # ======================================================================
    # Archive
    # ======================================================================

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
    async def zip_directory(src: str, dst: str, exclude: str | None = None) -> dict:
        """WRITE. Zip a directory into a .zip archive."""
        with Audit("zip_directory", {"src": src, "dst": dst}) as a:
            res = ext.zip_directory(src, dst, exclude)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": True})
    async def unzip_archive(src: str, dst: str) -> dict:
        """WRITE. Extract a zip archive. Zip-slip protected (members cannot escape dst)."""
        with Audit("unzip_archive", {"src": src, "dst": dst}) as a:
            res = ext.unzip_archive(src, dst)
            a.success = res.get("success", False)
            return res

    # ======================================================================
    # Command execution
    # ======================================================================

    @mcp.tool(annotations={"readOnlyHint": True})
    async def exec_command(command: str, cwd: str = ".", shell: bool = False, timeout: int = 0, env: dict | None = None) -> dict:
        """EXECUTE. Run a command (PowerShell/cmd/python/node/git/npm/any CLI on PATH) and capture output.

        Runs with the current user's permissions — no elevation. `cwd` may be any path.
        Full absolute executable paths with spaces (e.g. "C:\\Program Files\\...\\chrome.exe")
        are handled correctly. `shell=true` passes the command to a shell for pipes/redirects.
        `timeout=0` (default) means NO TIME LIMIT — the command runs to completion (use only for
        commands known to finish). For genuinely long-running work use start_process instead.
        """
        with Audit("exec_command", {"command": command[:200], "cwd": cwd, "shell": shell, "timeout": timeout}) as a:
            if timeout < 0 or timeout > 86400:
                return {"success": False, "error_code": "INVALID_INPUT", "message": "timeout must be 0 (no limit) or 1..86400"}
            try:
                cwd_resolved = _paths.normalize(cwd)
                if not cwd_resolved.is_dir():
                    cwd_resolved = cwd_resolved.parent
            except _paths.PathError as e:
                return {"success": False, "error_code": e.code, "message": e.message}
            res = _run_exec(command, str(cwd_resolved), shell, timeout, env)
            a.success = res.get("success", False)
            return res

    # ======================================================================
    # Process management
    # ======================================================================

    @mcp.tool(annotations={"readOnlyHint": True})
    async def start_process(command: str, cwd: str = ".", env: dict | None = None, name: str | None = None) -> dict:
        """EXECUTE. Start a long-running process (dev server, Chrome CDP). Returns process_id for status/output/kill."""
        with Audit("start_process", {"command": command[:200], "cwd": cwd, "name": name}) as a:
            try:
                cwd_resolved = _paths.normalize(cwd)
                if not cwd_resolved.is_dir():
                    cwd_resolved = cwd_resolved.parent
            except _paths.PathError as e:
                return {"success": False, "error_code": e.code, "message": e.message}
            try:
                argv = _split_command(command)
            except ValueError as e:
                return {"success": False, "error_code": "INVALID_INPUT", "message": str(e)}
            try:
                mp = PROCESS_MANAGER.start(argv, str(cwd_resolved), env, name=name)
            except OSError as e:
                return {"success": False, "error_code": "COMMAND_NOT_FOUND", "message": str(e)}
            a.success = True
            return {
                "success": True,
                "process_id": mp.process_id,
                "pid": mp.pid,
                "status": "running",
                "started_at": mp.started_at,
                "argv": argv,
            }

    @mcp.tool(annotations={"readOnlyHint": True})
    async def process_status(process_id: int) -> dict:
        """READ-ONLY. Check status of a process started via start_process."""
        with Audit("process_status", {"process_id": process_id}) as a:
            res = PROCESS_MANAGER.status(process_id)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"readOnlyHint": True})
    async def get_process_output(process_id: int, stream: str = "stdout", offset: int = 0, limit: int = 10000) -> dict:
        """READ-ONLY. Read buffered stdout/stderr of a process. Pass back next_offset for incremental reads."""
        with Audit("get_process_output", {"process_id": process_id, "stream": stream, "offset": offset}) as a:
            res = PROCESS_MANAGER.read_output(process_id, stream, offset, limit)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": False})
    async def kill_process(process_id: int) -> dict:
        """DESTRUCTIVE. Kill a process started via start_process (and children)."""
        with Audit("kill_process", {"process_id": process_id}) as a:
            res = PROCESS_MANAGER.kill(process_id)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"readOnlyHint": True})
    async def list_processes() -> dict:
        """READ-ONLY. List all processes started via start_process in this session."""
        with Audit("list_processes", {}) as a:
            a.success = True
            return {"success": True, "processes": PROCESS_MANAGER.list()}

    # ======================================================================
    # System
    # ======================================================================

    @mcp.tool(annotations={"readOnlyHint": True})
    async def system_info() -> dict:
        """READ-ONLY. OS, version, hostname, arch, CPU, RAM, python/node versions, current user, cwd. Never returns secrets."""
        import platform

        info = {
            "os": platform.system(),
            "os_version": platform.version(),
            "hostname": platform.node(),
            "architecture": platform.machine(),
            "processor": platform.processor(),
            "python": sys.version.split()[0],
            "python_path": sys.executable,
            "current_user": os.environ.get("USERNAME") or os.environ.get("USER"),
            "cwd": os.getcwd(),
        }
        # RAM
        try:
            if os.name == "nt":
                import ctypes

                class MEMORYSTATUSEX(ctypes.Structure):
                    _fields_ = [
                        ("dwLength", ctypes.c_ulong), ("dwMemoryLoad", ctypes.c_ulong),
                        ("ullTotalPhys", ctypes.c_ulonglong), ("ullAvailPhys", ctypes.c_ulonglong),
                        ("ullTotalPageFile", ctypes.c_ulonglong), ("ullAvailPageFile", ctypes.c_ulonglong),
                        ("ullTotalVirtual", ctypes.c_ulonglong), ("ullAvailVirtual", ctypes.c_ulonglong),
                        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
                    ]

                m = MEMORYSTATUSEX()
                m.dwLength = ctypes.sizeof(MEMORYSTATUSEX)
                ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(m))
                info["ram_total_gb"] = round(m.ullTotalPhys / (1024**3), 1)
                info["ram_free_gb"] = round(m.ullAvailPhys / (1024**3), 1)
        except Exception:
            pass
        # Node version if present
        try:
            r = subprocess.run(["node", "--version"], capture_output=True, text=True, timeout=5)
            if r.returncode == 0:
                info["node"] = r.stdout.strip()
        except Exception:
            pass
        return {"success": True, **info}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def get_environment(names: str | None = None) -> dict:
        """READ-ONLY. Read environment variables (comma-separated names) or list available safe ones. Never returns secret values."""
        with Audit("get_environment", {"names": names}) as a:
            res = ext.get_environment(names)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"readOnlyHint": True})
    async def which_command(name: str) -> dict:
        """READ-ONLY. Locate an executable on PATH."""
        with Audit("which_command", {"name": name}) as a:
            res = ext.which_command(name)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"readOnlyHint": True})
    async def disk_usage(path: str = ".") -> dict:
        """READ-ONLY. Disk usage for a path/drive."""
        with Audit("disk_usage", {"path": path}) as a:
            res = ext.disk_usage(path)
            a.success = res.get("success", False)
            return res

    # ======================================================================
    # Testing
    # ======================================================================

    @mcp.tool(annotations={"readOnlyHint": True})
    async def run_pytest(path: str = "tests", args: str | None = None, cwd: str = ".", timeout: int = 0) -> dict:
        """EXECUTE. Run pytest and return a parsed summary (passed/failed/skipped/duration).

        `path` is the test file/dir. `args` is optional extra pytest flags, e.g. '-m live_paid -vv'.
        `timeout=0` (default) means NO LIMIT; otherwise seconds up to 86400.
        """
        with Audit("run_pytest", {"path": path, "args": args, "cwd": cwd}) as a:
            try:
                cwd_resolved = _paths.normalize(cwd)
                if not cwd_resolved.is_dir():
                    cwd_resolved = cwd_resolved.parent
            except _paths.PathError as e:
                return {"success": False, "error_code": e.code, "message": e.message}
            import shlex

            argv = ["python", "-m", "pytest", path]
            if args:
                try:
                    argv += shlex.split(args)
                except ValueError as e:
                    return {"success": False, "error_code": "INVALID_INPUT", "message": str(e)}
            res = _run_exec(" ".join(f'"{x}"' if " " in x else x for x in argv), str(cwd_resolved), False, timeout, None)
            stdout = res.get("stdout", "")
            summary = _parse_pytest_summary(stdout)
            summary["exit_code"] = res.get("exit_code")
            summary["status"] = "OK" if res.get("exit_code") == 0 else "FAILED"
            if res.get("stderr"):
                summary["stderr_tail"] = res["stderr"][-1500:]
            a.success = res.get("success", False)
            return {"success": True, **summary}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def run_python_script(script: str, args: str | None = None, cwd: str = ".", timeout: int = 0) -> dict:
        """EXECUTE. Run a .py script (e.g. '_ctl/verify_docs.py') and return exit_code + stdout/stderr. timeout=0 = no limit."""
        with Audit("run_python_script", {"script": script, "args": args, "cwd": cwd}) as a:
            try:
                cwd_resolved = _paths.normalize(cwd)
                if not cwd_resolved.is_dir():
                    cwd_resolved = cwd_resolved.parent
            except _paths.PathError as e:
                return {"success": False, "error_code": e.code, "message": e.message}
            import shlex

            argv = ["python", script]
            if args:
                try:
                    argv += shlex.split(args)
                except ValueError as e:
                    return {"success": False, "error_code": "INVALID_INPUT", "message": str(e)}
            res = _run_exec(" ".join(f'"{x}"' if " " in x else x for x in argv), str(cwd_resolved), False, timeout, None)
            a.success = res.get("success", False)
            return res

    # ======================================================================
    # CDP (Chrome DevTools Protocol)
    # ======================================================================

    @mcp.tool(annotations={"readOnlyHint": True})
    async def cdp_list_pages(port: int = 9222) -> dict:
        """READ-ONLY. List Chrome targets (pages) on a local CDP port."""
        import urllib.request

        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5) as r:
                targets = json.loads(r.read().decode())
            return {"success": True, "port": port, "count": len(targets), "targets": [{"id": t.get("id"), "title": t.get("title"), "url": t.get("url"), "type": t.get("type")} for t in targets]}
        except Exception as e:
            return {"success": False, "error_code": "CONNECTION_FAILED", "message": f"Cannot reach CDP on port {port}: {e}"}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def cdp_get_page_url(port: int = 9222, target_id: str | None = None) -> dict:
        """READ-ONLY. Get the URL of a CDP page (or the first page if target_id omitted)."""
        import urllib.request

        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5) as r:
                targets = json.loads(r.read().decode())
            if not targets:
                return {"success": True, "url": None, "reason": "no targets"}
            target = next((t for t in targets if t.get("id") == target_id), targets[0])
            return {"success": True, "target_id": target.get("id"), "title": target.get("title"), "url": target.get("url")}
        except Exception as e:
            return {"success": False, "error_code": "CONNECTION_FAILED", "message": str(e)}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def cdp_evaluate(port: int = 9222, target_id: str | None = None, expression: str = "document.title") -> dict:
        """READ-ONLY. Evaluate JavaScript in a CDP page (read DOM, trigger events)."""
        import asyncio
        import urllib.request

        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=5) as r:
                targets = json.loads(r.read().decode())
            tid = target_id or (targets[0]["id"] if targets else None)
            if not tid:
                return {"success": False, "error_code": "CONNECTION_FAILED", "message": "no targets"}
            ws_url = f"ws://127.0.0.1:{port}/devtools/page/{tid}"
            import websockets

            async def _eval():
                async with websockets.connect(ws_url, max_size=10_485_760) as ws:
                    await ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": expression, "returnByValue": True}}))
                    resp = await asyncio.wait_for(ws.recv(), timeout=15)
                    data = json.loads(resp) if isinstance(resp, str) else json.loads(resp.decode())
                    if "error" in data:
                        return {"success": False, "error_code": "CDP_ERROR", "message": data["error"].get("message", str(data["error"]))}
                    return {"success": True, "result": data.get("result", {}).get("result")}

            return asyncio.run(_eval())
        except Exception as e:
            return {"success": False, "error_code": "CONNECTION_FAILED", "message": str(e)}

    @mcp.tool(annotations={"readOnlyHint": True})
    async def cdp_network_enable(port: int = 9222, target_id: str | None = None) -> dict:
        """READ-ONLY. Enable network tracking on a CDP page (call before capturing)."""
        return await cdp_evaluate(port=port, target_id=target_id, expression="1")

    # ======================================================================
    # Git
    # ======================================================================

    @mcp.tool(annotations={"readOnlyHint": True})
    async def git_status(cwd: str | None = None) -> dict:
        """READ-ONLY. git status --short, confined to the project directory (E:\\Flow_veo).

        NEVER walks up to a parent repo — shows only paths under the project.
        """
        with Audit("git_status", {"cwd": cwd}) as a:
            res = _git_run(["status", "--short"], cwd)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"readOnlyHint": True})
    async def git_diff(path: str | None = None, staged: bool = False, cwd: str | None = None) -> dict:
        """READ-ONLY. git diff (unstaged or --cached), confined to the project.

        `path` is a path under the project; it is validated to stay inside.
        """
        with Audit("git_diff", {"path": path, "staged": staged, "cwd": cwd}) as a:
            args = ["diff"]
            if staged:
                args.append("--cached")
            if path:
                # Validate the path is inside the project.
                try:
                    p = _resolve_project_path(path)
                except _paths.PathError as e:
                    return {"success": False, "error_code": e.code, "message": e.message}
                args.extend(["--", p])
            res = _git_run(args, cwd)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"readOnlyHint": True})
    async def git_log(limit: int = 10, cwd: str | None = None) -> dict:
        """READ-ONLY. git log --oneline -n limit, confined to the project."""
        with Audit("git_log", {"limit": limit, "cwd": cwd}) as a:
            res = _git_run(["log", "--oneline", "-n", str(max(1, min(limit, 100)))], cwd)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"readOnlyHint": True})
    async def git_branch(cwd: str | None = None) -> dict:
        """READ-ONLY. Show current git branch, confined to the project."""
        with Audit("git_branch", {"cwd": cwd}) as a:
            res = _git_run(["branch", "--show-current"], cwd)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": False})
    async def git_commit(message: str, add: bool = True, all_changes: bool = False, cwd: str | None = None) -> dict:
        """WRITE. Commit changes confined to the project. Does NOT push."""
        with Audit("git_commit", {"message": message[:100], "add": add, "all_changes": all_changes, "cwd": cwd}) as a:
            if add:
                r = _git_run(["add", "-A"] if all_changes else ["add", "-u"], cwd)
                if r.get("exit_code") != 0:
                    return r
            res = _git_run(["commit", "-m", message], cwd)
            a.success = res.get("success", False)
            return res

    @mcp.tool(annotations={"destructiveHint": True, "idempotentHint": False})
    async def git_commit_file(path: str, message: str) -> dict:
        """WRITE. Stage one file (inside the project) and commit it. Does NOT push."""
        with Audit("git_commit_file", {"path": path, "message": message[:100]}) as a:
            try:
                p = _resolve_project_path(path)
            except _paths.PathError as e:
                return {"success": False, "error_code": e.code, "message": e.message}
            res = _git_run(["add", "--", p])
            if res.get("exit_code") != 0:
                return res
            res = _git_run(["commit", "-m", message])
            a.success = res.get("success", False)
            return res
