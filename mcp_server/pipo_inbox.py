"""Pipo inbox — ChatGPT MCP assigns work; Pipo cron polls pending tasks."""
from __future__ import annotations

import json
import os
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path

_DEFAULT_DIR = Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "FlowVeoMCP" / "pipo-inbox"


def inbox_dir() -> Path:
    override = os.environ.get("FLOW_VEO_PIPO_INBOX", "").strip()
    return Path(override) if override else _DEFAULT_DIR


def _pending_path() -> Path:
    return inbox_dir() / "pending.jsonl"


def _done_path() -> Path:
    return inbox_dir() / "done.jsonl"


def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    items: list[dict] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            items.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return items


def _write_jsonl(path: Path, items: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    body = "".join(json.dumps(it, ensure_ascii=False) + "\n" for it in items)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(body, encoding="utf-8")
    tmp.replace(path)


def assign(task: str, title: str = "") -> dict:
    text = (task or "").strip()
    if not text:
        return {"success": False, "error_code": "INVALID_INPUT", "message": "task must not be empty"}
    item = {
        "id": secrets.token_hex(8),
        "created_at": datetime.now(timezone.utc).isoformat(),
        "title": (title or "").strip()[:120],
        "task": text[:20000],
        "status": "pending",
    }
    pending = _read_jsonl(_pending_path())
    pending.append(item)
    _write_jsonl(_pending_path(), pending)
    return {
        "success": True,
        "task_id": item["id"],
        "title": item["title"],
        "created_at": item["created_at"],
        "pending_count": len(pending),
    }


def list_pending() -> list[dict]:
    return [it for it in _read_jsonl(_pending_path()) if it.get("status") in ("pending", "in_progress")]


def claim_next() -> dict | None:
    """Atomic FIFO lease: picks first pending task and marks it in_progress."""
    pending = _read_jsonl(_pending_path())
    in_prog = next((it for it in pending if it.get("status") == "in_progress"), None)
    if in_prog:
        return {"task": in_prog, "already_in_progress": True}

    for it in pending:
        if it.get("status") == "pending":
            it["status"] = "in_progress"
            it["claimed_at"] = datetime.now(timezone.utc).isoformat()
            _write_jsonl(_pending_path(), pending)
            return {"task": it, "already_in_progress": False}
    return None


def get_active_task() -> dict | None:
    """Returns the currently active task, if any."""
    pending = _read_jsonl(_pending_path())
    return next((it for it in pending if it.get("status") == "in_progress"), None)


def complete(task_id: str) -> dict:
    tid = (task_id or "").strip()
    if not tid:
        return {"success": False, "error_code": "INVALID_INPUT", "message": "task_id required"}
    pending = _read_jsonl(_pending_path())
    found = None
    keep: list[dict] = []
    for it in pending:
        if it.get("id") == tid and found is None:
            found = it
        else:
            keep.append(it)
    if found is None:
        return {"success": False, "error_code": "NOT_FOUND", "message": f"no pending task {tid}"}
    found["status"] = "done"
    found["completed_at"] = datetime.now(timezone.utc).isoformat()
    done = _read_jsonl(_done_path())
    done.append(found)
    _write_jsonl(_pending_path(), keep)
    _write_jsonl(_done_path(), done)
    return {"success": True, "task_id": tid, "pending_count": len(keep)}


STALE_IN_PROGRESS_SECONDS = 10 * 60


def _in_progress_age_bucket(item: dict, now: datetime | None = None) -> str:
    """Stable age class so a hung in_progress task re-wakes the monitor once it goes stale."""
    if item.get("status") != "in_progress":
        return "fresh"
    raw = item.get("claimed_at") or ""
    try:
        claimed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return "stale"
    if claimed.tzinfo is None:
        claimed = claimed.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    age = (current - claimed).total_seconds()
    return "stale" if age >= STALE_IN_PROGRESS_SECONDS else "fresh"


def monitor_snapshot() -> str:
    """Stable text for Hermes cron monitor_script (no timestamps)."""
    items = list_pending()
    if not items:
        return "NONE\n"
    lines = [
        f"{it['id']}\t{it.get('status', 'pending')}\t{_in_progress_age_bucket(it)}\t{it.get('title') or ''}\t{len(it.get('task') or '')}"
        for it in items
    ]
    return "\n".join(lines) + "\n"


def main(argv: list[str]) -> int:
    cmd = argv[1] if len(argv) > 1 else "monitor"
    if cmd == "monitor":
        print(monitor_snapshot(), end="")
        return 0
    if cmd == "list":
        print(json.dumps(list_pending(), ensure_ascii=False, indent=2))
        return 0
    if cmd == "claim":
        print(json.dumps(claim_next(), ensure_ascii=False, indent=2))
        return 0
    if cmd == "active":
        print(json.dumps(get_active_task(), ensure_ascii=False, indent=2))
        return 0
    if cmd == "done" and len(argv) > 2:
        print(json.dumps(complete(argv[2]), ensure_ascii=False))
        return 0
    print("usage: pipo_inbox.py monitor|list|claim|active|done <id>", flush=True)
    return 2


if __name__ == "__main__":
    import sys

    raise SystemExit(main(sys.argv))
