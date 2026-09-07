"""Minimal CDP client over the test-profile Chrome on port 9224.

Usage:
  python cdp_tool.py list
  python cdp_tool.py open <url>
  python cdp_tool.py eval <url-substring> <js-expression>
  python cdp_tool.py nav <url-substring> <url>

All output is sanitized-safe: this tool only reads page state / drives normal
UI. It never prints cookies or tokens.
"""
import json
import sys
import time
import urllib.request

import websocket

BASE = "http://127.0.0.1:9224"


def _get(path):
    with urllib.request.urlopen(BASE + path, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def _put(path):
    req = urllib.request.Request(BASE + path, method="PUT")
    with urllib.request.urlopen(req, timeout=10) as r:
        return json.loads(r.read().decode("utf-8"))


def list_targets():
    for t in _get("/json/list"):
        if t.get("type") in ("page", "service_worker", "background_page"):
            print(t["type"], "|", t.get("title", "")[:60], "|", t.get("url", "")[:100])


def find(sub):
    for t in _get("/json/list"):
        if t.get("type") == "page" and sub in (t.get("url", "") + t.get("title", "")):
            return t
    raise SystemExit("no page matching: " + sub)


def find_sw():
    for t in _get("/json/list"):
        if t.get("type") == "service_worker" and "service-worker.js" in t.get("url", ""):
            return t
    raise SystemExit("no flowgraph service worker target")


class Session:
    def __init__(self, target, timeout=600):
        self.ws = websocket.create_connection(target["webSocketDebuggerUrl"], timeout=timeout, suppress_origin=True)
        self._id = 0

    def cmd(self, method, params=None):
        self._id += 1
        mid = self._id
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise SystemExit("CDP error: " + json.dumps(msg["error"]))
                return msg.get("result", {})

    def eval(self, expr, await_promise=False):
        r = self.cmd("Runtime.evaluate", {
            "expression": expr,
            "returnByValue": True,
            "awaitPromise": await_promise,
        })
        if r.get("exceptionDetails"):
            return {"__error__": r["exceptionDetails"].get("text", "js error")}
        return r.get("result", {}).get("value")

    def close(self):
        try:
            self.ws.close()
        except Exception:
            pass


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return
    op = sys.argv[1]
    if op == "list":
        list_targets()
    elif op == "open":
        t = _put("/json/new?url=" + sys.argv[2])
        print(t["id"], t["url"])
    elif op == "nav":
        s = Session(find(sys.argv[2]))
        s.cmd("Page.enable")
        s.cmd("Page.navigate", {"url": sys.argv[3]})
        print("navigated")
        s.close()
    elif op == "eval":
        s = Session(find(sys.argv[2]))
        s.cmd("Runtime.enable")
        out = s.eval(sys.argv[3], await_promise=True)
        print(json.dumps(out, ensure_ascii=False, default=str))
        s.close()
    elif op == "evalsw":
        s = Session(find_sw())
        s.cmd("Runtime.enable")
        out = s.eval(sys.argv[2], await_promise=True)
        print(json.dumps(out, ensure_ascii=False, default=str))
        s.close()
    elif op == "click":
        s = Session(find(sys.argv[2]))
        x, y = float(sys.argv[3]), float(sys.argv[4])
        for t in ("mouseMoved", "mousePressed", "mouseReleased"):
            s.cmd("Input.dispatchMouseEvent", {
                "type": t, "x": x, "y": y, "button": "left",
                "clickCount": 1,
                **({"buttons": 1} if t == "mousePressed" else {}),
                **({"buttons": 0} if t == "mouseReleased" else {}),
            })
        print("clicked", x, y)
        s.close()
    elif op == "inserttext":
        s = Session(find(sys.argv[2]))
        s.cmd("Input.insertText", {"text": sys.argv[3]})
        print("inserted")
        s.close()
    else:
        print("unknown op")


if __name__ == "__main__":
    main()
