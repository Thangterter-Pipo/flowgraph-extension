"""End-to-end test against the live server on 0.0.0.0:3080 (real HTTP)."""
import json
import re
import urllib.request
import urllib.error
import http.client

BASE = "http://127.0.0.1:3080/mcp"
KEY = "XLeEPAdY1CQWHgzJ0Ngph2CYj748iSywUSiuVuw4KWE"
PASS = 0
FAIL = 0
SESSION = {"id": None}


def check(label, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f"  PASS  {label}")
    else:
        FAIL += 1
        print(f"  FAIL  {label}  {extra}")


def call(method, params=None, key=KEY):
    body = {"jsonrpc": "2.0", "id": 7, "method": method}
    if params is not None:
        body["params"] = params
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": f"Bearer {key}",
    }
    if SESSION["id"]:
        headers["Mcp-Session-Id"] = SESSION["id"]
    req = urllib.request.Request(BASE, data=json.dumps(body).encode(), headers=headers)
    conn = http.client.HTTPConnection("127.0.0.1", 3080, timeout=15)
    conn.request("POST", "/mcp", json.dumps(body), headers)
    resp = conn.getresponse()
    status = resp.status
    raw = resp.read().decode()
    sid = resp.getheader("mcp-session-id")
    if sid:
        SESSION["id"] = sid
    conn.close()
    obj = None
    if "text/event-stream" in resp.getheader("content-type", ""):
        m = re.search(r'data:\s*(\{.*\})', raw, re.S)
        if m:
            obj = json.loads(m.group(1))
    else:
        try:
            obj = json.loads(raw)
        except Exception:
            pass
    return status, obj, raw


print("== E2E over real HTTP ==")
# health
conn = http.client.HTTPConnection("127.0.0.1", 3080, timeout=10)
conn.request("GET", "/health")
r = conn.getresponse()
check("health 200", r.status == 200, r.status)
check("health body ok", "ok" in r.read().decode())
conn.close()

# no auth
conn = http.client.HTTPConnection("127.0.0.1", 3080, timeout=10)
conn.request("POST", "/mcp", json.dumps({}), {"Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
r = conn.getresponse()
check("no-auth 401", r.status == 401, r.status)
conn.close()

# handshake
s, obj, raw = call("initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "e2e", "version": "1"}})
check("init 200", s == 200, s)
check("session id set", bool(SESSION["id"]), SESSION["id"])

s, obj, raw = call("tools/list")
names = [t["name"] for t in obj["result"]["tools"]]
check("tools/list", len(names) == 12, names)

# call a real tool over the wire
s, obj, raw = call("tools/call", {"name": "list_tree", "arguments": {"path": "docs", "max_depth": 2}})
ct = obj["result"]["content"][0]["text"]
data = json.loads(ct)
check("list_tree docs ok", data.get("ok") is True, ct[:200])
print("  docs entries:", data.get("count"))

s, obj, raw = call("tools/call", {"name": "write_file", "arguments": {"path": "_e2e/tmp.txt", "content": "e2e"}})
data = json.loads(obj["result"]["content"][0]["text"])
check("write over wire", data.get("ok") is True, raw[:200])
s, obj, raw = call("tools/call", {"name": "read_file", "arguments": {"path": "_e2e/tmp.txt"}})
data = json.loads(obj["result"]["content"][0]["text"])
check("read over wire", "e2e" in data.get("content", ""), raw[:200])
s, obj, raw = call("tools/call", {"name": "delete_file", "arguments": {"path": "_e2e/tmp.txt"}})
s, obj, raw = call("tools/call", {"name": "delete_file", "arguments": {"path": "_e2e"}})
data = json.loads(obj["result"]["content"][0]["text"])
check("cleanup", data.get("message") == "deleted", raw[:200])

print(f"\n== RESULT: {PASS} passed, {FAIL} failed ==")
raise SystemExit(1 if FAIL else 0)
