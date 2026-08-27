"""Thin client: send one command to the running flow_ctl controller and print the result.

Usage:
  python fc.py <action> [json-args]
  python fc.py url
  python fc.py goto "{\"url\":\"https://labs.google/fx/vi/tools/flow\"}"
  python fc.py snapshot "{\"limit\":80}"
  python fc.py net "{\"unique\":true,\"last\":60}"
"""

import json
import os
import sys
import time

BASE = os.path.dirname(os.path.abspath(__file__))
CMD = os.path.join(BASE, "cmd.json")
RES = os.path.join(BASE, "result.json")


def main():
    if len(sys.argv) < 2:
        print("usage: fc.py <action> [json-args]")
        return 2

    action = sys.argv[1]
    args = {}
    if len(sys.argv) > 2 and sys.argv[2].strip():
        args = json.loads(sys.argv[2])

    prev = None
    if os.path.exists(RES):
        try:
            with open(RES, encoding="utf-8") as fh:
                prev = json.load(fh).get("id")
        except Exception:
            prev = None

    cid = int(time.time() * 1000)
    tmp = f"{CMD}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"id": cid, "action": action, "args": args}, fh, ensure_ascii=False)
    # The controller polls cmd.json, so the rename can briefly collide on Windows.
    for attempt in range(40):
        try:
            os.replace(tmp, CMD)
            break
        except PermissionError:
            time.sleep(0.1)
    else:
        print(json.dumps({"ok": False, "error": "could not write command file"}))
        return 1

    deadline = time.time() + float(os.environ.get("FC_TIMEOUT", "120"))
    while time.time() < deadline:
        if os.path.exists(RES):
            try:
                with open(RES, encoding="utf-8") as fh:
                    res = json.load(fh)
                if res.get("id") == cid and res.get("id") != prev:
                    print(json.dumps(res, ensure_ascii=False, indent=1)[:60000])
                    return 0 if res.get("ok") else 1
            except Exception:
                pass
        time.sleep(0.2)

    print(json.dumps({"ok": False, "error": "timeout waiting for controller"}))
    return 1


if __name__ == "__main__":
    sys.exit(main())
