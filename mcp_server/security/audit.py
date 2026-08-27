"""
Audit logging + validation helpers for the Computer MCP server.

Audit log records tool invocations with outcome + duration but NEVER logs
secrets (passwords, tokens, Authorization headers, API keys) or file content.
"""

from __future__ import annotations

import json
import logging
import os
import time
from pathlib import Path

AUDIT_LOGGER_NAME = "computer_mcp.audit"
audit_logger = logging.getLogger(AUDIT_LOGGER_NAME)

# Keys that must never be logged even if they appear in params
_SECRET_KEYS = {
    "password", "passwd", "secret", "token", "access_token", "refresh_token",
    "api_key", "apikey", "authorization", "client_secret", "code_verifier",
}


def setup_audit_log(log_path: str | Path) -> None:
    """Configure the audit logger to append JSON lines to a file."""
    path = Path(log_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    handler = logging.FileHandler(path, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(message)s"))
    audit_logger.addHandler(handler)
    audit_logger.setLevel(logging.INFO)
    audit_logger.propagate = False


def sanitize_params(params: dict | None) -> dict:
    """Redact secret-like keys from params for logging."""
    if not params:
        return {}
    out = {}
    for k, v in params.items():
        k_l = str(k).lower()
        if any(s in k_l for s in _SECRET_KEYS):
            out[str(k)] = "<redacted>"
        else:
            out[str(k)] = v
    return out


class Audit:
    """Context manager recording one tool invocation."""

    def __init__(self, tool: str, params: dict | None, success: bool = False):
        self.tool = tool
        self.params = sanitize_params(params)
        self.success = success
        self.started = time.monotonic()
        self.note = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        duration_ms = int((time.monotonic() - self.started) * 1000)
        if exc_type is not None:
            self.success = False
            self.note = str(exc)[:200]
        record = {
            "ts": time.strftime("%Y-%m-%d %H:%M:%S"),
            "tool": self.tool,
            "params": self.params,
            "ok": self.success,
            "duration_ms": duration_ms,
        }
        if self.note:
            record["note"] = self.note
        audit_logger.info(json.dumps(record, ensure_ascii=False))


# ---------------------------------------------------------------------------
# Size limits (config-driven, overridable via env)
# ---------------------------------------------------------------------------

MAX_FILE_READ_MB = float(os.environ.get("MAX_FILE_READ_MB", "50"))
MAX_COMMAND_OUTPUT_MB = float(os.environ.get("MAX_COMMAND_OUTPUT_MB", "10"))
COMMAND_TIMEOUT_SECONDS = int(os.environ.get("COMMAND_TIMEOUT_SECONDS", "120"))
AUDIT_LOG_ENABLED = os.environ.get("AUDIT_LOG_ENABLED", "true").lower() in ("1", "true", "yes")
