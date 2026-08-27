"""Send the contents of a .js file to the controller as an `eval` command.

Avoids PowerShell quoting problems for large scripts.
Usage: python evalf.py get_models.js [out.json]
"""
import json
import os
import subprocess
import sys
import time

BASE = os.path.dirname(os.path.abspath(__file__))
CMD = os.path.join(BASE, "cmd.json")
RES = os.path.join(BASE, "result.json")


def main():
    js_path = os.path.join(BASE, sys.argv[1]) if not os.path.isabs(sys.argv[1]) else sys.argv[1]
    with open(js_path, encoding="utf-8") as fh:
        expr = fh.read()

    prev = None
    if os.path.exists(RES):
        try:
            prev = json.load(open(RES, encoding="utf-8")).get("id")
        except Exception:
            pass

    cid = int(time.time() * 1000)
    tmp = f"{CMD}.{os.getpid()}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"id": cid, "action": "eval", "args": {"expr": expr}}, fh, ensure_ascii=False)
    for _ in range(40):
        try:
            os.replace(tmp, CMD)
            break
        except PermissionError:
            time.sleep(0.1)

    deadline = time.time() + float(os.environ.get("FC_TIMEOUT", "180"))
    while time.time() < deadline:
        if os.path.exists(RES):
            try:
                res = json.load(open(RES, encoding="utf-8"))
                if res.get("id") == cid and res.get("id") != prev:
                    out = sys.argv[2] if len(sys.argv) > 2 else None
                    if out:
                        op = out if os.path.isabs(out) else os.path.join(BASE, out)
                        with open(op, "w", encoding="utf-8") as fh:
                            json.dump(res, fh, ensure_ascii=False, indent=1)
                        print(f"ok={res.get('ok')} -> {op}")
                    else:
                        print(json.dumps(res, ensure_ascii=False, indent=1)[:60000])
                    return 0 if res.get("ok") else 1
            except Exception:
                pass
        time.sleep(0.2)
    print(json.dumps({"ok": False, "error": "timeout"}))
    return 1


if __name__ == "__main__":
    sys.exit(main())
