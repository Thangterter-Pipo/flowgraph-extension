"""Tests for Pipo inbox assign/complete (no live MCP)."""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

tmp = Path(tempfile.mkdtemp(prefix="pipo-inbox-"))
os.environ["FLOW_VEO_PIPO_INBOX"] = str(tmp)
sys.path.insert(0, str(Path(__file__).resolve().parent))
import pipo_inbox as inbox  # noqa: E402

PASS = 0
FAIL = 0


def check(label: str, cond: bool, extra: object = "") -> None:
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}  {extra}")


def main() -> None:
    check("empty task rejected", inbox.assign("  ").get("success") is False)
    a = inbox.assign("Fix WorkflowRuntime stage scheduler", title="scheduler")
    check("assign ok", a.get("success") is True and bool(a.get("task_id")))
    check("pending count 1", a.get("pending_count") == 1)
    pending = inbox.list_pending()
    check("list has task text", pending[0]["task"].startswith("Fix WorkflowRuntime"))
    snap = inbox.monitor_snapshot()
    check("monitor not NONE", "NONE" not in snap and a["task_id"] in snap)
    check("pending snapshot is fresh", "\tpending\tfresh\t" in snap)
    claimed = inbox.claim_next()
    check("claim ok", bool(claimed and claimed.get("task", {}).get("id") == a["task_id"]))
    claimed_snap = inbox.monitor_snapshot()
    check("fresh in_progress stays fresh", "\tin_progress\tfresh\t" in claimed_snap)
    stale_item = dict(claimed["task"])
    from datetime import datetime, timedelta, timezone
    stale_item["claimed_at"] = (datetime.now(timezone.utc) - timedelta(minutes=11)).isoformat()
    check("stale in_progress bucket", inbox._in_progress_age_bucket(stale_item) == "stale")
    check("missing claimed_at is stale", inbox._in_progress_age_bucket({"status": "in_progress"}) == "stale")
    done = inbox.complete(a["task_id"])
    check("complete ok", done.get("success") is True)
    check("pending empty", inbox.list_pending() == [])
    check("monitor NONE", inbox.monitor_snapshot() == "NONE\n")
    check("complete missing", inbox.complete("nope").get("success") is False)
    print(f"\n{PASS} passed, {FAIL} failed")
    raise SystemExit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
