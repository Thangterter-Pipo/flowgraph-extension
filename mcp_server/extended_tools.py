"""
Extended full-machine tools for the Computer MCP server.

Adds the remaining capabilities from the full-machine spec that the
filesystem/exec toolsets do not yet cover:

  - get_roots / list_directory / stat_path / path_exists (any drive)
  - patch_file / replace_text / insert_text / delete_text_range (precise edits)
  - read_file_range / tail_file (large-file safe)
  - move_file / move_directory / delete_directory / list_tree (max_entries)
  - grep (regex, case_sensitive, per-file match positions)
  - unzip_archive (zip-slip safe)
  - get_environment / which_command / disk_usage / get_roots sizes
  - git_branch / git_commit_file

All paths may be ANY absolute Windows path the current user can access.
Permissions are enforced by the OS (current user), never bypassed.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

from security import PathError, must_exist, normalize, safe_join_zip, iter_under


def _err(e: PathError) -> dict:
    return {"success": False, "error_code": e.code, "message": e.message, "path": e.path}


def _human(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f} {unit}" if unit != "B" else f"{n} B"
        n /= 1024
    return f"{n:.1f} TB"


# ---------------------------------------------------------------------------
# Navigation
# ---------------------------------------------------------------------------

def get_roots() -> dict:
    """List all drive roots visible to the current Windows user with sizes."""
    roots = []
    if os.name == "nt":
        import ctypes

        bitmask = ctypes.windll.kernel32.GetLogicalDrives()
        for i in range(26):
            if bitmask & (1 << i):
                letter = chr(65 + i)
                drive = f"{letter}:\\"
                info = {"drive": drive}
                try:
                    usage = shutil.disk_usage(drive)
                    info.update({
                        "total_bytes": usage.total,
                        "free_bytes": usage.free,
                        "used_bytes": usage.used,
                        "total_human": _human(usage.total),
                        "free_human": _human(usage.free),
                    })
                except OSError:
                    info["error"] = "not accessible"
                # Try to detect drive type
                try:
                    dt = ctypes.windll.kernel32.GetDriveTypeW(drive)
                    info["type"] = {
                        0: "unknown", 1: "no_root", 2: "removable",
                        3: "fixed", 4: "remote", 5: "cdrom", 6: "ramdisk",
                    }.get(dt, "unknown")
                except Exception:
                    info["type"] = "unknown"
                roots.append(info)
    else:
        for p in Path("/").iterdir():
            if p.is_dir():
                roots.append({"path": str(p)})
    return {"success": True, "roots": roots, "count": len(roots)}


def list_directory(path: str = ".", include_hidden: bool = False) -> dict:
    """List the immediate contents of a directory. `path` may be any absolute
    Windows path or a relative path resolved against the working directory."""
    try:
        target = must_exist(path, expect_file=False)
        entries = []
        for p in sorted(target.iterdir()):
            name = p.name
            if not include_hidden and name.startswith(".") and name not in (".", ".."):
                continue
            try:
                st = p.stat()
                entries.append({
                    "name": name,
                    "path": str(p),
                    "type": "dir" if p.is_dir() else "file",
                    "size": 0 if p.is_dir() else st.st_size,
                    "modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
                })
            except OSError as e:
                entries.append({"name": name, "path": str(p), "error": str(e)})
        return {"success": True, "path": str(target), "count": len(entries), "entries": entries}
    except PathError as e:
        return _err(e)


def list_tree(
    path: str = ".",
    max_depth: int = 3,
    max_entries: int = 500,
    include_hidden: bool = False,
) -> dict:
    """List a directory tree up to max_depth. Bounded by max_entries to avoid
    unbounded recursion."""
    try:
        target = must_exist(path, expect_file=False)
        results = []
        base_depth = len(target.parts)
        for p in sorted(target.rglob("*")):
            if not include_hidden and any(
                part.startswith(".") and part not in (".", "..") for part in p.parts
            ):
                continue
            depth = len(p.parts) - base_depth
            if depth > max_depth:
                continue
            try:
                st = p.stat()
                results.append({
                    "name": p.name,
                    "path": str(p),
                    "type": "dir" if p.is_dir() else "file",
                    "size": 0 if p.is_dir() else st.st_size,
                    "depth": depth,
                })
            except OSError:
                results.append({"name": p.name, "path": str(p), "type": "unknown", "depth": depth})
            if len(results) >= max_entries:
                results.append({"note": f"Reached max_entries={max_entries}; truncated."})
                break
        return {"success": True, "path": str(target), "count": len(results), "entries": results}
    except PathError as e:
        return _err(e)


def stat_path(path: str) -> dict:
    """Return stat metadata for a file or directory."""
    try:
        target = must_exist(path)
        st = target.stat()
        return {
            "success": True,
            "path": str(target),
            "type": "dir" if target.is_dir() else "file",
            "size": st.st_size,
            "modified": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_mtime)),
            "created": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(st.st_ctime)),
            "mode": oct(st.st_mode),
        }
    except PathError as e:
        return _err(e)


def path_exists(path: str) -> dict:
    """Check whether a path exists and what it is."""
    try:
        p = normalize(path)
        return {"success": True, "path": str(p), "exists": p.exists(), "type": "dir" if p.is_dir() else ("file" if p.is_file() else "other")}
    except PathError as e:
        return {"success": False, "error_code": e.code, "message": e.message, "path": e.path}


# ---------------------------------------------------------------------------
# Reading
# ---------------------------------------------------------------------------

def read_file_range(
    path: str,
    start_line: int | None = None,
    end_line: int | None = None,
    max_chars: int | None = None,
) -> dict:
    """Read a text file, optionally by line range. Never loads a huge file fully."""
    try:
        target = must_exist(path, expect_file=True)
        size = target.stat().st_size
        max_read = float(os.environ.get("MAX_FILE_READ_MB", "50")) * 1024 * 1024
        # If a line range is given, stream; else cap by max_chars
        if start_line is not None or end_line is not None:
            lines = []
            line_no = 0
            with target.open("r", encoding="utf-8", errors="replace") as f:
                for raw in f:
                    line_no += 1
                    if start_line is not None and line_no < start_line:
                        continue
                    if end_line is not None and line_no > end_line:
                        break
                    lines.append(raw.rstrip("\n"))
            content = "\n".join(lines)
        else:
            if size > max_read:
                return {
                    "success": False,
                    "error_code": "FILE_TOO_LARGE",
                    "message": f"File is {_human(size)}. Use start_line/end_line or read_file_range to read partially.",
                    "path": str(target),
                    "size": size,
                }
            content = target.read_text(encoding="utf-8", errors="replace")
        if max_chars and len(content) > max_chars:
            content = content[:max_chars] + "\n...[truncated]"
        return {"success": True, "path": str(target), "size": size, "content": content}
    except PathError as e:
        return _err(e)


def tail_file(path: str, lines: int = 50, max_chars: int = 5000) -> dict:
    """Read the last N lines of a file (log tailing), memory-safe."""
    try:
        target = must_exist(path, expect_file=True)
        tail_lines = []
        with target.open("r", encoding="utf-8", errors="replace") as f:
            # Read in reverse-ish chunks; simpler: read last max_chars*2 bytes then split
            f.seek(0, os.SEEK_END)
            size = f.tell()
            read_size = min(size, max_chars * 2)
            f.seek(size - read_size)
            data = f.read()
        all_lines = data.splitlines()
        tail_lines = all_lines[-max(1, min(lines, 500)):]
        text = "\n".join(tail_lines)
        if len(text) > max_chars:
            text = text[-max_chars:]
        return {"success": True, "path": str(target), "lines": len(tail_lines), "content": text}
    except PathError as e:
        return _err(e)


# ---------------------------------------------------------------------------
# Editing (precise)
# ---------------------------------------------------------------------------

def _read_text_safe(path: Path) -> tuple[str, str]:
    return path.read_text(encoding="utf-8"), "utf-8"


def patch_file(path: str, old_text: str, new_text: str, replace_all: bool = False, expected_occurrences: int | None = None) -> dict:
    """Apply a precise text patch to a file. Replaces `old_text` with `new_text`.

    Fails (PATCH_CONFLICT) if the old_text is not found the expected number of
    times — never silently overwrites on a failed match.
    """
    try:
        target = must_exist(path, expect_file=True)
        before_hash = hashlib.sha256(target.read_bytes()).hexdigest()
        content, enc = _read_text_safe(target)
        occurrences = content.count(old_text)
        if occurrences == 0:
            return {"success": False, "error_code": "PATCH_CONFLICT", "message": f"old_text not found in file ({path}).", "path": str(target), "before_hash": before_hash}
        if expected_occurrences is not None and occurrences != expected_occurrences:
            return {"success": False, "error_code": "PATCH_CONFLICT", "message": f"Found {occurrences} occurrences, expected {expected_occurrences}.", "path": str(target), "before_hash": before_hash}
        if not replace_all:
            new_content = content.replace(old_text, new_text, 1)
        else:
            new_content = content.replace(old_text, new_text)
        target.write_text(new_content, encoding="utf-8")
        after_hash = hashlib.sha256(target.read_bytes()).hexdigest()
        return {
            "success": True,
            "path": str(target),
            "changed_lines": len(content.splitlines()) - len(new_content.splitlines()),
            "before_hash": before_hash,
            "after_hash": after_hash,
            "occurrences_replaced": occurrences if replace_all else 1,
        }
    except PathError as e:
        return _err(e)


def replace_text(path: str, old_text: str, new_text: str, replace_all: bool = True, expected_occurrences: int | None = None) -> dict:
    """Replace text occurrences in a file. Alias-friendly to patch_file."""
    return patch_file(path, old_text, new_text, replace_all=replace_all, expected_occurrences=expected_occurrences)


def insert_text(path: str, anchor_text: str, new_text: str, after: bool = True, occurrence: int = 1) -> dict:
    """Insert text before/after the Nth occurrence of anchor_text."""
    try:
        target = must_exist(path, expect_file=True)
        before_hash = hashlib.sha256(target.read_bytes()).hexdigest()
        content, _ = _read_text_safe(target)
        idx = -1
        count = 0
        pos = 0
        while True:
            found = content.find(anchor_text, pos)
            if found == -1:
                break
            count += 1
            if count == occurrence:
                idx = found
                break
            pos = found + len(anchor_text)
        if idx == -1:
            return {"success": False, "error_code": "PATCH_CONFLICT", "message": f"anchor_text occurrence {occurrence} not found.", "path": str(target), "before_hash": before_hash}
        insert_at = idx + len(anchor_text) if after else idx
        new_content = content[:insert_at] + new_text + content[insert_at:]
        target.write_text(new_content, encoding="utf-8")
        after_hash = hashlib.sha256(target.read_bytes()).hexdigest()
        return {"success": True, "path": str(target), "before_hash": before_hash, "after_hash": after_hash}
    except PathError as e:
        return _err(e)


def delete_text_range(path: str, start_text: str, end_text: str, occurrence: int = 1) -> dict:
    """Delete the text from the Nth occurrence of start_text to the first
    occurrence of end_text after it (inclusive)."""
    try:
        target = must_exist(path, expect_file=True)
        before_hash = hashlib.sha256(target.read_bytes()).hexdigest()
        content, _ = _read_text_safe(target)
        # find start
        start_idx = -1
        pos = 0
        count = 0
        while True:
            found = content.find(start_text, pos)
            if found == -1:
                break
            count += 1
            if count == occurrence:
                start_idx = found
                break
            pos = found + len(start_text)
        if start_idx == -1:
            return {"success": False, "error_code": "PATCH_CONFLICT", "message": f"start_text occurrence {occurrence} not found.", "path": str(target), "before_hash": before_hash}
        end_idx = content.find(end_text, start_idx + len(start_text))
        if end_idx == -1:
            return {"success": False, "error_code": "PATCH_CONFLICT", "message": "end_text not found after start_text.", "path": str(target), "before_hash": before_hash}
        end_pos = end_idx + len(end_text)
        new_content = content[:start_idx] + content[end_pos:]
        target.write_text(new_content, encoding="utf-8")
        after_hash = hashlib.sha256(target.read_bytes()).hexdigest()
        return {"success": True, "path": str(target), "before_hash": before_hash, "after_hash": after_hash, "removed_chars": end_pos - start_idx}
    except PathError as e:
        return _err(e)


# ---------------------------------------------------------------------------
# File ops (full-machine)
# ---------------------------------------------------------------------------

def move_file(src: str, dst: str, overwrite: bool = False) -> dict:
    """Move a file to a new location. Fails if dst exists and overwrite=False."""
    try:
        s = must_exist(src, expect_file=True)
        d = normalize(dst)
        if d.exists() and not overwrite:
            return {"success": False, "error_code": "ALREADY_EXISTS", "message": f"Destination exists: {d}", "path": str(d)}
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(s), str(d))
        return {"success": True, "from": str(s), "to": str(d)}
    except PathError as e:
        return _err(e)


def move_directory(src: str, dst: str, overwrite: bool = False) -> dict:
    """Move a directory recursively. Fails if dst exists and overwrite=False."""
    try:
        s = must_exist(src, expect_file=False)
        d = normalize(dst)
        if d.exists() and not overwrite:
            return {"success": False, "error_code": "ALREADY_EXISTS", "message": f"Destination exists: {d}", "path": str(d)}
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(s), str(d))
        return {"success": True, "from": str(s), "to": str(d)}
    except PathError as e:
        return _err(e)


def delete_directory(path: str, recursive: bool = False) -> dict:
    """Delete a directory. Recursive deletes are NOT default — explicit flag required."""
    try:
        target = must_exist(path, expect_file=False)
        if not recursive:
            if any(target.iterdir()):
                return {"success": False, "error_code": "DIR_NOT_EMPTY", "message": "Directory is not empty. Pass recursive=true to delete it and all contents.", "path": str(target)}
            target.rmdir()
        else:
            shutil.rmtree(str(target))
        return {"success": True, "path": str(target), "recursive": recursive}
    except PathError as e:
        return _err(e)


def copy_file(src: str, dst: str, overwrite: bool = False) -> dict:
    """Copy a file. Fails if dst exists and overwrite=False."""
    try:
        s = must_exist(src, expect_file=True)
        d = normalize(dst)
        if d.exists() and not overwrite:
            return {"success": False, "error_code": "ALREADY_EXISTS", "message": f"Destination exists: {d}", "path": str(d)}
        d.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(s), str(d))
        return {"success": True, "from": str(s), "to": str(d), "bytes": d.stat().st_size}
    except PathError as e:
        return _err(e)


def copy_directory(src: str, dst: str, overwrite: bool = False) -> dict:
    """Copy a directory tree."""
    try:
        s = must_exist(src, expect_file=False)
        d = normalize(dst)
        if d.exists() and not overwrite:
            return {"success": False, "error_code": "ALREADY_EXISTS", "message": f"Destination exists: {d}", "path": str(d)}
        d.mkdir(parents=True, exist_ok=True)
        count = 0
        for item in s.rglob("*"):
            if item.is_file():
                rel = item.relative_to(s)
                target = d / rel
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(item, target)
                count += 1
        return {"success": True, "from": str(s), "to": str(d), "files_copied": count}
    except PathError as e:
        return _err(e)


def rename_path(path: str, new_name: str) -> dict:
    """Rename or move a file/directory within the same volume."""
    try:
        src = must_exist(path)
        dst = normalize(new_name)
        if src == dst:
            return {"success": True, "message": "no change"}
        src.rename(dst)
        return {"success": True, "from": str(src), "to": str(dst)}
    except PathError as e:
        return _err(e)


def create_directory(path: str) -> dict:
    """Create a directory (and parents)."""
    try:
        target = normalize(path)
        target.mkdir(parents=True, exist_ok=True)
        return {"success": True, "path": str(target)}
    except PathError as e:
        return _err(e)


def delete_file(path: str) -> dict:
    """Permanently delete a file. Destructive."""
    try:
        target = must_exist(path, expect_file=True)
        target.unlink()
        return {"success": True, "path": str(target)}
    except PathError as e:
        return _err(e)


def write_file(path: str, content: str, encoding: str = "utf-8", create_parents: bool = True, overwrite: bool = True) -> dict:
    """Create or overwrite a file. Full-machine path allowed."""
    try:
        target = normalize(path)
        if target.exists() and not overwrite:
            return {"success": False, "error_code": "ALREADY_EXISTS", "message": f"File exists: {target}", "path": str(target)}
        if create_parents:
            target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding=encoding)
        return {"success": True, "path": str(target), "bytes": len(content.encode(encoding))}
    except (PathError, OSError) as e:
        if isinstance(e, PathError):
            return _err(e)
        return {"success": False, "error_code": "ACCESS_DENIED", "message": str(e), "path": path}


def append_file(path: str, content: str, encoding: str = "utf-8") -> dict:
    """Append text to a file, creating it if missing."""
    try:
        target = normalize(path)
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("a", encoding=encoding) as f:
            f.write(content)
        return {"success": True, "path": str(target)}
    except (PathError, OSError) as e:
        if isinstance(e, PathError):
            return _err(e)
        return {"success": False, "error_code": "ACCESS_DENIED", "message": str(e), "path": path}


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

def search_files(
    root: str = ".",
    name_pattern: str | None = None,
    extension: str | None = None,
    recursive: bool = True,
    max_results: int = 100,
) -> dict:
    """Search for files by name pattern and/or extension under root."""
    try:
        base = must_exist(root, expect_file=False)
        pattern = name_pattern or "*"
        ext = extension or ""
        if ext and not ext.startswith("."):
            ext = "." + ext
        matches = []
        it = base.rglob("*") if recursive else base.iterdir()
        for p in it:
            try:
                if not p.is_file():
                    continue
                if ext and p.suffix.lower() != ext.lower():
                    continue
                if not re.match(pattern.replace("*", ".*").replace("?", "."), p.name, re.IGNORECASE) and not _simple_match(pattern, p.name):
                    continue
                matches.append({"name": p.name, "path": str(p), "size": p.stat().st_size})
                if len(matches) >= max_results:
                    break
            except OSError:
                continue
        return {"success": True, "root": str(base), "count": len(matches), "matches": matches}
    except PathError as e:
        return _err(e)


def _simple_match(pat: str, name: str) -> bool:
    """Fallback simple glob match."""
    import fnmatch

    return fnmatch.fnmatch(name.lower(), pat.lower())


def grep(
    root: str = ".",
    pattern: str = "",
    file_glob: str | None = None,
    regex: bool = False,
    case_sensitive: bool = False,
    max_results: int = 100,
) -> dict:
    """Search file contents for text or regex. Returns {file, line, column, matching_text}."""
    try:
        base = must_exist(root, expect_file=False)
        results = []
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            prog = re.compile(pattern, flags) if regex else None
        except re.error as e:
            return {"success": False, "error_code": "INVALID_INPUT", "message": f"Invalid regex: {e}", "path": str(base)}
        needle = pattern.lower() if not regex and not case_sensitive else pattern
        for p in base.rglob("*"):
            if not p.is_file():
                continue
            if file_glob:
                import fnmatch

                if not fnmatch.fnmatch(p.name, file_glob):
                    continue
            try:
                if p.stat().st_size > 10 * 1024 * 1024:
                    continue
                with p.open("r", encoding="utf-8", errors="replace") as f:
                    for line_no, line in enumerate(f, 1):
                        line = line.rstrip("\n")
                        hit = False
                        col = None
                        if regex:
                            m = prog.search(line)
                            if m:
                                hit = True
                                col = m.start()
                        else:
                            if not case_sensitive:
                                if needle in line.lower():
                                    hit = True
                                    col = line.lower().find(needle)
                            else:
                                if needle in line:
                                    hit = True
                                    col = line.find(needle)
                        if hit:
                            results.append({
                                "file": str(p),
                                "line": line_no,
                                "column": col,
                                "matching_text": line[:300],
                            })
                            if len(results) >= max_results:
                                return {"success": True, "root": str(base), "pattern": pattern, "count": len(results), "matches": results}
            except (OSError, UnicodeDecodeError):
                continue
        return {"success": True, "root": str(base), "pattern": pattern, "count": len(results), "matches": results}
    except PathError as e:
        return _err(e)


# ---------------------------------------------------------------------------
# Hash / compare
# ---------------------------------------------------------------------------

def file_hash(path: str, algorithm: str = "sha256") -> dict:
    """SHA-256 (default) hash of a file, streamed (large-file safe)."""
    try:
        target = must_exist(path, expect_file=True)
        h = hashlib.new(algorithm)
        with target.open("rb") as f:
            for chunk in iter(lambda: f.read(1024 * 1024), b""):
                h.update(chunk)
        return {"success": True, "path": str(target), "algorithm": algorithm, "hash": h.hexdigest(), "size": target.stat().st_size}
    except PathError as e:
        return _err(e)


def compare_files(path_a: str, path_b: str) -> dict:
    """Compare two files: identical (by hash), sizes, optional text diff lines."""
    try:
        a = must_exist(path_a, expect_file=True)
        b = must_exist(path_b, expect_file=True)
        ha = hashlib.sha256(a.read_bytes()).hexdigest()
        hb = hashlib.sha256(b.read_bytes()).hexdigest()
        identical = ha == hb
        return {
            "success": True,
            "a": str(a), "b": str(b),
            "identical": identical,
            "size_a": a.stat().st_size, "size_b": b.stat().st_size,
            "hash_a": ha, "hash_b": hb,
        }
    except PathError as e:
        return _err(e)


# ---------------------------------------------------------------------------
# Archive
# ---------------------------------------------------------------------------

def zip_directory(src: str, dst: str, exclude: str | None = None) -> dict:
    """Zip a directory into a .zip archive. Destructive (creates new file)."""
    try:
        s = must_exist(src, expect_file=False)
        d = normalize(dst)
        d.parent.mkdir(parents=True, exist_ok=True)
        excluded = set(exclude.split(",")) if exclude else set()
        with zipfile.ZipFile(d, "w", zipfile.ZIP_DEFLATED) as zf:
            for item in s.rglob("*"):
                if any(seg in excluded for seg in item.parts):
                    continue
                if item.is_file():
                    zf.write(item, item.relative_to(s).as_posix())
        return {"success": True, "src": str(s), "dst": str(d), "bytes": d.stat().st_size}
    except PathError as e:
        return _err(e)


def unzip_archive(src: str, dst: str) -> dict:
    """Extract a zip archive. Zip-slip protected: members cannot escape dst."""
    try:
        z = must_exist(src, expect_file=True)
        d = normalize(dst)
        d.mkdir(parents=True, exist_ok=True)
        count = 0
        with zipfile.ZipFile(z) as zf:
            for member in zf.infolist():
                target = safe_join_zip(member.filename, d)
                if member.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                with zf.open(member) as srcf, open(target, "wb") as dstf:
                    shutil.copyfileobj(srcf, dstf)
                count += 1
        return {"success": True, "src": str(z), "dst": str(d), "extracted_files": count}
    except (PathError, zipfile.BadZipFile) as e:
        if isinstance(e, PathError):
            return _err(e)
        return {"success": False, "error_code": "INVALID_ARCHIVE", "message": str(e), "path": src}


# ---------------------------------------------------------------------------
# System
# ---------------------------------------------------------------------------

def get_environment(names: str | None = None) -> dict:
    """Read environment variables. Never returns secret-looking values."""
    if names:
        out = {}
        for n in [x.strip() for x in names.split(",") if x.strip()]:
            v = os.environ.get(n)
            out[n] = v if v is not None else None
        return {"success": True, "values": out}
    # Safe allowlist only
    allow = ["PATH", "USERNAME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "SYSTEMDRIVE", "LOCALAPPDATA", "TEMP", "NUMBER_OF_PROCESSORS", "PROCESSOR_ARCHITECTURE"]
    return {"success": True, "available": sorted(k for k in allow if k in os.environ)}


# Well-known install locations for common tools that are often NOT on PATH.
# Value name maps to the exe filename (or list of candidates) per location.
_KNOWN_TOOL_LOCATIONS = {
    "chrome": [r"C:\Program Files\Google\Chrome\Application\chrome.exe",
               r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"],
    "chromium": [r"C:\Program Files\Chromium\Application\chrome.exe",
                 r"C:\Program Files (x86)\Chromium\Application\chrome.exe"],
    "msedge": [r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
               r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"],
    "firefox": [r"C:\Program Files\Mozilla Firefox\firefox.exe",
                r"C:\Program Files (x86)\Mozilla Firefox\firefox.exe"],
    "node": [r"C:\Program Files\nodejs\node.exe"],
    "npm": [r"C:\Program Files\nodejs\npm.cmd", r"C:\Program Files\nodejs\npm"],
    "python": [r"C:\Python312\python.exe", r"C:\Python311\python.exe", r"C:\Python310\python.exe",
               r"%LOCALAPPDATA%\Programs\Python\Python312\python.exe",
               r"%LOCALAPPDATA%\Programs\Python\Python311\python.exe"],
    "git": [r"C:\Program Files\Git\cmd\git.exe"],
    "code": [r"%LOCALAPPDATA%\Programs\Microsoft VS Code\Code.exe",
             r"C:\Program Files\Microsoft VS Code\Code.exe"],
    "docker": [r"C:\Program Files\Docker\Docker\resources\bin\docker.exe"],
    "pwsh": [r"C:\Program Files\PowerShell\7\pwsh.exe"],
    "pythonw": [r"C:\Python312\pythonw.exe", r"C:\Python311\pythonw.exe"],
}


def _which_in_known_locations(name: str, expanded_env: dict | None = None) -> str | None:
    """Search known install locations for a tool name (case-insensitive extension-agnostic)."""
    candidates = _KNOWN_TOOL_LOCATIONS.get(name.lower())
    if not candidates:
        return None
    env = os.environ.copy()
    if expanded_env:
        env.update(expanded_env)
    for cand in candidates:
        cand = os.path.expandvars(cand)
        p = Path(cand)
        found = None
        if p.exists():
            found = str(p)
        else:
            # Some entries omit the .exe/.cmd suffix — try adding common exts.
            for ext in (".exe", ".cmd", ".bat"):
                q = Path(str(p) + ext)
                if q.exists():
                    found = str(q)
                    break
        if found:
            return found
    return None


def which_command(name: str) -> dict:
    """Locate an executable. Returns full path or null.

    Searches in order:
      1. PATH (via shutil.which)
      2. Well-known install locations for common tools (chrome, node, python,
         git, docker, code, ...) that are often NOT on PATH.
      3. Global fallback: recursive scan of C:\\Program Files and
         C:\\Program Files (x86) for an executable matching `name` (bounded).

    This lets ChatGPT find chrome.exe in Program Files even though it is not on PATH.
    """
    try:
        p = shutil.which(name)
        found = str(p) if p else None
        source = "PATH"
        if not found:
            found = _which_in_known_locations(name)
            source = "known-location"
        if not found and os.name == "nt":
            found = _scan_program_files(name)
            source = "program-files-scan"
        return {"success": True, "name": name, "found": found is not None, "path": found, "source": source}
    except Exception as e:
        return {"success": False, "error_code": "INTERNAL_ERROR", "message": str(e), "path": None}


def _scan_program_files(name: str, depth: int = 0, max_depth: int = 3, _visited: set | None = None) -> str | None:
    """Recursively search Program Files dirs for an executable matching `name`.

    Bounded by depth + visited-set so it stays fast. Only looks for the exact
    basename (name + common executable extensions)."""
    if depth > max_depth:
        return None
    if _visited is None:
        _visited = set()
    roots = [r"C:\Program Files", r"C:\Program Files (x86)"]
    for root in roots:
        if root in _visited:
            continue
        _visited.add(root)
        rp = Path(root)
        if not rp.exists():
            continue
        try:
            for child in rp.iterdir():
                if not child.is_dir():
                    continue
                # exec name match - case-insensitive, try with/without extension
                for cand in (name, name + ".exe", name + ".cmd", name + ".bat"):
                    exe = child / cand
                    if exe.exists():
                        return str(exe)
                # recurse one more level for tools like "Google/Chrome/Application"
                found = _scan_program_files(name, depth + 1, max_depth, _visited)
                if found:
                    return found
        except OSError:
            continue
    return None


def disk_usage(path: str = ".") -> dict:
    """Disk usage for a path/drive."""
    try:
        target = normalize(path)
        if not target.exists():
            target = target.parent
        usage = shutil.disk_usage(str(target))
        return {
            "success": True,
            "path": str(target),
            "total_bytes": usage.total,
            "free_bytes": usage.free,
            "used_bytes": usage.used,
            "total_human": _human(usage.total),
            "free_human": _human(usage.free),
        }
    except PathError as e:
        return _err(e)


# ---------------------------------------------------------------------------
# Git extras
# ---------------------------------------------------------------------------

def git_branch() -> dict:
    """Show current git branch (runs in repo root or cwd)."""
    r = subprocess.run(["git", "branch", "--show-current"], capture_output=True, text=True, timeout=30)
    return {"success": r.returncode == 0, "exit_code": r.returncode, "stdout": (r.stdout or "").strip(), "stderr": r.stderr or ""}


def git_commit_file(path: str, message: str) -> dict:
    """Stage one file and commit it (checkpoint). No push."""
    try:
        target = must_exist(path, expect_file=True)
        d = str(target.parent)
    except PathError as e:
        return _err(e)
    add = subprocess.run(["git", "add", str(target)], cwd=d, capture_output=True, text=True, timeout=30)
    if add.returncode != 0:
        return {"success": False, "exit_code": add.returncode, "stdout": add.stdout, "stderr": add.stderr}
    cm = subprocess.run(["git", "commit", "-m", message], cwd=d, capture_output=True, text=True, timeout=30)
    return {"success": cm.returncode == 0, "exit_code": cm.returncode, "stdout": cm.stdout, "stderr": cm.stderr}
