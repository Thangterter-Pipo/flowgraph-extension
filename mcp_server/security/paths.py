"""
Path utilities for the full-machine Computer MCP server.

Unlike the Flow_veo sandbox, paths may be ANY absolute Windows path the
current user can access (C:\\, D:\\, E:\\, F:\\...). We do NOT try to bypass
Windows ACLs — operations run under the current user and the OS enforces
permissions.

Security goals:
  - Normalize paths (resolve, collapse .., reject non-existent drives).
  - Reject NUL bytes and reserved names.
  - Prevent zip-slip when extracting archives.
  - No hard-coded roots; any absolute path on a real drive is allowed.
"""

from __future__ import annotations

import os
import re
from pathlib import Path

# Windows reserved device names (even with an extension they are reserved)
_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}


class PathError(ValueError):
    """Raised for invalid, unsafe or inaccessible paths."""

    def __init__(self, code: str, message: str, path: str | None = None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.path = path


def is_abs_windows(path: str) -> bool:
    """True if path looks like an absolute Windows path (C:\\..., \\\\server\\...)."""
    if not path or path.isspace():
        return False
    path = path.strip()
    if re.match(r"^[A-Za-z]:[\\/]", path):
        return True
    if path.startswith("\\\\") or path.startswith("//"):
        return True
    # Root of current drive: \foo
    if path.startswith("\\") or path.startswith("/"):
        return True
    return False


def normalize(path: str) -> Path:
    """Validate + normalize a user-supplied path into an absolute Path.

    Raises PathError(INVALID_PATH) / PathError(PATH_NOT_FOUND).
    """
    if not path or path.isspace():
        raise PathError("INVALID_PATH", "path must not be empty.")
    if "\x00" in path:
        raise PathError("INVALID_PATH", "path contains NUL byte.")

    stripped = path.strip()
    # Allow relative paths (resolved against cwd) but keep it explicit.
    p = Path(stripped)
    if not p.is_absolute():
        # Interpret relative against the process cwd
        try:
            p = Path.cwd() / p
        except OSError as e:
            raise PathError("INVALID_PATH", f"cannot resolve cwd: {e}") from e

    # Reserved device names check (base name before any dot)
    stem = p.name.split(".")[0].upper()
    if stem in _RESERVED:
        raise PathError("INVALID_PATH", f"'{p.name}' is a reserved device name.")

    # Drive letter must exist on this machine
    drive = os.path.splitdrive(str(p))[0]
    if drive:
        if not os.path.exists(drive + os.sep):
            raise PathError("PATH_NOT_FOUND", f"Drive '{drive}' does not exist.", str(p))
    elif os.name == "nt":
        raise PathError("INVALID_PATH", "Path must include a drive letter on Windows.", str(p))

    # Resolve (collapses '..', resolves symlinks where possible).
    # If the path does not exist, resolve() still works for the parent's part.
    try:
        resolved = p.resolve(strict=False)
    except (OSError, RuntimeError) as e:
        raise PathError("INVALID_PATH", f"cannot resolve path: {e}", str(p)) from e
    return resolved


def must_exist(path: str, expect_file: bool | None = None) -> Path:
    """Like normalize but also asserts existence + kind."""
    p = normalize(path)
    if not p.exists():
        raise PathError("PATH_NOT_FOUND", f"Path does not exist: {path}", str(p))
    if expect_file is True and not p.is_file():
        raise PathError("PATH_NOT_FOUND", f"Not a file: {path}", str(p))
    if expect_file is False and not p.is_dir():
        raise PathError("PATH_NOT_FOUND", f"Not a directory: {path}", str(p))
    return p


def safe_join_zip(member_name: str, dest_dir: Path) -> Path:
    """Prevent zip-slip: resolve member path against dest and ensure it stays inside."""
    # Normalize separators; reject absolute members and parent traversal
    clean = member_name.replace("\\", "/")
    if clean.startswith("/") or re.match(r"^[A-Za-z]:", clean):
        raise PathError("INVALID_PATH", f"Archive member is absolute: {member_name}")
    parts = clean.split("/")
    if ".." in parts:
        raise PathError("INVALID_PATH", f"Archive member escapes destination: {member_name}")
    target = dest_dir.joinpath(*parts).resolve()
    try:
        target.relative_to(dest_dir.resolve())
    except ValueError:
        raise PathError("INVALID_PATH", f"Archive member escapes destination: {member_name}") from None
    return target


def iter_under(path: Path, include_hidden: bool = False):
    """Yield files/dirs under path, skipping recursion into hidden dirs when hidden off."""
    for p in path.rglob("*"):
        if not include_hidden:
            if any(part.startswith(".") and len(part) > 1 for part in p.parts):
                continue
        yield p
